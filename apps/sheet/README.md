# Sheet

운영 개요의 `READY` 준비 상태는 회사 공통 success 상태 pill과 의미 점을 사용합니다. 앱별 색·크기·다크 모드 스타일을 다시 만들지 않으며, 연결 모드 및 갱신 상태 배지와 같은 공통 시각 언어를 따릅니다.

모노레포 검증: `npm ci --ignore-scripts`, `npm test`, `npm run typecheck`, `npm run build`, `npm run test:runtime`. Vitest 4.1.11 및 시트 빌드의 tsup/esbuild 보안 호환 override를 사용합니다. 마지막 검사는 실제 생성 서버를 loopback·합성 설정·외부 연결 차단 환경에서 실행하며 운영 시트를 사용하지 않습니다. 개발 의존성을 포함한 온라인 audit도 CI 필수 검사입니다. 상세한 범위와 override 제거 조건은 [공통 개발 문서](../../docs/DEVELOPMENT.md)를 확인합니다.

회사 Google Sheets에 저장된 게임 데이터와 번역 데이터의 갱신·배포를 관리하는 사내 웹 도구입니다.

기존 Google Sheets 공동 편집 방식은 유지하면서 `IMPORTRANGE` 수식을 일반 값으로 마이그레이션하고, 데이터 시트의 한국어 원문 갱신, 재번역 상태, 스냅샷, 개발·라이브 릴리스를 관리하는 것을 목표로 합니다.

Portal 공통 워크스페이스 바, 서비스 전환 메뉴, 모바일 내비게이션과 도메인 공용 테마를 사용합니다. 정식 진입 경로는 `https://company.example.com/workspace/sheet`이며 기존 `sheet.example.com`은 호환 주소로 유지합니다. 로그인 세션은 기본 7일이고 사용 중 절반이 지나면 자동 갱신됩니다.

## 문서

- [개발 명세](docs/DEVELOPMENT_SPEC.md)

## 현재 상태

### 모노레포 공통 실행 확인

- 초기 조회·재분석·원문 비교는 전체 응답과 문서 대상을 검증하고 공통 상태 안내를 사용합니다. 계정/권한 변경 시 이전 본문을 제거하며, 일반 조회 실패에는 마지막 정상값을 보존합니다. 명시적 다시 열기/재시도와 서버 작업 취소의 차이 및 남은 서버 계약은 [시트 조회 계약](../../packages/contracts/sheet-reads.md)을 따릅니다.

- 작업 버튼·검색 필드·표·검색 결과 없음과 Google/데모 연결 상태는 공통 UI를 사용합니다. 상태 pill 안 의미 점의 크기·모양·tone도 공통 primitive가 소유합니다. 스냅샷 `기록 정보`는 공통 단일 펼치기로 목록의 메타데이터를 보여주며 셀 원문 조회/복원은 실행하지 않습니다. 연결 규약은 [시트 컨트롤 계약](../../packages/contracts/sheet-controls.md)을 따릅니다.

- 수식 전환·한국어 갱신의 확인창은 공통 `CompanyDialog`와 generated React 연결을 사용합니다. 시트 안에 별도 모달/테마 CSS를 만들지 않습니다.
- `useSheetActions`가 검토한 분석/미리보기 ID와 대상을 고정하고, 페이지·권한·분석 변경과 중복 실행을 검사합니다. 두 POST는 공통 `CompanyForm` transport만 사용하며 설정에서 검증한 actor와 분석/미리보기 기준을 헤더로 다시 보내 서버 세션·본문과 대조합니다. 정확한 `수식 제거`/`한국어 갱신` 문구와 서버의 쓰기 허용·스냅샷·변경 충돌 검사를 유지합니다.
- 서버의 `workspace-form-v1` 영수증과 실제 전송 본문 전체를 검증한 뒤 공통 상태로 결과를 표시합니다. 실행 후 묶음 조회는 공통 `WorkspaceReadSession`의 30초 제한과 화면·계정 취소를 사용하며, 실패해도 실행 실패로 안내하지 않습니다. 불완전 응답/통신 오류는 서버 반영 여부를 확정하지 않으며, `데이터 다시 확인`은 읽기만 수행합니다. 재실행 전 현재 셀과 스냅샷을 확인해야 합니다. 상세 경계는 [시트 실행 저장 계약](../../packages/contracts/sheet-writes.md)을 따릅니다.
- 검증: `npm test`, `npm run typecheck`, 루트 `npm run check`와 `npm run test:browser`. 브라우저 쓰기는 합성 API에서만 처리하며 실제 Google Sheets를 수정하지 않습니다.

