# NSP Leave System

알림 읽음/확인·Discord 개인 설정·정산 처리·로그인 fallback 버튼은 [공통 계정 작업 버튼](../../packages/contracts/account-action-controls.md)을 사용합니다. native 폼/CSRF·OAuth와 기존 공통 저장·확인·초안 처리는 유지합니다.

신청·대기열·직원·사용 통계·보안 현황은 [공통 반응형 표](../../packages/contracts/responsive-tables.md)를 사용합니다. 서버 열 제목/레이블과 기존 폼을 유지하면서 PC 표와 모바일 카드로 표시합니다.

월간/연간 달력과 날짜 상세의 직원 프로필은 공통 렌더러·문자열 ID 매핑을 사용합니다. 사진 갱신/폴백과 공개 범위·본인 보기, 구분 문자가 포함된 이름의 안전한 표시는 [달력 직원 표시 계약](../../packages/contracts/leave-calendar-entities.md)을 따릅니다.

공휴일 관리의 네 작업은 공통 확인창·폼·상태·작업 세션을 사용합니다. 전체 연도 기준값과 입력/반영 목록·건수 검증, JSON 원문/독립 초안 보존 및 native 복구는 [공휴일 계약](../../packages/contracts/leave-holidays.md)을 따릅니다.

채널 알림 설정의 등록·삭제·테스트 발송은 공통 확인·폼·상태를 사용합니다. 서버의 계정/목록 대조, 일부 발송 실패·초안·native 호환 및 검증 범위는 [채널 설정 계약](../../packages/contracts/leave-webhooks.md)을 따릅니다.

공휴일·디스코드 채널 설정의 일반 입력/버튼/표는 모노레포 공통 컨트롤을 사용합니다. 전송 필드와 native handler/CSRF/JSON 원문·웹훅 마스킹은 유지합니다. 저장·삭제 확인 수명주기의 남은 이관과 검사 범위는 [공통 컨트롤 계약](../../packages/contracts/leave-admin-controls.md)을 참고하세요.

사내 연차·월차 신청과 관리를 담당하는 연차 도메인 서비스입니다.

감사 로그의 필터·표·작업 종류 상태 pill·단일 상세 펼치기·오류/권한 안내는 공통 UI를 사용합니다. 기존 관리자 GET과 원문/큰 정수는 유지하며 실패에는 정상 목록 보존, 계정 변경에는 본문 제거를 적용합니다. 계약과 격리 검증은 모노레포 `packages/contracts/leave-audit.md`를 참고하세요.

상태 pill의 색·크기·테마는 공통 UI가 소유합니다. 실제 페이지와 모바일 미리보기 모두 같은 `cw-state-pill` tone을 사용하며, Leave의 전역·페이지 CSS에 별도 상태 팔레트를 다시 만들면 구조 검사가 실패합니다.

승인·취소 승인 대기 제목의 개수는 공통 `cw-count-badge`를 사용합니다. 상태 의미와 단순 수량을 구분하며 Leave CSS는 제목 옆 여백만 조정합니다.

가불 종류와 일수는 승인 대기열·최근 신청·직원 신청 내역·달력 상세에서 공통 warning 상태 pill을 사용합니다. 가불 판정과 월차/연차 차감, 승인·취소 처리의 소유권은 기존 Leave 도메인에 그대로 있습니다.

과거 사용일을 가진 승인 건의 `사용 완료` 보조 상태는 공통 neutral 상태 pill을 사용하며, 승인 상태·날짜 및 취소 가능 여부 판정은 기존 서버 정책을 따릅니다.

모노레포의 새 페이지는 루트 `npm run page:new -- leave <slug> "제목"`으로 만듭니다. 메뉴·주소·제목·기존 서버 정책은 `packages/contracts/pages.json`에서 함께 정의하고 공통 Razor adapter가 `Workspace/*.g.cs`를 생성합니다. 개별 페이지는 본문과 업무 handler만 작성합니다. 루트 `npm run check`와 서버 통합/브라우저 검증을 통과해야 하며 자세한 설명은 `docs/PROJECT_CONTEXT.md`와 루트 `docs/DEVELOPMENT.md`에 있습니다.

`/api/workspace/navigation`은 기존 회사 세션 및 Leave 정책으로 허용 메뉴와 관리자 승인 대기 합계를 반환합니다. 공통 메뉴를 사용해도 서버의 SSO·권한 검증은 그대로 적용되며 실제 연차 데이터/DB와 기존 리디렉션 주소는 유지합니다.

