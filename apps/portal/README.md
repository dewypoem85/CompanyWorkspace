# Company Portal

개인 설정·통합 알림·서비스 직접 진입 버튼은 공통 `cw-button`을 사용합니다. 사진/프로젝트 아이콘 버튼의 배치와 실행·권한 처리는 유지하며 별도 disabled 색을 복제하지 않습니다. 상세는 [계정 작업 버튼 계약](../../packages/contracts/account-action-controls.md)을 참고하세요.

회사 홈의 `N개 서비스 사용 가능` 요약과 서비스 카드의 `사용 가능`, 관리자 카드의 `관리자` 표시는 공통 success/warning 상태 pill을 사용합니다. 실제 서비스 노출과 진입 경로는 서버가 계산한 허용 시스템 목록 및 관리자 역할을 그대로 따릅니다.

## 계정·조직 관리 공통 UI

신규 계정과 기존 직원 수정은 동일 필드 렌더러 및 공통 입력·작업 버튼·표를 사용합니다. 비공개 직원과 신규 권한 카드, 부서·프로젝트의 비공개/보관도 공통 checkbox를 사용하고 검색형 프로젝트·직원 목록은 공통 선택 그룹을 사용합니다. 기존 직원 권한표는 공통 compact switch를 사용하며 Portal에는 표 배치와 권한 문구만 둡니다. 읽기 전용 계정 유형·활성/비활성·기본/전체 권한과 공용 계정의 연차 제외 결과는 공통 상태 pill을 사용합니다. 관리자·마스터 역할 제한과 일괄 저장/되돌리기를 양쪽에서 유지하며 스타일 전환으로 기존 저장 응답·충돌 복구·서버 권한 정책을 바꾸지 않습니다. 남은 링크 범위와 검증은 루트 `packages/contracts/portal-controls.md`를 참고하세요.

## 부서·프로젝트 저장

조직 정보는 공통 확인창에서 대상과 이름을 확인한 뒤 공통 폼으로 저장합니다. 서버가 현재 계정·기존 수정 버전과 권한을 검증하고 커밋된 결과를 확인한 경우에만 해당 조직의 수정 화면을 다시 엽니다. 충돌·권한 변경·통신/형식 오류는 초안을 남기고 반복 저장을 잠급니다. **새 탭에서 최신 정보 확인**으로 현재 내용을 확인하세요. 자동 재전송이나 버전 덮어쓰기는 하지 않습니다.

일반 HTML POST 실패도 원래 버전과 업무 입력 원문을 남깁니다. 현재 목록에 없는 직원 ID 등은 원문으로 보관하고 재제출을 잠급니다. 화면을 닫은 이후의 초안 복구는 지원하지 않습니다. 이전 버전에서 열어 둔 폼에는 계정 기준값이 없으므로 새 문서에서 다시 작업해야 합니다.

프로젝트 아이콘은 프로필과 같은 공통 이미지 편집기에서 별도 저장합니다. 서버가 현재 계정·프로젝트·기존 아이콘 버전을 대조하고, 저장된 아이콘은 공통 context 갱신 신호로 다른 표시 위치에도 전달합니다. 오류/충돌은 파일 초안을 유지하며 **현재 사진 다시 확인**은 조회만 수행합니다. 아이콘 저장으로 작성 중인 이름·참여자 등 조직 초안을 바꾸지 않습니다.

파일을 선택했거나 아이콘 작업 중이면 조직 저장에 따른 화면 이동을 막습니다. 아이콘을 저장하거나 파일 선택을 해제한 뒤 조직 정보를 저장하세요. 조직 전송 중에는 아이콘 편집을 잠급니다. **아이콘과 조직 정보는 별도 트랜잭션입니다.** 실제 multipart 폼과 호환 raw API의 범위는 `packages/contracts/project-icons.md`를 확인하세요. 두 폼의 요청 본문 제한은 1MiB입니다.

## 개인 프로필 사진 설정

설정 화면은 공통 `CompanyImageEditor`를 `CompanyProfile`로 연결하고 `CompanyForm`/`CompanyState`/`CompanyDialog`를 사용합니다. 사진을 256×256 PNG로 준비한 뒤 실제 `/settings/profile` multipart 폼으로 저장하며, 계정과 기존 사진 버전을 서버에서 대조합니다. 오래된 화면의 덮어쓰기/삭제를 거부하고 미확정 요청은 자동 재전송하지 않습니다. 저장 완료와 이후 화면 갱신 실패도 구분합니다. 이름·이메일·권한은 변경하지 않습니다.

기존 raw 사진 API와 새 폼은 같은 `AvatarStore`·PNG 검증·DB를 사용합니다. raw API는 호환을 위해 버전 없는 기존 동작을 유지하며, 새 화면은 공통 폼 경로를 사용해야 합니다. 계약과 테스트 범위는 루트 `packages/contracts/profile.md`, `docs/DEVELOPMENT.md`를 확인하세요.

## 통합 워크스페이스 셸과 알림센터

