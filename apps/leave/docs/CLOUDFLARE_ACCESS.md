# Cloudflare Access + Google Group 제한 설정

목표: `leave.example.com`에 접근하기 전에 Cloudflare Access가 먼저 Google Workspace 그룹 구성원인지 확인한다.

## 1. Google Workspace 그룹 준비

예시 그룹:

```text
leave-users@company.com
```

연차관리 사이트에 접근할 직원/관리자 계정을 이 그룹에 추가한다.

## 2. Cloudflare Zero Trust에서 Google Workspace IdP 연결

Cloudflare Dashboard에서:

```text
Zero Trust
→ Settings 또는 Integrations
→ Authentication / Identity providers
→ Add new provider
→ Google Workspace
```

Google Cloud에서 발급한 Client ID / Client Secret과 Workspace 도메인을 입력한다.

## 3. Access Application 생성

```text
Zero Trust
→ Access
→ Applications
→ Add an application
→ Self-hosted
```

Application domain:

```text
leave.example.com
```

## 4. Access Policy 생성

정책 예시:

```text
Policy action: Allow
Selector: Identity provider group
Value: leave-users@company.com
```

개인 Gmail 관리자가 별도 필요하면 Include 조건에 이메일도 추가한다.

```text
Selector: Emails
Value: user@example.com
```

## 5. 앱 인증은 Company Portal만 사용

Cloudflare Access는 선택적인 1차 출입문이다. 이를 사용하더라도 LeaveManager가 Google OAuth나
직원 접근권한을 직접 관리하지 않는다. 실제 회사 로그인과 회사 역할 판정은 Company Portal에서
수행하며, `leave.access`는 모든 활성 직원에게 기본으로 포함된다.

```text
Cloudflare Access 통과
→ Company Portal 회사 로그인 및 기본 leave.access 확인
→ Portal SSO로 연차관리 진입
```

## 6. 원본 서버 접근 제한

운영 `.env`의 호스트와 프록시 설정은 다음 형태를 유지한다.

```text
PUBLIC_BASE_URL=https://leave.example.com
ALLOWED_HOSTS=leave.example.com;localhost;127.0.0.1;[::1]
SECURITY_TRUST_ANY_FORWARDER=true
```

Docker 브리지와 Cloudflare Tunnel 프록시의 내부 IP가 고정되지 않기 때문에 현재 Compose 운영 설정은 모든 프록시의 전달 헤더를 신뢰한다. 대신 앱은 다음과 같이 범위를 줄인다.

- `X-Forwarded-For`, `X-Forwarded-Proto`만 처리한다.
- 가장 가까운 프록시 1단만 처리한다.
- `X-Forwarded-Host`는 신뢰하지 않고 실제 Host와 `AllowedHosts`를 사용한다.

LeaveManager Compose는 호스트 포트를 `127.0.0.1:5080:8080`으로만 바인딩한다. 따라서 같은 PC의 브라우저에서는 `http://localhost:5080`으로 접근할 수 있지만, 사내망의 다른 기기에서 `http://서버PC_IP:5080`으로 직접 접근하는 경로는 열지 않는다.

Cloudflare Tunnel이 Docker 컨테이너로 실행되는 경우에는 LeaveManager와 Tunnel 컨테이너를 같은 Docker 네트워크에 연결하고, Tunnel ingress 대상은 다음 내부 주소를 사용한다.

```text
http://leave-manager:8080
```

LeaveManager Compose는 고정 네트워크 이름 `leave-net`을 생성한다. Tunnel Compose에도 같은 네트워크를 외부 네트워크로 연결한다.

```yaml
services:
  cloudflared:
    networks:
      - leave-net

networks:
  leave-net:
    external: true
```

Cloudflare Tunnel 설정 예:

```yaml
ingress:
  - hostname: leave.example.com
    service: http://leave-manager:8080
  - service: http_status:404
```

이 구성에서는 `leave.example.com` 접근은 Cloudflare Tunnel을 통하고, 원본 5080 포트는 서버 PC 내부 접근으로 제한된다.

## 7. 점검

브라우저 시크릿 창에서 `https://leave.example.com`에 접속한다.

정상 흐름:

```text
Cloudflare Access 인증
→ Company Portal 회사 로그인
→ 기본 leave.access 확인 및 SSO
→ 연차관리 화면
```

허용 그룹이 아닌 계정은 연차관리 앱 로그인 화면까지 도달하지 못해야 한다.

관리자 페이지의 `보안 점검`에서는 다음을 확인한다.

- 최종 Scheme: `https`
- 최종 Host: `leave.example.com`
- HTTPS 인식: `켜짐`
- 허용 Host 제한: `정상`
- 외부 URL HTTPS: `정상`
- Data Protection 키 파일: 1개 이상

Forwarded Headers 미들웨어는 `X-Forwarded-*` 값을 처리한 뒤 최종 Scheme과 클라이언트 IP에 반영한다. 따라서 원본 `X-Forwarded-*` 헤더가 비어 있는지보다 최종 값과 `X-Original-*` 진단값을 기준으로 판단한다.