마이그레이션 MVP가 구현되어 있습니다.

- Google Spreadsheet URL 또는 ID 분석
- 전체 탭의 `IMPORTRANGE` 탐색과 연결 규칙 생성
- 수식·원본·대상·현재 값 미리보기
- 쓰기 전 문서 변경 여부 재검증
- 수식 스냅샷 생성
- Google Sheets API `RAW` 입력으로 일반 값 변환
- 변환 실패 시 수식 자동 복구
- 스냅샷 목록과 데모 대시보드

한국어 원문 비교·갱신도 구현되어 있습니다. 스냅샷 기록 정보는 확인할 수 있지만 셀별 상세·복원 UI, 재번역 상태, 개발·라이브 릴리스는 아직 후속 구현 대상입니다.

## 로컬 실행

Node.js 22 이상이 필요합니다.

```powershell
npm install
npm run dev
```

브라우저에서 `http://localhost:4173`을 엽니다. Google 인증 정보가 없으면 테스트 복사본의 실제 분석 결과를 반영한 데모 모드로 실행됩니다.

운영 주소는 `https://sheet.example.com`이며 회사 Portal SSO를 거쳐 접근합니다. 운영 Compose는 `COMPANY_SSO_REQUIRED=true`가 기본값이므로 Portal과 같은 `COMPANY_SSO_SHARED_SECRET`이 없으면 시작되지 않습니다.

현재 사내 Docker 호스트에서는 Portal의 환경 파일을 재사용해 비밀값을 출력하거나 복사하지 않고 배포합니다.

```powershell
docker compose --env-file ../portal/.env --env-file .env up -d --build
```

Sheet는 `company-services` 내부 네트워크에서 `sheet-control:4173`으로만 터널에 연결됩니다. 회사 Portal의 `sheet.access` 권한이 있는 계정과 관리자·마스터 계정만 SSO로 진입할 수 있습니다.

Google 서비스 계정 키는 기본적으로 저장소 밖의 `../private/sheet-google-service-account.json`을 컨테이너의 `/run/secrets/google-service-account.json`에 읽기 전용으로 연결합니다. 실제 쓰기는 `.env`의 `ALLOW_SHEET_WRITES=true`를 명시해야만 활성화됩니다.

프로덕션 빌드 확인:

```powershell
npm run build
$env:NODE_ENV = 'production'
npm start
```

## Google Sheets 연결

1. Google Cloud에서 Sheets API와 Drive API를 사용하는 서비스 계정을 준비합니다.
2. 테스트 Spreadsheet를 서비스 계정 이메일에 공유합니다.
3. `.env.example`을 `.env`로 복사합니다.
4. `GOOGLE_APPLICATION_CREDENTIALS`에 서비스 계정 JSON 경로를 지정합니다.
5. `ALLOW_SHEET_WRITES=false` 상태에서 먼저 분석 결과를 확인합니다.
6. 테스트 복사본에 한해 `ALLOW_SHEET_WRITES=true`로 전환합니다.

```dotenv
TEST_SPREADSHEET_ID=10ryam8K5qbNZ7EFjW1YjvOEzGbEf9uh5dR36daNQuog
GOOGLE_APPLICATION_CREDENTIALS=C:\secure\sheet-service-account.json
ALLOW_SHEET_WRITES=false
```

마이그레이션 실행은 다음 조건을 모두 만족해야 합니다.