공통 `CompanyNotificationSession`이 조회/읽음 요청·계정 범위·timeout을 관리합니다. 새 요청은 `expectedUserId`를 보내 현재 인증 계정과 서버에서 대조하며, 쿼리가 없는 기존 요청은 배포 호환을 위해 유지합니다. 읽음은 정확한 204 응답을 확인한 후 완료로 표시하고, 이후 조회 실패는 별도 안내합니다. 미확정 결과는 자동 재전송하지 않습니다. 계정/권한 범위가 바뀌면 이전 알림 본문과 배지를 지우고 현재 계정 페이지를 다시 열도록 합니다. 모바일 알림 카드와 미읽음 강조는 공통 테마 색을 사용합니다.

통합 알림 API의 `sourceId`는 큰 ID 정밀도를 보존하는 십진 문자열입니다. 공통 셸과 알림센터는 `CompanyNotificationContract`를 사용하며 임의 숫자 변환을 하지 않습니다. 내부 알림 서비스의 `long`과 소유자 인가는 유지합니다. 공개 계약/호환 범위는 모노레포 `packages/contracts/notifications.md`, 실제 API 검증은 `PortalNotificationTests`를 확인하세요.

Portal은 직원·조직·역할·서비스 접근권한의 원본인 동시에 사내 웹 도구의 공통 진입점입니다. `/workspace/{service}`를 정식 서비스 진입 경로로 사용하며 기존 `/Auth/{service}` SSO 경로와 각 서비스 서브도메인은 호환 주소로 유지합니다.

모노레포에서 공통 상단 바·메뉴·테마의 원본은 `packages/workspace-ui`입니다. 이 앱의 `wwwroot/js/company-workspace.js`와 `wwwroot/css/company-workspace.css`는 기존 자산 URL과 독립 Docker 배포를 유지하는 생성 결과이며 직접 수정하지 않습니다. 테마는 `CompanyUiTheme` 도메인 쿠키로 `*.example.com` 전체에 공유하며 로컬 개발에서는 localStorage로 폴백합니다.

회사 홈의 일반 Razor 페이지는 루트 `packages/contracts/pages.json`에서 `home` 서비스로 등록합니다. 제목·주소·익명 여부/서버 policy·메뉴를 함께 정의하며 `Workspace/*.g.cs`는 공통 C# adapter로 생성됩니다. `_Layout`이 공통 상단 바·사이드바·제목을 소유하고 페이지는 본문과 업무 handler만 유지합니다. 부서/프로젝트 관리의 기존 `tab`·`id` 쿼리 및 Google 로그인·로그아웃·SSO 전달 경로는 유지합니다.

루트에서 `npm run page:new -- home <slug> "제목"`으로 생성한 뒤 `npm run check`, 서버 통합 검사, `npm run test:browser`를 실행합니다. 기본 새 페이지는 `EmployeeOnly`이며 관리자 전용은 계약에 기존 서버 policy를 지정합니다. `/api/workspace/navigation`은 실제 ASP.NET 인가 결과로 허용된 메뉴 ID만 반환하며 클라이언트 role 값으로 권한을 추정하지 않습니다. 새 API/handler의 업무 데이터 인가는 별도로 유지해야 합니다. 자세한 절차는 루트 `docs/DEVELOPMENT.md`를 참고합니다.

`/notifications`는 Leave와 Schedule의 서비스별 알림 읽기 모델을 Docker 내부 API로 병렬 집계합니다. 알림 원본과 읽음 상태는 각 서비스 DB에 남고 Portal DB로 복제하지 않습니다. 내부 조회는 기존 SSO 공유키로 서명한 60초 HMAC Bearer 토큰과 요청별 `jti`를 사용하며, 한 소스가 실패해도 다른 서비스 알림은 계속 표시합니다. 내부 연결에도 공식 Host 헤더(`leave.example.com`, `schedule.example.com`)를 보내 서비스의 외부 도메인 전용 Host 검증을 유지하고, 필요하면 `LEAVE_INTERNAL_HOST_HEADER`, `SCHEDULE_INTERNAL_HOST_HEADER`로 재정의할 수 있습니다.

## 계정 입력 구조 (모노레포)

등록·단건 수정·일괄 수정은 루트 `packages/contracts/account-fields.json`에서 생성한 `Workspace/AccountFields.g.cs`의 입력 모델을 공유합니다. `Pages/Shared/_AccountField.cshtml`이 양쪽 화면의 입력을 렌더링하며 `UsersModel`의 `InputFor`/`Prepare`/`Apply`가 기존값 조회·검증·저장을 담당합니다. 생일 입력은 출생 연도 없이 `MM-DD`만 사용하고 Leave 전용 토큰에도 같은 월·일만 전달합니다. 새 설정은 한쪽 화면에 직접 추가하지 말고 루트 `docs/DEVELOPMENT.md`의 필드 변경 절차를 따르세요.