모든 화면은 Company Portal의 공통 워크스페이스 바와 앱 전환 메뉴를 사용합니다. 시스템·라이트·다크 테마는 `*.example.com` 전체에서 공유되며 모바일에서도 같은 서비스 구조로 이동합니다. Leave의 알림 원본과 읽음 상태는 계속 Leave DB가 소유하고, `GET /api/internal/company-notifications`가 Portal 통합 알림센터에 현재 회사 사용자 알림의 읽기 모델만 제공합니다. 이 내부 API는 60초 HMAC Bearer 토큰과 일회용 `jti`를 검증합니다.

직원 계정, 로그인, 재직 상태, 회사 역할과 시스템 접근 권한의 유일한 원본은
[`company-portal`](https://github.com/company-org/company-portal)입니다. LeaveManager는
연차 신청·발생·승인·알림·통계 데이터와 회사 계정에 연결된 로컬 연차 프로필만 보관합니다.

## 회사 시스템 구조

```text
회사 홈 (company.example.com)
  ├─ 연차관리 (leave.example.com)
  └─ CS       (cs.example.com)
```

- 모든 활성 직원은 회사 홈에서 `leave.access`를 기본으로 받으며 별도 권한 설정 없이 Leave에 진입할 수 있습니다.
- 공용 테스트 계정(`accountType=shared`)은 CS·통계 등 선택한 시스템은 이용할 수 있지만 Leave 로그인과 직원 목록에서는 제외됩니다.
- 회사 역할이 `admin` 또는 `master`이면 Portal이 모든 시스템 접근 권한을 포함하며,
  Leave에서는 기존 `Master` 역할로 투영되어 일반·관리자·마스터 페이지 전체에 접근합니다.
- Leave에는 Google OAuth, 로컬 관리자 시드, 독립 계정 생성 기능이 없습니다.
- 직원·접근권한 관리는 회사 홈의 직원 관리 화면에서만 수행합니다.

## 주요 기능

- 연차·반차·월차 신청, 승인, 반려, 취소
- 관리자 전용 특수휴가 기록 및 연차 미차감 처리
- 입사일 기준 자동 발생 및 연차 가불·자동 차감
- 월간 달력과 12개월 연간 달력, 월별 연차 사용량 확인
- 한국 공휴일 연도별 불러오기, 직접 편집 및 JSON 등록
- 앱 알림, 브라우저 알림, Discord 채널 웹훅 및 개인 DM
- 직원별 사용 통계, 감사 로그, SQLite 자동 백업

## Company Portal SSO

1. 사용자가 Leave에 접근합니다.
2. 로컬 세션이 없으면 `company-portal /Auth/leave`로 이동합니다.
3. Portal이 회사 로그인과 계정 활성 상태를 확인하고 기본 `leave.access`를 포함합니다.
4. Portal이 1분 유효 HMAC 토큰을 Leave의 `/auth/sso/callback`으로 POST합니다.
5. Leave가 서명, `aud=leave`, 만료시간, `jti`, 회사 역할을 검증하고 기본 7일 슬라이딩 로컬 세션을 발급합니다.
6. 회사 `admin`/`master`는 Leave의 `Master`, 일반 직원은 `Employee`로 투영됩니다.

배포 순서 호환을 위해 `aud=leave` 로그인 토큰에 `role`이 없을 때만 기존
`leave.master`/`leave.admin` 권한을 회사 역할로 한시 변환합니다. 새 토큰과
`leave-provision` 토큰에는 명시적인 `role`이 필요합니다.

## 직원·권한 프로비저닝

Portal은 직원 또는 접근권한이 변경될 때 durable outbox를 통해 Leave의
`POST /Sso/Provision`으로 `aud=leave-provision` 서명 토큰을 전달합니다. Leave는 서명,
발급자, 만료, `jti`, `active`를 검증하고 다음과 같이 로컬 연차 프로필만 갱신합니다.

`leave.access`는 Portal이 모든 활성 직원에게 자동으로 포함하는 기본 권한입니다. Leave는
서비스 경계의 방어를 위해 로그인·프로비저닝 토큰에서 이 권한을 계속 검증합니다.

- `accountType=employee && active && leave.access`인 직원은 생성 또는 활성화합니다.
- 새 공용 테스트 계정은 로컬 연차 프로필을 만들지 않습니다.
- 기존 직원을 공용 계정으로 바꾸면 프로필을 비활성·숨김 처리하되 과거 신청·지급·정산·감사 기록은 보존합니다.
- 비활성 또는 `leave.access`가 없는 기존 직원은 비활성화하되 기록은 보존합니다.
- 비활성 또는 권한 없는 직원의 로컬 프로필이 아직 없으면 `204 No Content`로 종료합니다.
- 회사 `admin`/`master`는 Leave `Master`, 일반 직원은 Leave `Employee`로 투영합니다.
- 프로비저닝은 로그인 쿠키를 발급하지 않습니다.

정상적으로 provision 이벤트가 도착하면 기존 쿠키는 다음 요청의 로컬 상태 검증에서
거부됩니다. Leave는 인증 요청마다 로컬 직원 투영의 활성 상태와 관리자 역할을 다시
검증하므로, Portal 프로비저닝이 반영되면 기존 로그인 쿠키도 다음 요청에서 즉시 거부됩니다.
세션 유지 시간은 `AUTH_SESSION_HOURS`로 1~168시간 범위에서 조정할 수 있습니다.

기존 연차 직원은 `Employees.CompanyUserId`로 Portal 계정과 연결됩니다. 전환용 이메일
연결은 `CompanyUserId`가 아직 없는 기존 직원에만 허용하며, 이미 다른 회사 계정에 연결된
동일 이메일은 자동 재연결하지 않습니다. 연결 후 회사 이메일이 변경되어도
`CompanyUserId`를 기준으로 기존 `Employee.Id`와 모든 연차 기록을 유지합니다.

## 환경변수

```dotenv
COMPANY_PORTAL_URL=https://company.example.com
COMPANY_SSO_ISSUER=company-portal
COMPANY_SSO_SHARED_SECRET=<Portal/Leave/CS에 동일한 32자 이상 값>
AUTH_SESSION_HOURS=168
```

공유키가 없거나 Portal URL이 안전한 절대 주소가 아니면 앱은 기동하지 않습니다. 실제
공유키는 저장소에 커밋하지 않습니다.

## 직원 정보와 연차 데이터 경계

| 데이터 | 원본 |
| --- | --- |
| 이름, 이메일, 부서, 입사일, 계정 유형, 계정 활성 상태 | Company Portal |
| 회사 역할, 기본 `leave.access`, 선택적 `cs.access` | Company Portal |
| `Employee.Id`, 지급, 신청, 배정, 정산, 감사 기록 | LeaveManager |
| Discord 연결, 알림, 달력 개인 설정 | LeaveManager |

Leave의 직원 연결 화면은 읽기 전용입니다. Portal 변경은 provision 이벤트에서 반영되고,
활성 사용자가 다시 진입할 때는 다음 SSO에서도 이름·이메일·부서·역할 투영을 보정합니다.
입사일은 연차 이력이 없는 프로필에만 Portal 값으로 동기화합니다. 지급·신청·정산 중 하나라도
존재하면 기존 계산 기준과 기록을 보호하기 위해 자동 덮어쓰기하지 않습니다. 입사일 정정은
양쪽 DB를 백업하고 기존 지급·사용 기록의 영향을 검토한 뒤 연차 도메인 보정 절차로
처리해야 합니다.

Portal에서 직원을 삭제하거나 퇴사 처리하더라도 Leave의 `Employee` 행을 영구 삭제하면
안 됩니다. 접근만 비활성화하고 과거 연차·신청·감사 기록은 보존합니다.

## 기술 스택

- .NET 10 / ASP.NET Core Razor Pages
- Entity Framework Core / SQLite
- Docker Compose
- Company Portal HMAC SSO
- Discord OAuth·Bot
- Cloudflare Tunnel

## 실행

```powershell
Copy-Item .env.example .env
docker compose up -d --build
```

- 로컬: `http://localhost:5080`
- 운영: `https://leave.example.com`

## 데이터 보관

- `leave-manager-data` — SQLite DB 및 DB 자동 백업
- `leave-manager-data-keys` — Leave 로컬 세션과 CSRF 보호용 Data Protection 키

기존 운영 DB의 `Employees.CompanyUserId`는 nullable unique index를 사용합니다. 과거 임시
구조의 `SystemPermissions` 컬럼은 물리 DB에 남을 수 있지만 애플리케이션에서는 사용하거나
새로 생성하지 않습니다.

## 개발 문서

프로젝트 구조, 연차 정책, Portal SSO, 데이터 경계, DB 변경 규칙은
[`docs/PROJECT_CONTEXT.md`](docs/PROJECT_CONTEXT.md)를 확인합니다.

## 통합 워크스페이스 UI (2026-09-07)

- 상단바는 Company Portal의 `/js/company-workspace.js`, `/css/company-workspace.css`를 공통 사용합니다. 로고의 홈 이동, 종 모양 알림, 개인 설정/로그아웃, 권한별 서비스 전환, 테마를 한 곳에서 제공합니다.
- Leave 전용 종 버튼·상단 숫자 배지·알림 팝오버는 만들지 않습니다. 알림 본문 목록과 읽음 처리는 Leave가 소유하지만, 상단 알림 표시는 공통 셸만 소유합니다.
- 서비스 내부 메뉴는 `.cw-sidebar`에만 배치합니다. 각 서비스에 별도 계정·알림·테마·회사 홈 버튼을 추가하지 않습니다. 900px 이하에서는 상단 메뉴 버튼으로 하위 메뉴를 엽니다.
- 테마는 의미별 `--cw-*` 토큰을 사용합니다. 선택/미선택 상태는 `aria-current` 또는 `aria-pressed`와 함께 표현하며 색 반전 필터를 사용하지 않습니다.
- `/api/workspace/context`가 실제 계정과 허용된 서비스만 반환합니다. 관리자 계정은 모든 서비스를, 공용 계정은 부여받은 서비스만 볼 수 있습니다. 화면 숨김과 별개로 각 서비스 백엔드도 권한을 검증합니다.
- 개인 설정 `/settings/profile`: 사진만 변경 가능합니다. 브라우저에서 가운데를 256×256 PNG로 변환하고 서버에서 크기/CRC/압축 해제 크기를 검증합니다. 이름·부서·역할 수정 API는 제공하지 않습니다.
- SSO 토큰과 서비스 세션에 `sid`가 포함됩니다. 서비스는 HMAC 서명된 60초 토큰(`aud=workspace-session`)으로 Portal의 `/api/internal/workspace/session`에서 세션과 최신 권한을 확인합니다. 로그아웃은 현재 브라우저의 sid를 폐기하므로 모든 하위 서비스의 기존 세션이 거부되며 다른 기기의 세션은 유지됩니다.
- 내부 인증 연결 실패는 503으로 실패 처리하며 인증을 우회하지 않습니다. Node 서비스의 내부 주소는 `COMPANY_PORTAL_INTERNAL_URL`(기본 `http://company-portal:8080`), Leave는 `CompanyPortal:InternalUrl`, Schedule은 `Portal:InternalUrl`입니다. Docker `company-services` 네트워크와 서비스 간 동일 SSO 키가 필요합니다.
- 알림 원본 DB는 각 서비스에 남습니다. 내부 GET `/api/internal/company-notifications?format=workspace-v2`는 `{items,unreadCount}`, 형식 미지정은 기존 배열을 반환합니다. 내부 POST `.../read?id=ID` / `.../read`는 서명 토큰의 사용자 소유 알림만 읽음 처리합니다. Portal은 권한 있는 출처만 조회하며 일부 실패를 UI에 표시합니다.
- Portal의 쓰기 API는 인증 쿠키와 `X-Workspace-CSRF`를 함께 검증하고 허용된 서비스 origin에만 CORS를 제공합니다. 각 서비스 CSP의 `connect-src`, `img-src`는 `https://company.example.com`을 허용합니다.
- 배포 시 Portal DB와 DataProtection 키를 백업하고 Portal 및 모든 하위 서비스를 함께 갱신합니다. 새 `WorkspaceSessions`/`WorkspaceProfiles` 테이블은 추가 방식이며 기존 직원·업무 데이터를 이동/삭제하지 않습니다. 구버전 서비스 세션은 최초 접근 시 한 번 SSO 재연결이 필요할 수 있습니다.

## 날짜 상세 공통 팝업

신청/날짜 상세의 일반 필드·작업 버튼과 목록 취소/철회는 공통 native UI를 사용합니다. 입력 원문·필수값/길이·직원 검색·초안/저장 정책은 유지하며 자세한 경계는 `packages/contracts/leave-dashboard-controls.md`를 따릅니다.

월간 달력 상세는 공통 `CompanyDialog.attach`와 `.cw-modal`을 사용합니다. 키보드 날짜 선택, 닫은 뒤 포커스 복귀, 중첩 확인창과 초안 보존을 지원합니다. 신청/취소·외부 일정·관리자 폼의 서버 정책은 유지하며 연결/해제와 남은 UI 범위는 모노레포 `packages/contracts/leave-day-detail.md`를 따릅니다.