- Google 인증 정보가 설정됨
- 서버 쓰기 설정이 활성화됨
- 분석 이후 Spreadsheet가 변경되지 않음
- 차단 오류가 0개임
- 사용자가 확인 문구 `수식 제거`를 입력함

## 검증

```powershell
npm run typecheck
npm test
npm run build
```

## Docker

```powershell
docker compose up --build
```

스냅샷과 갱신 규칙은 컨테이너의 `/app/data`에 저장되며 Compose 실행 시 로컬 `data` 디렉터리에 유지됩니다.

## 통합 워크스페이스 UI (2026-09-07)

- 상단바는 Company Portal의 `/js/company-workspace.js`, `/css/company-workspace.css`를 공통 사용합니다. 로고의 홈 이동, 종 모양 알림, 개인 설정/로그아웃, 권한별 서비스 전환, 테마를 한 곳에서 제공합니다.
- 서비스 내부 메뉴는 `.cw-sidebar`에만 배치합니다. 각 서비스에 별도 계정·알림·테마·회사 홈 버튼을 추가하지 않습니다. 900px 이하에서는 상단 메뉴 버튼으로 하위 메뉴를 엽니다.
- 테마는 의미별 `--cw-*` 토큰을 사용합니다. 선택/미선택 상태는 `aria-current` 또는 `aria-pressed`와 함께 표현하며 색 반전 필터를 사용하지 않습니다.
- `/api/workspace/context`가 실제 계정과 허용된 서비스만 반환합니다. 관리자 계정은 모든 서비스를, 공용 계정은 부여받은 서비스만 볼 수 있습니다. 화면 숨김과 별개로 각 서비스 백엔드도 권한을 검증합니다.
- 개인 설정 `/settings/profile`: 사진만 변경 가능합니다. 브라우저에서 가운데를 256×256 PNG로 변환하고 서버에서 크기/CRC/압축 해제 크기를 검증합니다. 이름·부서·역할 수정 API는 제공하지 않습니다.
- SSO 토큰과 서비스 세션에 `sid`가 포함됩니다. 서비스는 HMAC 서명된 60초 토큰(`aud=workspace-session`)으로 Portal의 `/api/internal/workspace/session`에서 세션과 최신 권한을 확인합니다. 로그아웃은 현재 브라우저의 sid를 폐기하므로 모든 하위 서비스의 기존 세션이 거부되며 다른 기기의 세션은 유지됩니다.
- 내부 인증 연결 실패는 503으로 실패 처리하며 인증을 우회하지 않습니다. Node 서비스의 내부 주소는 `COMPANY_PORTAL_INTERNAL_URL`(기본 `http://company-portal:8080`), Leave는 `CompanyPortal:InternalUrl`, Schedule은 `Portal:InternalUrl`입니다. Docker `company-services` 네트워크와 서비스 간 동일 SSO 키가 필요합니다.
- 알림 원본 DB는 각 서비스에 남습니다. 내부 GET `/api/internal/company-notifications?format=workspace-v2`는 `{items,unreadCount}`, 형식 미지정은 기존 배열을 반환합니다. 내부 POST `.../read?id=ID` / `.../read`는 서명 토큰의 사용자 소유 알림만 읽음 처리합니다. Portal은 권한 있는 출처만 조회하며 일부 실패를 UI에 표시합니다.
- Portal의 쓰기 API는 인증 쿠키와 `X-Workspace-CSRF`를 함께 검증하고 허용된 서비스 origin에만 CORS를 제공합니다. 각 서비스 CSP의 `connect-src`, `img-src`는 `https://company.example.com`을 허용합니다.
- 배포 시 Portal DB와 DataProtection 키를 백업하고 Portal 및 모든 하위 서비스를 함께 갱신합니다. 새 `WorkspaceSessions`/`WorkspaceProfiles` 테이블은 추가 방식이며 기존 직원·업무 데이터를 이동/삭제하지 않습니다. 구버전 서비스 세션은 최초 접근 시 한 번 SSO 재연결이 필요할 수 있습니다.