비공개 직원 설정의 실제 입력은 상세 편집에 한 개만 존재합니다. 표의 공개 범위 버튼은 그 상세를 열고 현재값을 표시합니다. 변경 취소와 계정 유형을 다시 직원으로 돌릴 때 입력 중인 소속/프로젝트/입사일이 복원됩니다. 서버 권한 검사·버전 충돌 차단·Leave 투영 outbox는 유지됩니다. 신규 계정의 활성 여부도 같은 필드로 설정하며 기본값은 활성입니다.

## 팀 일정 연동 API

`schedule` 시스템은 모든 활성 실제 직원에게 `schedule.access`를 기본 제공합니다. 기본 URL은 `https://schedule.example.com`이며 `SCHEDULE_BASE_URL`로 변경합니다. SSO audience는 `schedule`, callback은 `/auth/sso/callback`입니다.

`GET /api/internal/schedule/employees`는 일정 서버만 사용하는 읽기 전용 직원 목록입니다. `iss=company-schedule`, `aud=schedule-directory`, `sub=schedule`, 60초 만료와 일회용 `jti`를 포함한 HMAC Bearer 토큰을 기존 공유키로 검증합니다. ID·이름·부서·역할·활성 여부·공용 계정 여부·일정 접근 여부만 반환하고 이메일·인사 상세는 내보내지 않습니다. 내부 API 경로만 HTTPS 리디렉션을 제외하여 Docker 내부 HTTP 호출을 수용하며 인증 검증은 항상 적용합니다.

일정 앱은 60초 이내에 목록을 갱신하고 변경 작업 전에 다시 확인합니다. 직원 정보의 원본은 계속 Portal입니다.

`company.example.com`은 회사 직원·공용 테스트 계정, 재직 상태, 회사 역할, 사내 시스템 접근권한의 유일한 관리 원본입니다. Leave, CS와 Statistics는 자체 계정 목록으로 로그인하지 않고 Portal이 발급한 짧은 수명의 SSO 토큰을 검증합니다.

## 서비스 구조

```text
회사 홈 (company.example.com)
├─ 팀 일정   (schedule.example.com)
├─ 연차관리 (leave.example.com)
├─ CS       (cs.example.com)
├─ 게임 통계 (statistics.example.com)
└─ 시트 관리 (sheet.example.com)
```

회사의 직원 기본정보와 접근권한은 Portal에서만 변경합니다. Leave는 연차 계산과 과거 기록을 연결하기 위해 `CompanyUserId`가 붙은 로컬 업무 프로필을 유지하고, CS는 별도 직원 DB를 두지 않습니다.

## 회사 역할과 접근권한

- `직원`: 연차관리는 기본으로 접근하고, 그 밖의 시스템은 명시적으로 선택한 경우 접근
- `공용 테스트 계정`: 실제 직원이 아닌 QA·운영용 Google 계정. 연차관리에서는 제외하고 CS·통계 등 선택한 시스템만 접근
- `관리자`: 등록된 모든 사내 시스템 접근, 일반 직원 정보·활성 상태·접근권한 관리
- `마스터`: 관리자 기능을 포함하며 관리자·마스터 역할까지 지정

현재 일반 직원의 시스템 정책은 다음과 같습니다.

- `leave.access` — 모든 활성 직원에게 자동으로 포함되는 연차관리 기본 접근
- `cs.access` — 관리자 화면에서 선택적으로 부여하는 CS 전체 접근(조회, Steam 환불, PlayFab 지급·회수 포함)
- `statistics.access` — 관리자 화면에서 선택적으로 부여하는 게임 로그 통계 접근

관리자와 마스터는 개별 체크 여부와 관계없이 모든 등록 시스템에 접근합니다. 관리자는 다른 관리자나 마스터를 변경할 수 없고, 마지막 활성 마스터는 비활성화하거나 강등할 수 없습니다.

공용 테스트 계정에는 관리자·마스터 역할을 부여할 수 없습니다. 여러 사람이 같은 Google 계정을 사용하면 하위 서비스 감사 기록도 같은 계정으로 남으므로 필요한 접근권한만 최소한으로 부여해야 합니다. 공용 계정을 실제 직원으로 바꾸면 Leave 투영을 생성·복구하고, 직원을 공용 계정으로 바꾸면 기존 연차 이력은 보존한 채 Leave에서 비활성·숨김 처리합니다.

직원 관리 화면은 전 직원의 활성 상태, 회사 역할, 기본 연차 접근, CS와 통계 권한을 행렬 형태로 표시합니다. 여러 직원의 값을 연속으로 바꾼 뒤 `전체 변경 저장` 한 번으로 반영하며, 변경된 직원만 Leave 투영 outbox에 다시 등록합니다. 인사 기본정보도 각 행의 `정보` 영역에서 수정한 뒤 같은 일괄 저장에 포함할 수 있습니다. 저장은 단일 DB 트랜잭션으로 처리되어 중복 이메일, 동시 수정, 마지막 활성 마스터 강등 같은 검증이 하나라도 실패하면 일부 직원만 저장되지 않습니다.

