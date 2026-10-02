# 회사 포털 SSO

CS는 `company-portal`을 직원 계정과 접근 권한의 유일한 원본으로 사용합니다. CS에는 직원 계정 저장소와 외부 Basic 로그인 모드가 없습니다.

## 권한

- `cs.access`: 조회, Steam 환불, PlayFab 지급·회수, 로그 검색을 포함한 CS 전체 접근

Company Portal의 회사 관리자와 마스터는 Portal 정책에 의해 `cs.access`를 가진 것과 동일하게 처리됩니다. CS는 별도의 기능별 직원 권한을 관리하지 않습니다.

## 흐름

1. 직원이 회사 홈에서 CS를 선택하거나 `cs.example.com`의 주소를 직접 엽니다.
2. CS 세션이 없으면 게이트웨이가 원래 상대 경로를 `returnUrl`로 붙여 Company Portal `/Auth/Cs`로 이동시킵니다.
3. Portal은 활성 회사 계정과 `cs.access`를 확인하고 1분 유효 HMAC-SHA256 토큰을 CS `/auth/sso/callback`으로 POST합니다.
4. CS 게이트웨이는 서명, 발급자, `aud=cs`, 만료시간, `cs.access`, 일회용 `jti`를 검증합니다.
5. CS는 기본 15분 유효의 `HttpOnly`, `SameSite=Lax` 세션 쿠키를 발급하고 서명된 `returnUrl`로 복귀시킵니다.
6. 게이트웨이는 모든 외부 `x-company-*` 헤더를 버리고 검증한 직원 ID, 이름, 이메일만 설정합니다.
7. 내부 CS 서버는 프로세스 시작 시 생성된 임시 Basic 인증정보와 루프백 포트를 통해서만 호출됩니다.
8. 환불, PlayFab 명령, 로그 검색 감사 로그는 실제 Company Portal 직원 식별자를 기록합니다.

Company Portal은 Steam Publisher Key, PlayFab Secret Key, Azure SAS Token을 알지 못합니다. 해당 비밀값은 계속 CS 컨테이너에만 존재합니다.

## 환경변수

```dotenv
COMPANY_PORTAL_URL=https://company.example.com
COMPANY_SSO_ISSUER=company-portal
COMPANY_SSO_SHARED_SECRET=<Portal/Leave/CS에 동일한 32자 이상 비밀값>
CS_SESSION_MINUTES=15
CS_INTERNAL_PORT=3100
COOKIE_SECURE=true
TRUST_PROXY=true
```

`COMPANY_SSO_SHARED_SECRET`는 `openssl rand -base64 48` 같은 방식으로 생성하고 저장소에 커밋하지 않습니다.

## 전환 순서

1. Company Portal에 CS Base URL `https://cs.example.com`과 공통 SSO 공유키를 설정합니다.
2. CS에 동일한 공유키, Portal URL, 발급자, HTTPS 쿠키 설정을 적용합니다.
3. Company Portal 직원 관리에서 대상 직원에게 `cs.access`를 부여합니다.
4. Company Portal의 CS 버튼과 CS 직접 하위 주소 진입을 각각 확인합니다.
5. `cs.access` 직원으로 조회, 테스트 PlayFab 작업, 설정상 허용된 Steam 환불까지 확인합니다.
6. 권한이 없는 직원과 비활성 직원의 새 SSO 진입이 차단되는지 확인합니다.

CS 세션은 SSO 시점의 권한을 기본 15분 동안 보관합니다. 권한을 회수한 직원의 새 진입은 즉시 차단되며, 이미 열린 CS 세션은 만료 또는 CS 화면의 로그아웃까지 유지됩니다.

## 감사 로그

기존 상세 감사 로그 외에 SSO 게이트웨이가 민감 작업 호출자를 별도로 기록합니다.

```text
/app/data/company-access-audit.jsonl
```

Steam 환불, PlayFab 작업, 로그 검색에 회사 사용자 ID, 이름, 이메일을 기록합니다. 게이트웨이 접근 감사에는 민감 작업의 경로, 결과 상태, IP도 기록합니다.

## 탐색과 로그아웃

모든 CS 화면 상단의 `회사 홈`은 `/auth/company-home`을 거쳐 설정된 Portal 주소로 이동합니다. `로그아웃`은 CS 세션 쿠키를 삭제하고 회사 홈으로 돌아갑니다. Company Portal 전체 로그인 종료는 회사 홈의 로그아웃을 사용합니다.