상단 테마 선택에서 시스템·라이트·다크 모드를 고를 수 있으며 선택값은 브라우저에 보관됩니다.

## 로그인과 SSO

1. 직원은 Company Portal에서 Google 계정으로 로그인합니다.
2. Portal은 등록 이메일, 활성 상태, 회사 역할을 확인합니다.
3. 홈에서 서비스 카드를 누르면 Portal이 해당 서비스 audience의 1분짜리 HMAC 토큰을 POST합니다.
4. 하위 서비스는 서명, issuer, audience, 만료, 접근권한을 검증한 뒤 짧은 로컬 세션을 만듭니다.

회사 홈 로그인은 기본 7일 동안 유지되며 사용 중에는 자동 갱신됩니다. 쿠키 수명과 관계없이 Portal은 매 요청마다 계정 활성 상태, 역할, 접근권한 스냅샷을 데이터베이스와 비교하므로 퇴사 처리나 권한 변경은 다음 요청부터 적용됩니다. `AUTH_SESSION_HOURS`로 1~168시간 범위에서 조정할 수 있습니다.

Google OAuth 설정은 Portal 하나만 필요합니다.

- 승인된 JavaScript 원본: `https://company.example.com`
- 승인된 리디렉션 URI: `https://company.example.com/signin-google`

`leave.example.com`, `cs.example.com`이나 `statistics.example.com`을 Google OAuth에 페이지마다 추가하지 않습니다.

## Leave 직원 투영 동기화

Leave의 `Employee`는 별도 계정 원본이 아니라 연차 기록을 연결하기 위한 읽기 전용 투영입니다. Portal에서 직원을 추가하거나 이름, 이메일, 부서, 입사일, 활성 상태, 회사 역할을 변경하면 같은 DB 트랜잭션에서 사용자별 outbox가 갱신됩니다. 연차 접근은 모든 활성 직원에게 자동으로 포함됩니다. 네트워크 전송 실패는 Portal의 계정 변경을 되돌리지 않으며 outbox에 남아 지수 backoff로 계속 재시도됩니다.

worker는 `LEAVE_BASE_URL`의 `/Sso/Provision`에 다음 계약의 1분짜리 HMAC 토큰을 form POST합니다.

- audience: `leave-provision`
- form 필드: `token`
- 사용자 필드: `sub`, `name`, `email`, `department`, `hireDate`, `accountType`, `active`, `role`, `permissions`; `birthDate`는 Leave 대상 토큰에만 포함
- 공통 검증 필드: `iss`, `aud`, `iat`, `exp`, `jti`

한 사용자에게 변경이 연속으로 발생하면 outbox의 단일 행과 단조 증가하는 version으로 최신 상태만 남깁니다. 전송 중 더 최신 변경이 저장된 경우 이전 전송의 성공 처리나 실패 backoff가 새 행을 삭제·지연하지 못하도록 version 조건으로 갱신합니다. Portal 시작 시 pending 행이 없는 실제 직원 계정을 큐에 넣어 Leave 투영을 다시 조정하므로 기본 권한이나 투영 계약이 바뀌어도 기존 직원에게 적용됩니다. 신규 공용 테스트 계정은 Leave에 전송하지 않으며, 기존 직원을 공용 계정으로 전환할 때만 비활성화 이벤트를 전송합니다.

운영 Compose에서는 기본으로 활성화됩니다.

```dotenv
LEAVE_PROVISIONING_ENABLED=true
LEAVE_PROVISIONING_TIMEOUT_SECONDS=10
```

비활성화하는 동안에도 계정 변경은 outbox에 보존되며, 다시 활성화한 후 전송됩니다.

## 새 사내 시스템 추가

1. `Models/CompanySystemCatalog.cs`에 키, audience, 표시명, 설명, 접근권한, Base URL 설정 키와 일반 직원 기본 제공 여부를 추가합니다.
2. `appsettings.json`, `.env.example`, `docker-compose.yml`에 Base URL을 추가합니다.
3. 새 서비스에 `/auth/sso/callback` 토큰 검증과 해당 `*.access` 검사를 구현합니다.
4. Portal과 새 서비스에 동일한 `COMPANY_SSO_SHARED_SECRET` 및 issuer를 설정합니다.

홈 카드, 관리자 권한 체크박스, SSO 라우팅은 공통 카탈로그를 사용하므로 별도 Razor 조건을 추가하지 않습니다. 기본 제공 시스템은 활성 직원의 유효 권한에 자동 포함되고 관리자 화면의 추가 권한 체크박스에는 나타나지 않습니다.

## 실행

```powershell
Copy-Item .env.example .env
docker compose up -d --build
```

기본 로컬 바인딩은 `127.0.0.1:5090`입니다. 공유키는 32자 이상이어야 하며 Portal, Leave, CS에서 정확히 같아야 합니다.

```bash
openssl rand -base64 48
```

## 데이터와 스키마 전환

- `company-portal-data` — 계정/역할/권한 SQLite DB
- `company-portal-data-keys` — ASP.NET Core Data Protection 키

시작 시 additive 스키마 전환이 `IsAdmin`, `IsSharedAccount` 열과 `LeaveProjectionOutbox` 테이블을 추가합니다. 기존 계정은 모두 실제 직원으로 유지됩니다. 기존 중앙화 작업에서 `leave.admin` 또는 `leave.master`를 가진 사용자는 회사 `관리자`로 한 번 승격됩니다. 회사 `마스터`로는 승격하지 않습니다. 이후 역할 변경을 재실행 시 덮어쓰지 않습니다.

기존 Leave 직원을 처음 연결해야 할 때만 컨테이너를 중지하고 일회성 importer를 실행합니다.

```powershell
docker run --rm `
  -v company-portal-data:/portal `
  -v leave-manager-data:/leave `
  company-portal-company-portal:latest `
  import-leave-employees /portal/company-portal.db /leave/leave-manager.db
```

Importer는 양쪽 DB를 먼저 각 volume의 `backups/`에 복사하고 이메일로 계정을 연결합니다. 기존 Leave `Admin`/`Master`는 회사 `관리자`가 되며, Leave 요청·부여·정산·감사 기록과 로컬 `Employee.Id`는 변경하지 않습니다.

## 내부 인증 연결 확인

- Docker 배포의 `AllowedHosts`에는 공개 호스트 설정과 별도로 내부 DNS 이름 `company-portal`을 반드시 포함합니다. Compose가 이 이름을 추가하므로 기존 `ALLOWED_HOSTS` 환경 설정을 유지해도 적용됩니다. 와일드카드로 호스트 검증을 해제하지 않습니다.
- Node fetch 런타임에 따라 지정한 `Host` 헤더 대신 URL의 호스트가 전송됩니다. 내부 주소 `http://company-portal:8080` 자체를 허용해야 CS·통계·시트의 세션 검증 요청이 HTTP 400으로 차단되지 않습니다. 세션 서명·만료·현재 접근 권한 검증은 그대로 수행합니다.
- `/health` 성공만으로 로그인된 페이지가 정상이라고 판단하지 않습니다. 배포 후 각 Node 컨테이너에서 아래 의존성 점검을 수행합니다. 비인증 요청의 기대 응답은 401이고, 400·리디렉션·연결 오류는 실패입니다. 이 점검은 네트워크/호스트 검증용이며 실제 로그인·권한별 페이지 접근 검증을 대체하지 않습니다.

```powershell
@('steam-refund-cs','game-statistics','sheet-control') | ForEach-Object {
    Get-Content -Raw scripts/check-portal-connection.mjs | docker exec -i $_ node --input-type=module
    if ($LASTEXITCODE -ne 0) { throw "Portal dependency check failed: $_" }
}
```

## 배포 순서

1. Portal/Leave DB 백업
2. `leave-provision` 토큰과 `/Sso/Provision`을 수용하는 Leave 배포
3. 새 로그인 토큰의 `role`을 수용하는 CS 배포
4. Company Portal 배포 및 스키마 전환
5. 직원/관리자/마스터 계정으로 홈 카드, 직접 URL 복귀, 권한 차단, 관리 작업의 실제 사용자 감사기록 확인

## 검증

GitHub Actions는 restore, Release build, 취약 NuGet 패키지 검사, Docker image build를 수행합니다.

## 부서·프로젝트 중앙 관리

`/Admin/Users`의 직원·부서·프로젝트 탭에서 조직 정보를 관리합니다. 직원은 부서 하나와 프로젝트 여러 개에 참여할 수 있으며, 공유 계정은 참여자/책임자에서 제외합니다. 일반 관리자는 관리자·마스터 직원의 참여 관계나 책임자 지정을 바꿀 수 없습니다. 부서명 변경은 동일 ID를 유지하고 소속 직원의 부서명을 기존 연차 outbox로 전달합니다.

`GET /api/internal/schedule/directory`는 기존 `schedule-directory` audience와 동일한 서비스 인증을 요구하며 `schemaVersion,employees,departments,projects,memberships,leads` 스냅샷을 반환합니다. 이메일·입사일은 포함하지 않습니다. 기존 `/employees` 배열 계약은 유지됩니다.

최초 전환은 포털과 일정 서비스를 중지하고 두 DB 및 이미지·인증 키를 백업한 다음 실행합니다. `--apply`가 없으면 임시 복사본에서만 검사합니다. 신규 포털에 조직 정보를 입력하기 전에 기존 일정 프로젝트와 책임자를 먼저 가져와야 합니다.

```powershell
dotnet CompanyPortal.dll import-schedule-organization /portal/company-portal.db /schedule/schedule.db
dotnet CompanyPortal.dll import-schedule-organization /portal/company-portal.db /schedule/schedule.db --apply
```

이전 완료 기록을 남기므로 재실행은 기존 관리 정보를 덮어쓰지 않습니다. 기존 프로젝트 ID·색상·보관 상태를 유지하며 업무 이력에서 참여자를 추정하지 않습니다. 유효하지 않은 과거 책임자는 제외 개수를 출력합니다. 포털 프로젝트가 이미 있는데 이전 완료 기록이 없으면 충돌 확인을 위해 중단합니다.

이전 후 조직 변경은 포털에서만 수행합니다. 일정 앱은 60초 이내 및 쓰기 직전에 갱신합니다. 일정 앱의 조직 복사본을 수정하거나 구버전 프로젝트 관리 API를 다시 활성화하지 않습니다.

## 통합 워크스페이스 UI (2026-09-07)

- 사이드바 접기(2026-09-08): 공통 `.cw-sidebar` 오른쪽 위 접기 버튼과 상단 다시 열기 버튼을 제공합니다. 데스크톱에서 접으면 본문이 넓어지고 `CompanySidebarCollapsed` 쿠키로 `*.example.com` 간 선택을 기억합니다. 모바일 열림 상태는 데스크톱 설정과 분리하며 메뉴 선택·바깥 클릭·Escape로 닫습니다. 숨긴 메뉴는 inert/aria-hidden 처리하고 키보드 포커스를 보이는 버튼으로 옮깁니다. React로 늦게 생성되는 사이드바에도 중복 없이 적용됩니다. 회귀 테스트: `node --test tests/sidebar.test.cjs`.
- 상단 서비스 전환(2026-09-08): 공간이 충분하면 로고 오른쪽에 권한이 있는 서비스 링크를 나란히 표시하고 현재 서비스를 강조합니다. 링크·계정 영역의 실제 너비를 ResizeObserver로 측정하여 부족하면 서비스 버튼으로 접습니다. 두 모드 모두 동일한 context.services와 Portal SSO 진입 링크를 사용합니다. 숨겨진 링크는 inert/aria-hidden 처리하며 키보드 포커스도 표시 중인 컨트롤로 이동합니다. 회귀 테스트: `node --test tests/service-navigation.test.cjs`.

- 프로필 사진은 Portal의 인증된 `context.profiles`(직원 ID → 버전 포함 이미지 URL)로 공유합니다. SSO 토큰에 사진을 복사하지 않습니다. 공통 상단바, 직원 관리, 팀 일정의 직원·댓글·멘션 모두 같은 원본을 사용합니다.
- 사진 변경/삭제는 인증 정보가 없는 `CompanyProfileRevision` 변경 신호로 같은 브라우저의 다른 서비스에도 반영합니다. 탭 복귀 시 다시 조회하며, 다른 기기에서의 변경은 기존 주기 갱신으로 반영합니다. 사진이 없거나 로딩에 실패한 경우에만 이름 첫 글자를 표시합니다.

- 상단바는 Company Portal의 `/js/company-workspace.js`, `/css/company-workspace.css`를 공통 사용합니다. `packages/workspace-ui/assets/company-logo.png`의 실제 회사 로고를 상단 브랜드와 모든 공용 셸 브라우저 탭 아이콘에 사용하며, 로고의 홈 이동, 종 모양 알림, 개인 설정/로그아웃, 권한별 서비스 전환, 테마를 한 곳에서 제공합니다.
- 서비스 내부 메뉴는 `.cw-sidebar`에만 배치합니다. 각 서비스에 별도 계정·알림·테마·회사 홈 버튼을 추가하지 않습니다. 900px 이하에서는 상단 메뉴 버튼으로 하위 메뉴를 엽니다.
- 테마는 의미별 `--cw-*` 토큰을 사용합니다. 선택/미선택 상태는 `aria-current` 또는 `aria-pressed`와 함께 표현하며 색 반전 필터를 사용하지 않습니다.
- `/api/workspace/context`가 실제 계정과 허용된 서비스만 반환합니다. 관리자 계정은 모든 서비스를, 공용 계정은 부여받은 서비스만 볼 수 있습니다. 화면 숨김과 별개로 각 서비스 백엔드도 권한을 검증합니다.
- 개인 설정 `/settings/profile`: 사진만 변경 가능합니다. 브라우저에서 가운데를 256×256 PNG로 변환하고 서버에서 크기/CRC/압축 해제 크기를 검증합니다. 이름·부서·역할 수정 API는 제공하지 않습니다.
- SSO 토큰과 서비스 세션에 `sid`가 포함됩니다. 서비스는 HMAC 서명된 60초 토큰(`aud=workspace-session`)으로 Portal의 `/api/internal/workspace/session`에서 세션과 최신 권한을 확인합니다. 로그아웃은 현재 브라우저의 sid를 폐기하므로 모든 하위 서비스의 기존 세션이 거부되며 다른 기기의 세션은 유지됩니다.
- 내부 인증 연결 실패는 503으로 실패 처리하며 인증을 우회하지 않습니다. Node 서비스의 내부 주소는 `COMPANY_PORTAL_INTERNAL_URL`(기본 `http://company-portal:8080`), Leave는 `CompanyPortal:InternalUrl`, Schedule은 `Portal:InternalUrl`입니다. Docker `company-services` 네트워크와 서비스 간 동일 SSO 키가 필요합니다.
- 알림 원본 DB는 각 서비스에 남습니다. 내부 GET `/api/internal/company-notifications?format=workspace-v2`는 `{items,unreadCount}`, 형식 미지정은 기존 배열을 반환합니다. 내부 POST `.../read?id=ID` / `.../read`는 서명 토큰의 사용자 소유 알림만 읽음 처리합니다. Portal은 권한 있는 출처만 조회하며 일부 실패를 UI에 표시합니다.
- Portal의 쓰기 API는 인증 쿠키와 `X-Workspace-CSRF`를 함께 검증하고 허용된 서비스 origin에만 CORS를 제공합니다. 각 서비스 CSP의 `connect-src`, `img-src`는 `https://company.example.com`을 허용합니다.
- 배포 시 Portal DB와 DataProtection 키를 백업하고 Portal 및 모든 하위 서비스를 함께 갱신합니다. 새 `WorkspaceSessions`/`WorkspaceProfiles` 테이블은 추가 방식이며 기존 직원·업무 데이터를 이동/삭제하지 않습니다. 구버전 서비스 세션은 최초 접근 시 한 번 SSO 재연결이 필요할 수 있습니다.

## 직원 상세 펼치기 공통화 (2026-09-10)

- 기존 직원의 정보/공개 범위 버튼은 공통 `CompanyDisclosure`로 같은 상세 행을 제어합니다. 여러 직원의 상세를 함께 펼칠 수 있습니다.
- 검색으로 행이 숨겨지면 상세와 버튼의 펼침 상태도 함께 닫힙니다. 검색을 해제한 뒤 다시 열어도 작성한 값·프로젝트 선택·비공개 설정과 저장 충돌 검사 버전은 보존됩니다. 접기/검색은 저장이나 초기화를 실행하지 않습니다.
- 키보드 Enter/Space 및 여러 버튼의 ARIA 상태는 공통 컴포넌트에서 관리합니다. 표 스크롤과 상세 폼 너비를 분리하는 기존 모바일 규칙을 유지합니다. 서버 계정 편집 권한과 일괄 저장 계약은 변경하지 않았습니다.

## 공통 초성 검색 (2026-09-09)

- 직원·프로젝트 검색형 선택창, 회사 직원 목록 및 조직 체크 목록은 `CompanySearch.createMatcher`를 공유합니다.
- `ㄹㅈㅈ`, `라ㅈㅈ`처럼 초성/혼합 검색을 지원합니다. 영문 대소문자, 띄어쓰기, 분해된 한글 입력을 정규화하며 특수문자는 정규식이 아닌 문자 그대로 검색합니다.
- 필터는 이미 제공된 목록만 대상으로 하며 비공개/권한 필터와 선택값·폼 제출 동작을 변경하지 않습니다.
- 셸 JS 및 선택창 JS 버전은 `20260909.1`입니다. `node --test tests/*.test.cjs`에 한글 전체 11,172음절을 포함한 회귀 검증이 있습니다.

## 직원 관리 화면 및 기존 계정 변경 검증 (2026-09-08)

- 기존 직원의 비공개 설정은 **정보 → 비공개 직원** 또는 권한 표의 **상태 · 공개 범위 → 비공개 직원**에서 변경합니다. 두 컨트롤은 즉시 동기화되며 서버에는 하나의 값만 전송합니다. **전체 변경 저장**으로 일괄 적용합니다. 관리자/마스터 계정 편집은 기존처럼 마스터만 가능합니다.
- 신규/기존 직원 편집의 부서·입사일 입력 크기를 통일하고 참여 프로젝트는 별도 전체 너비 영역으로 표시합니다. 신규 등록에서도 프로젝트 아이콘과 비공개 표시를 제공합니다.
- 상단 7개 현황 카드에도 공통 테마 색상을 적용하며, 카드 최소 너비에 따라 열 수를 조절합니다.
- 계정 관리 전용 CSS는 공통 테마 토큰을 사용합니다. 다크모드 표 배경·수정 행·권한 스위치 상태를 구분하고, 모바일에서는 표 내부만 가로 스크롤합니다.
- Schedule 통합 테스트의 `ExistingEmployeePrivacyAndOrganizationRoundTripThroughBulkForm`은 실제 Razor 폼 POST로 기존 직원의 비공개 설정/해제, 재조회, 부서·프로젝트·CS 권한 유지, Leave 동기화 대기 등록 및 일정 디렉터리 전달 값을 검증합니다. 운영 계정은 테스트로 변경하지 않습니다.

## 신규 계정 등록 결과와 초안 보호 (통합 구조)

기존 직원의 **모두 되돌리기**도 공통 확인창을 사용합니다. 미저장 직원 변경만 마지막 확인 값으로 되돌리며 새 계정 등록 초안이나 서버 데이터를 삭제하지 않습니다. 확인 중 입력이 바뀌면 취소 후 다시 확인해야 합니다. 로그인 계정·권한이 바뀐 화면에서는 이전 권한으로 저장/비교/되돌리기/권한 전체 전환을 계속하지 않으며, 초안을 남기고 새 화면에서 확인하도록 안내합니다.

- 신규 등록과 기존 직원 변경은 공통 필드 정의를 사용합니다. 등록은 전체 저장 결과를 확인한 뒤에만 완료로 표시하고, 이메일 정규화·자동 부여된 의존 권한도 화면에 반영합니다.
- 필드 오류는 입력을 유지한 채 고쳐서 등록할 수 있습니다. 통신 오류·권한 변경·결과 불일치는 실제 등록 여부가 불확실하므로 반복 등록을 잠그고 계정 목록 확인을 안내합니다. 창에서 요청을 취소해도 서버 저장까지 취소됐다고 보장하지 않습니다.
- 성공 후 기존 직원 목록/현황을 자동 새로고침하지 않습니다. 옆에서 작성 중인 직원 변경 내용을 보존하기 위해서이며, **계정 목록 확인 (새 탭)**으로 확인합니다. **다른 계정 등록**은 신규 폼만 초기화합니다.
- 기존 HTML POST와 단건 Update 호환은 유지합니다. 실제 인증·서버 권한·CSRF·연차 outbox·DB 스키마는 변경하지 않습니다.
- 일반 HTML 제출이 실패해도 **전송한 입력 보관**에서 계정 필드 원문을 확인할 수 있습니다. 복원 가능한 직원 변경은 기존 편집 양식에 표시하며 수정 전 버전과 되돌리기 기준을 유지합니다. 최신 서버 값으로 버전만 바꿔 덮어쓰지 않습니다.
- 잘못된 날짜·선택값, 기준값이 없는 이전 클라이언트, 수정 권한이 사라진 계정은 복사용 원문만 남깁니다. 저장 결과가 불확실하면 해당 폼의 반복 저장/등록을 잠그고 새 탭에서 현재 목록을 확인합니다. 새로고침/탭 닫기 이후까지 초안을 보관하는 기능은 아닙니다.
- JavaScript가 동작하지 않으면 같은 필드의 상세와 전체 제출 버튼을 표시합니다. 별도 폼에 작성했지만 제출하지 않은 초안, 네트워크 장애 또는 요청 검증 단계에서 거부된 입력까지 서버에서 복원할 수는 없습니다. 레거시 단건 Update의 실패는 복사용 원문 보관만 지원합니다.

## 비공개 직원·프로젝트와 아이콘 (2026-09-08)

- 직원 관리의 **비공개**를 선택하고 변경사항 저장: 로그인/서비스 권한과 별개로 일반 직원의 명단·참여자·일정에서 제외합니다. 관리자/마스터는 볼 수 있습니다. 계정 유형을 공용 테스트로 바꿀 필요는 없습니다.
- 프로젝트 관리에서 **비공개 프로젝트**를 설정합니다. 관리자가 아닌 참여 직원도 비공개 프로젝트 및 연결 일정에 접근할 수 없습니다.
- 회사 마스터는 관리자여도 참여자·일정 행·연차 직원 목록에서 항상 제외합니다. 관리자 계정 관리 및 감사 기록은 유지합니다.
- 기존 데이터는 기본 공개로 이전됩니다. 특정 부계정을 이름으로 추측하여 자동 변경하지 않습니다. 기존 글 본문/과거 외부 발송 메시지를 소급 삭제하거나 익명화하는 기능은 아닙니다.
- 프로젝트 저장 후 아이콘 이미지(PNG/JPEG/WebP, 최대 8MiB·각 변 8192px)를 선택하고 **아이콘 저장**을 누릅니다. 중앙을 256×256 PNG로 변환하며 백엔드는 512KiB/PNG CRC/압축 크기를 검증합니다. 공통 폼에서 현재 계정·프로젝트·기존 이미지 버전을 대조하며 아이콘 삭제는 프로젝트를 삭제하지 않습니다.
- 중앙 `WorkspaceProjectIcons` 테이블과 `context.projectIcons`로 아이콘을 공유합니다. GET도 인증과 최신 비공개 권한을 검사하고 캐시하지 않습니다. 변경 API는 관리자와 CSRF가 필요합니다.
- 공통 `company-entities.js`가 직원/프로젝트 선택창에 검색과 사진/아이콘을 추가합니다. 네이티브 폼 값과 기존 change 처리를 유지하며 Escape 취소, 방향키/Enter 선택을 지원합니다.
- 비공개 플래그는 서명된 SSO/연차 프로비저닝과 일정 내부 디렉터리에 전달합니다. 일정 API는 요청마다 최신 디렉터리를 확인하고 연결 실패 시 이전 공개 범위로 응답하지 않습니다. 연차는 기존 outbox 재시도 방식으로 반영됩니다.
- 배포 전 Portal·Leave·Schedule DB를 백업합니다. 컬럼/아이콘 테이블 추가 방식이며 이전 키/세션/연차 기록은 보존됩니다.
