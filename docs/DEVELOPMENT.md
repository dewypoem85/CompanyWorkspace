# 개발 및 검증

## Native POST 폼 경계 검증

새 Razor/HTML POST 폼을 추가하기 전에 공통 저장 수명주기와 소비자 계약을 연결한다. 정책 파일에 페이지를 바로 추가하는 방식은 허용 경계가 아니다.

```powershell
npm run check:post
node --test tooling/tests/native-post-boundaries.test.mjs tooling/tests/generator.test.mjs
```

`check:ui`도 작성 소스 147개에서 현재 native POST 31개/소유 파일 16개를 대조한다. `<form method="post">`뿐 아니라 submitter `formmethod`와 JavaScript `.method`/`.formMethod`·`setAttribute`의 literal POST도 포함한다. 정적 검사는 계산 문자열·런타임 반사, 실제 권한·CSRF·DB 트랜잭션이나 성공 영수증 검증을 대신하지 않는다.

## 자동 GET 필터 이동 검증

연차 대신보기와 관리자 사용 통계의 직원 picker는 `data-cw-auto-submit`을 사용한다. 공통 navigation이 GET 폼만 `requestSubmit()`하고 원래 local 직원 ID와 hidden query를 보존하는지 확인한다.

```powershell
node --test tooling/tests/navigation.test.mjs tooling/tests/architecture.test.mjs
node tooling/prepare-razor-fixtures.mjs
$env:WORKSPACE_BROWSER_CHANNEL='chrome'
npx playwright test tooling/browser-tests/leave-shell.spec.mjs --grep "shared employee filter performs one native GET navigation" --output artifacts/browser-automatic-navigation-phase165
```

단위/구조 66개, Razor 서버 196개와 실제 Chrome 2개가 통과했다. 이는 저장 폼을 자동 제출하도록 허용하는 계약이 아니다.

## 브라우저 네트워크 경계 검증

새 페이지/컴포넌트에 raw 네트워크 호출을 추가하지 않는다. 먼저 공통 read/write session 또는 이미 검토된 앱 transport를 사용하고, 새 프로토콜이 꼭 필요하면 한 transport에 모은 뒤 same-origin·응답 형식·취소/해제·현재 계정/대상·전체 응답 계약과 변이/브라우저 검사를 함께 추가한다. 페이지 파일을 허용 목록에 넣는 방식은 사용하지 않는다.

```powershell
npm run check:network
node --test tooling/tests/network-boundaries.test.mjs tooling/tests/account-review.test.mjs tooling/tests/account-fields.test.mjs
```

`check:ui`도 같은 검사를 실행한다. 현재 정책은 작성 소스 168개에서 검토된 raw 호출 16개를 봉인하며 computed property·call/apply/bind·전역 constructor·literal reflection 변형도 검사한다. Portal 직원 충돌 조회는 `account-review.js`의 동일 출처·JSON media type·AbortSignal 경계를 거친다. 연차 달력·신청목록 부분 조회는 `leave-dashboard-read.js`가 허용 경로/필터와 HTML 응답을 검사하며 페이지는 공통 read session을 소유한다. 정적 검사는 계산 문자열·eval이나 보안/인가 증명이 아니므로 실제 Razor 196개와 해당 Portal/Leave Chrome 시나리오를 유지한다.

## 회사 계정 컨텍스트 조회 검증

공통 셸의 context는 `workspace-context` 채널과 `CompanyContextContract`를 거친다. 손상된 사용자/서비스/사진/프로젝트 응답, 해제 뒤 늦은 JSON, 저장 확인 중 context revision 변경을 구조·단위 검사로 고정한다.

```powershell
node --test tooling/tests/context-contract.test.mjs tooling/tests/workspace-context-read-session-contract.test.mjs tooling/tests/notification-contract.test.mjs tooling/tests/navigation.test.mjs
$env:WORKSPACE_BROWSER_CHANNEL='chrome'
npx playwright test tooling/browser-tests/portal-shell.spec.mjs --grep "company context" --output artifacts/browser-workspace-context-phase163
```

브라우저 집중 2개는 손상 응답의 적용 전 거부와 비지속 pagehide 뒤 늦은 완료 폐기를 확인한다. 프로필/프로젝트 저장·알림 쓰기·로그아웃의 확정과 운영 SSO를 대신하지 않는다.

## 공통 사이드바 권한 조회 검증

`navigation.js`는 서버 메뉴가 필요한 서비스마다 `workspace-navigation-*` 고정 채널을 사용한다. 연속 포커스·재시도, 계정/역할 변경, 로그아웃, 401/403/손상된 pages·badges와 늦은 응답이 이전 권한 링크를 복원하지 않는지 아래 검사로 확인한다. 생성 번들은 read session을 navigation보다 먼저 로드해야 한다.

```powershell
node --test tooling/tests/navigation.test.mjs tooling/tests/navigation-read-session-contract.test.mjs
$env:WORKSPACE_BROWSER_CHANNEL='chrome'
npx playwright test tooling/browser-tests/portal-shell.spec.mjs --output artifacts/browser-navigation-reads-phase162
```

Chrome 122개는 회사 홈의 320/390/1440px·두 테마, 역할별 화면, 권한 실패/복구와 계정 초안·포커스를 함께 확인한다. 이는 운영 SSO나 각 서비스 본문 권한 검증을 대신하지 않는다.

## 공통 UI 부채 봉인 검증

`packages/contracts/ui-primitive-debt.json`은 `sealed: true`, 빈 `files`와 빈 `entries`를 유지한다. 새 native UI는 공통 primitive로 전환해야 하며 봉인을 해제하거나 예외를 복원할 수 없다. `npm run check:primitives`와 새 페이지 생성기 검사가 실제 저장소 및 복제 작업공간에서 이를 강제한다.

```powershell
node --test tooling/tests/ui-primitives.test.mjs tooling/tests/generator.test.mjs
npm run check:primitives
```

## Leave 가불·사용 완료 상태 배지 검증

가불 종류와 일수는 관리자 승인 대기열·최근 내역, 직원 신청 내역과 달력 상세 모두 `cw-state-pill[data-tone="warning"]`을 사용한다. 과거 사용일을 가진 승인 건의 `사용 완료`는 같은 상태 줄에서 neutral pill을 사용한다. 앱 CSS는 행 안 여백만 소유하며 배경·글자색·크기와 테마는 공통 primitive가 소유한다. 구조 변이 검사는 누락 및 전용 skin 재도입을 거부하고, 승인·자기 신청 서버 픽스처는 실제 가불/과거 승인 건을 포함한다. 감사 배지는 페이지 전용 CSS뿐 아니라 함께 로드되는 `site.css`까지 합쳐 검사하며, 모바일 미리보기의 승인·완료 표시도 같은 공통 상태 계약을 따라야 한다.

```powershell
node --test tooling/tests/architecture.test.mjs
node tooling/prepare-razor-fixtures.mjs
$env:WORKSPACE_BROWSER_CHANNEL='chrome'
npx playwright test tooling/browser-tests/leave-approvals.spec.mjs
npx playwright test tooling/browser-tests/leave-self-actions.spec.mjs
```

브라우저 검사는 320/1440px·라이트/다크의 계산 색과 승인 전체 흐름을 함께 확인한다. 이 집중 검사는 운영 연차 데이터나 다른 상태 배지의 완료 근거가 아니다.

승인 대기·취소 승인 대기의 제목 옆 숫자는 상태 pill이 아니라 `cw-count-badge`를 사용한다. 앱은 제목과의 간격만 소유하며 공통 primitive가 크기·정렬·색·테마를 소유한다. `leave-approvals.spec.mjs`의 네 viewport/theme 조합은 실제 Razor 숫자 배지의 class와 계산 색을 함께 확인한다.

Sheet의 `cw-state-pill` 안 의미 점은 공통 primitive가 크기·원형·현재 tone 색을 소유한다. 앱 CSS에 `.connection-badge i`, `.status-pill i`, `.sync-pill i` 전용 skin을 두지 않는다. `sheet-shell.spec.mjs`는 대표 6개 viewport/theme에서 연결 pill의 실제 점 geometry를 확인하고 전체 흐름도 회귀한다.

운영 개요의 `READY` 준비 상태도 success `cw-state-pill`과 공통 의미 점을 사용한다. `.live-label`은 문구와 배치 식별자일 뿐 배경·글자색·글꼴 크기·padding·점 geometry를 소유하지 않는다. 같은 시트 브라우저 검사는 320/390/1440px·두 테마의 실제 계산 색과 문서 폭을 확인한다.

회사 홈의 서비스 사용 가능 개수 요약과 각 서비스 카드 상태는 같은 success `cw-state-pill`을 사용한다. Portal CSS에 `.service-count` 전용 색·크기·점 skin을 두지 않는다. `portal-shell.spec.mjs`의 회사 홈 여섯 조합은 요약과 카드의 실제 계산 색을 함께 검사한다.

## 연간·월간 달력 표 검증

`calendar-tables.md`의 `year-mini`와 `month` 계약을 사용한다. `npm run check`는 접근 가능한 이름, native table 역할, 요일 `scope="col"`, 지원 레이아웃과 표 중첩을 검사하며 월간 표는 날짜/표시용 날짜 메타데이터와 공통 상세 버튼도 요구한다. 실제 Razor fixture를 만든 뒤 아래 집중 검사로 12개월 및 월간 렌더링, 공통 고정 열 배치, 직원 사진, 키보드 상세 진입, 모바일 문서 폭과 두 테마를 확인한다.

```powershell
node tooling/prepare-razor-fixtures.mjs
$env:WORKSPACE_BROWSER_CHANNEL='chrome'
npx playwright test tooling/browser-tests/leave-calendar-entities.spec.mjs --grep "year calendar"
npx playwright test tooling/browser-tests/leave-calendar-entities.spec.mjs tooling/browser-tests/leave-calendar-admin.spec.mjs --grep "calendar profiles|calendar detail shared"
```

이 집중 검사는 여섯 서비스 전체 회귀를 완료했다는 근거가 아니다.

## 업무 history 초안 확인

`TaskPanel`의 브라우저 뒤로 이동은 `useWorkspaceNavigationRequest`로 승인 전 URL을 복구하고 공통 확인창을 사용한다. `schedule-shell.spec.mjs`의 `task editing uses shared confirmation` 4개 조합으로 취소 시 URL/초안 보존, 승인 이동, native dialog·쓰기 없음과 모바일 다크 화면을 확인한다.

본문·댓글의 다른 업무 링크는 `task reference transition` 4개 화면 조합과 scope 중단 1개로 검사한다. 제목 GET이 JSON Accept를 보내는지, 취소 후 원문·포커스, 확인 중 범위 변경 뒤 이전 제목 폐기와 초안·URL 유지, 승인 후 실제 대상 업무 상세와 URL을 확인한다. 조회 수명주기와 응답 검증은 `schedule-task-reference-reads.md`를 따른다.

업무 창 닫기는 `owned task modal preserves` 4개 화면 조합으로 닫기 버튼·Escape·외부 닫기와 중첩 날짜 창 순서를 검사한다. 공통 확인 취소와 scope 중단에서 초안이 유지되고, 승인 후에만 창이 닫히며 실제 수정 중인 업무명·프로젝트가 표시되는지 확인한다. native browser dialog가 발생하면 실패한다.

## 비동기 편집창 닫기

`owned-modals.md`의 비동기 요청은 동기 가드와 별도로 검증한다. `dialogs.test.mjs`는 취소/중복/직접 우회·scope/abort·늦은 승인·분리/층/초안/가드를 검사하고 React `useWorkspaceModal.test.tsx`는 실제 코어와 StrictMode/노드 교체를 확인한다. Schedule 버전 편집의 `requestDiscard`는 전체 원문과 기준 버전/계정을 캡처하고 저장을 실행하지 않는다. 닫기 대기와 저장 상태를 구분하며 공통 프로젝트 entity 표시를 사용한다. `workspaceNavigation.test.tsx`는 승인 전 URL/화면 유지, 호출자 history state 보존, 중복·scope·가드 해제·늦은 승인을 검사한다. 실제 Chrome의 `release async|release editor|browser-back` 검사를 실행하고 변경된 번들로 다단계 뒤로/앞으로 왕복을 확인한다. TypeScript/빌드가 실패하면 중단하며 이전 번들의 테스트를 새 소스 검증으로 사용하지 않는다. 여섯 앱 전체 회귀는 별도 완료 근거가 필요하다.

## Schedule 버전 기록 저장 검증

`schedule-release-writes.md` 계약에 따라 생성·수정은 `/api/releases/editing`에서 현재 actor와 대상 또는 프로젝트 기준 토큰을 먼저 읽고, 공통 확인창 승인 뒤에만 `workspace-form-v1` 요청을 전송한다. 서버는 기준 읽기부터 Release·revision·감사 저장과 전체 ACK 캡처까지 한 트랜잭션으로 처리한다. 기존 클라이언트의 bare `ReleaseRecord` 응답은 유지한다.

```powershell
npm test --prefix apps/schedule -- --run
npm run build --prefix apps/schedule
dotnet test apps/schedule/tests/Schedule.Tests.csproj -c Release --no-restore
dotnet test apps/schedule/integration-tests/CompanyIntegration.Tests.csproj -c Release --no-restore
npm run check
$env:WORKSPACE_BROWSER_CHANNEL='chrome'
npx playwright test tooling/browser-tests/schedule-shell.spec.mjs
```

단위·서버 검사는 actor/기준 불일치, 확인 취소, 생성·수정 전체 ACK, 오래된 Version, partial/HTML/네트워크·권한 실패, scope 변경과 저장 뒤 목록 실패를 포함한다. 브라우저 검사는 실제 번들에서 요청 헤더·본문, 공통 변경 비교창, 성공 reconciliation과 초안 보존을 320/390/1440px·라이트/다크로 확인한다. 이는 운영 DB·SSO·배포 성공의 증거가 아니다.

## Schedule 버전 기록 조회 검증

`schedule-release-reads.md`에 따라 시리즈·마이너·구형 목록과 편집 상세의 롤백/해결 참조·변경 이력은 공통 read session과 `scheduleGet`을 사용한다. parser는 total·중복 ID·프로젝트/버전 범위와 revision snapshot을 표시 전에 검증한다.

```powershell
npm test --prefix apps/schedule -- --run useReleaseList.test.ts useReleaseEditor.test.ts
npm run build --prefix apps/schedule
npm run check
$env:WORKSPACE_BROWSER_CHANNEL='chrome'
npx playwright test tooling/browser-tests/schedule-shell.spec.mjs --grep "release"
```

hook 검사는 초기 실패와 빈 결과 구분, 재조회 실패의 마지막 정상 행, 401/403, 페이지 중복과 scope·언마운트 취소를 포함한다. 브라우저는 목록 실패/재시도·펼치기·편집 참조·이력·scope 변경을 모바일/PC·두 테마에서 검증한다. 이 검사는 운영 서버·DB·SSO를 호출하지 않으며 다른 서비스 조회 경로의 완료 근거가 아니다.

## Schedule 개인 TODO 조회·저장 검증

`schedule-todo-reads.md`에 따라 할 일·보관함·삭제 전·저장 후 TODO 목록은 같은 공통 읽기 채널을 사용한다. `schedule-todo-writes.md`에 따라 다섯 쓰기는 최신 회사 계정과 정확한 행/목록 기준을 사전 조회하고 공통 문서 lease, 서버 actor/상태 토큰·트랜잭션과 전체 ACK를 사용한다. 탭·계정 전환 취소, owner/행 검증, polling 중 초안 보존, 미확정 요청 재전송 금지와 저장 후 GET 실패의 쓰기 미반복을 같이 확인한다.

Schedule에는 더 이상 범용 `api()` 또는 전역 CSRF 저장소가 없다. 조회는 `scheduleGet`과 `WorkspaceReadSession`, 쓰기는 각 도메인 hook과 `createWorkspaceWriteTransport`만 사용한다. 새 화면에서 별도 fetch wrapper를 추가하면 구조 검사가 실패하며, 공통 계약을 먼저 확장해야 한다.

```powershell
npm test --prefix apps/schedule -- --run personalTodoWrites.test.ts personalTodoContract.test.ts PersonalTodos.test.ts
dotnet test apps/schedule/tests/Schedule.Tests.csproj -c Release --no-restore --filter PersonalTodoTests
npm run build --prefix apps/schedule
npm run check
$env:WORKSPACE_BROWSER_CHANNEL='chrome'
npx playwright test tooling/browser-tests/schedule-shell.spec.mjs --grep "personal TODO"
```

브라우저 fixture는 TODO GET의 JSON Accept, 쓰기 사전 편집 기준, actor/상태/CSRF 헤더와 정확한 JSON, 삭제 확인·명시적 복구·60초 polling·scope 변경을 모바일/PC·두 테마에서 검사한다. 실제 번들과 격리 응답을 사용하지만 운영 계정·DB·SSO·배포 완료 근거로 해석하지 않는다.

## Schedule 날짜 선택기 공휴일 조회 검증

`schedule-date-picker-reads.md`에 따라 열린 날짜 선택기는 6주 범위 공휴일을 `date-picker-holidays` 공통 읽기 채널에서 조회한다. 응답 전체 구조와 현재 ticket을 확인하고 달력 닫기·월·재시도·계정 범위·언마운트에서 이전 요청을 취소한다. 실패는 빈 성공으로 바꾸지 않고 주말 표시와 수동 재시도를 유지한다.

```powershell
npm test --prefix apps/schedule -- --run DatePicker.test.tsx calendarDay.test.tsx scheduleReads.test.ts
npm run build --prefix apps/schedule
npm run check
$env:WORKSPACE_BROWSER_CHANNEL='chrome'
npx playwright test tooling/browser-tests/schedule-shell.spec.mjs --grep "calendar common controls"
```

브라우저 검사는 320/1440px·라이트/다크에서 실제 JSON Accept 요청, 정상 공휴일, 실패 fallback과 재시도, 중첩 Escape·포커스 및 날짜 선택을 확인한다. 합성 HTTP를 사용하며 운영 공휴일 API·DB나 다른 raw 읽기 경로의 완료 근거가 아니다.

## Schedule 읽기 전용 업무 열기 도구 검증

`schedule-tool-reads.md`에 따라 `open_schedule_task`는 공통 읽기 세션에서 업무 상세 전체를 검증한 뒤 기존 공통 페이지 이동을 요청한다. 계정 범위·연속 실행·등록 해제는 이전 요청을 취소하고, 실패하거나 취소된 조회는 열린 결과를 반환하지 않는다.

```powershell
npm run build --prefix apps/schedule
node --test tooling/tests/architecture.test.mjs tooling/tests/generator.test.mjs
$env:WORKSPACE_BROWSER_CHANNEL='chrome'
npx playwright test tooling/browser-tests/schedule-shell.spec.mjs --grep "schedule read-only tool"
```

브라우저 검사는 실제 등록된 도구를 호출해 JSON Accept 사전 조회와 `/tasks/{id}` 이동, 404 후 기존 화면 유지를 확인한다. 합성 상세 응답을 사용하며 운영 WebMCP 호스트나 서버 인가의 완료 근거가 아니다.

## Schedule 일정 관리 목록 조회 검증

`schedule-settings-reads.md`에 따라 관리자/일반 주요 일정과 보관 업무·더 보기는 공통 읽기 세션을 사용한다. 관리자 편집 기준, 일반 목록, 보관된 전체 업무와 페이지 total·중복·집계를 검증하고 탭·날짜·계정·화면 수명 변경에서 이전 요청을 취소한다.

```powershell
npm test --prefix apps/schedule -- --run scheduleReads.test.ts Settings.test.tsx
npm run build --prefix apps/schedule
npm run check
$env:WORKSPACE_BROWSER_CHANNEL='chrome'
npx playwright test tooling/browser-tests/schedule-shell.spec.mjs --grep "management common controls|management archive pagination"
```

브라우저 검사는 320/1440px·라이트/다크의 기존 주요 일정 편집·보관 업무 이동과 JSON Accept를 유지하고 별도 페이지 시나리오에서 다음 페이지의 검증·병합을 확인한다. 합성 HTTP를 사용하며 운영 DB·인가나 주요 일정 쓰기 완료 근거가 아니다.

## CS 초안 확인과 비동기 상세

`draft-transitions.md`의 `beforeRequest`/`requestOpen` 및 마지막 동기 가드를 함께 검증한다. `disclosure.test.mjs`의 abort 무시/늦은 승인·노드 교체와 실제 `cs-player-data.spec.mjs`의 확인/취소·서버/키/조회/원본 복원·계정/대상/초안 변경을 유지한다. 추가/삭제 창은 확인 전 트리거로 포커스가 돌아와야 한다. 새 예외 없이 기존 native confirm 부채를 prune하며, 감소 검사 fixture는 아직 실제로 남은 부채로 검증한다. 공통 런타임 변경은 두 React 빌드와 Razor fixture 생성 후 여섯 앱 전체 브라우저를 실행한다.

## 계정·알림 작업 버튼 검증

`account-action-controls.md`와 `support/native-buttons.mjs`를 따른다. 실제 Razor fixture를 재생성한 뒤 `profile-form`, `portal-notification-ids`, `leave-notifications`, `leave-discord`, `leave-settlements`의 기존 브라우저 회귀에서 기본/primary/danger/compact·fieldset-disabled 계산 색/크기/폭을 함께 확인한다. 공통 CSS 변경이므로 전체 여섯 서비스 회귀와 실제 캡처를 별도로 확인한다. 진행 중 테스트는 통과 증거가 아니다.

`leave-discord-controls.md`는 같은 Discord 화면의 활성화·수신 유형 checkbox를 별도로 다룬다. `architecture.test.mjs`에서 공통 class와 앱별 skin 재도입을 변이 검사하고, Razor fixture 생성 후 `leave-discord.spec.mjs --grep "shared save|unlinked"`로 320/1440px·라이트/다크의 18px 입력, 선택/비선택·disabled 계산 상태, 기존 FormData와 문서 폭을 확인한다. 이 집중 검사는 운영 DM 발송이나 여섯 서비스 전체 회귀 증거가 아니다.

## Portal 계정·조직 checkbox 검증

`portal-controls.md`의 비공개 계정·일반 권한 카드와 조직 프로젝트의 비공개·보관 입력은 `cw-check-control`/`cw-checkbox`를 사용한다. 직원·프로젝트 복수 선택 fieldset은 `cw-choice-group`을 사용하며 항목 label에 앱 전용 checkbox skin을 섞지 않는다. 구조 검사는 공통 class 누락, 앱 CSS의 크기·accent·배경·테두리 재소유 및 공통 primitive 누락을 거부한다.

```powershell
node --test tooling/tests/architecture.test.mjs tooling/tests/account-fields.test.mjs tooling/tests/organization-contract.test.mjs
node tooling/prepare-razor-fixtures.mjs
$env:WORKSPACE_BROWSER_CHANNEL='chrome'
npx playwright test tooling/browser-tests/portal-shell.spec.mjs --grep "account creation and editing"
npx playwright test tooling/browser-tests/organization-form.spec.mjs --grep "project management"
```

집중 브라우저 검사는 320/1440px·라이트/다크에서 실제 18px 입력, 최소 42px 클릭 영역, 선택/비선택 계산 색, 문서 폭과 hidden false fallback을 확인한다. compact 권한 switch는 다음 절의 별도 계약으로 검증하며 실제 운영 계정 저장은 이 검증의 완료 범위가 아니다.

## Portal compact 권한 switch 검증

권한표의 수정 가능한 시스템 권한과 고정 연차 기본 접근은 native checkbox를 유지하면서 `cw-switch-control`/`cw-switch`/`cw-switch-track`을 사용한다. 공통 CSS가 34×20px track, 최소 42px 클릭 영역, 라이트·다크의 off/accent/success 색과 focus를 소유한다. Portal은 최소 열 폭과 허용·차단·전체 문구만 유지한다. 구조 검사는 공통 markup 누락 및 `permission-switch input/i` skin 복원을 거부한다.

```powershell
npm run build:ui
node --test tooling/tests/architecture.test.mjs tooling/tests/account-fields.test.mjs tooling/tests/organization-contract.test.mjs
node tooling/prepare-razor-fixtures.mjs
$env:WORKSPACE_BROWSER_CHANNEL='chrome'
npx playwright test tooling/browser-tests/portal-shell.spec.mjs --grep "account fields share create/edit rendering"
```

집중 브라우저 검사는 관리자/마스터, 320/1440px 및 라이트/다크에서 키보드 Space 전환, 계산된 off/on/success 색, 실제 크기와 기존 dirty/reset 흐름을 확인한다. 공통 CSS 원본 변경이므로 최종 전 서비스 브라우저 회귀를 별도로 완료해야 한다.

같은 집중 검사에서 관리자에게만 표시되는 읽기 전용 마스터 행의 직원·기본/전체 pill 및 활성 success pill과, 편집 계정을 공용 계정으로 전환할 때 나타나는 연차 제외 neutral pill도 확인한다. 공용/직원 전환에 따라 제외 표시가 나타났다 사라져야 한다. 마스터 자신의 화면에는 읽기 전용 행이 없으므로 해당 단언을 억지로 공통 적용하지 않는다.

## Portal 회사 홈 서비스 상태 검증

회사 홈의 허용된 서비스 카드와 관리자 카드는 각각 success/warning `cw-state-pill`을 사용한다. `portal-shell.spec.mjs --grep "home.dashboard"`로 320/390/1440px·라이트/다크의 실제 계산 색, 카드 배치와 문서 폭을 확인한다. 상태 표현 공통화가 서버의 허용 서비스 필터나 관리자 역할 판정을 대신하지 않는다.

## 정적인 안내의 대비 검증

`packages/contracts/static-guidance.md`의 공통 markup을 사용한다. `npm run check`는 소유자·tone·제목/본문 누락 및 live 상태 혼용 변이를 검사한다. `cs-shell.spec.mjs`는 실제 CS 안내의 계산 대비·글자 크기·폭을, `callouts-native.spec.mjs`는 JavaScript 없이 네 tone·긴 code·두 테마를 검사한다. 테마 자동 해석과 native CSS 검증을 구분하며 실제 캡처도 확인한다.

공통 CSS 변경 후 `npm run pretest:browser`가 두 React 빌드와 Razor fixture를 준비한다. 성공적으로 종료된 뒤 `$env:WORKSPACE_BROWSER_CHANNEL='chrome'` 및 `npx playwright test --output=artifacts/검사이름`으로 전체 여섯 앱을 검증한다. 실행 중 자산/fixture를 다시 생성하지 않는다.

## 반응형 업무 표 검증

`packages/contracts/responsive-tables.md`의 마크업을 사용한다. `npm run check`가 scope/레이블/wrapper 누락 변이와 생성 자산을 검사한다. 실제 Razor fixture 생성 후 `leave-shell.spec.mjs --grep "shared responsive records"`로 PC/모바일·두 테마의 셀 대응과 레이블/문서 폭을 검사한다. 승인/취소/초안 회귀와 실제 캡처 확인도 필요하다. 공통 CSS 변경 시 `npm run test:browser`로 두 React 앱 빌드·Razor 재생성 및 여섯 앱 회귀를 수행한다.

`npx playwright test tooling/browser-tests/leave-record-tables-native.spec.mjs`는 JavaScript 비활성 상태에서 같은 서버 문서/CSS·실제 표/헤더 역할·전송값 보존과 긴 레이블의 배치를 추가 확인한다. 별도 출력 경로는 `--output=artifacts/검사이름`으로 지정한다. npm을 통하면 옵션 전달 결과를 확인하고 'No tests found'를 성공으로 간주하지 않는다.

## 연차 달력 직원 표시 검증

`leave-calendar-entities.md`를 따른다. 아래 기존 Leave 서버 명령이 `LeaveCalendarEntityTests`의 실제 역할/공개 범위·큰 ID 매핑 및 월간/연간 Razor fixture도 생성한다. 이후 `npx playwright test tooling/browser-tests/leave-calendar-entities.spec.mjs`로 두 너비/테마·상세 인코딩/상태·프로필 갱신/실패/제거·로그아웃을 확인한다. 레이아웃 매핑과 전역 CSS가 바뀌므로 전체 `leave-.*.spec.mjs` 회귀도 실행한다. 사진은 테스트 HTTP이며 실제 운영 개인정보를 사용하지 않는다.

## 연차 신청·날짜 상세 일반 컨트롤

`leave-dashboard-controls.md`와 `native-fields.md`를 따른다. 실제 Razor 생성 후 신청/취소·강제 작업·외부 일정의 두 너비/테마 검사는 `support/leave-controls.mjs`로 계산된 공통 색·높이/모서리·라벨·폭과 원래 전송/초안을 함께 대조한다. 정적 class 검사만으로 실제 스타일을 완료 처리하지 않는다. Leave 전역 CSS를 바꾸면 전체 Leave 브라우저 검사로 다른 페이지도 확인한다.

```powershell
$env:WORKSPACE_RAZOR_SNAPSHOTS='C:/dev/docker/company-workspace/artifacts/razor'
dotnet test apps/schedule/integration-tests/CompanyIntegration.Tests.csproj -c Release --no-restore --filter 'FullyQualifiedName~LeavePageTests'
$env:WORKSPACE_BROWSER_CHANNEL='chrome'
npx playwright test 'tooling/browser-tests/leave-.*.spec.mjs' --output artifacts/browser-leave-controls-full
npm run check
```

합성 DB/HTTP와 실제 렌더링 자산의 검증이며 운영 SSO/데이터 반영 증거가 아니다. 공통 자산 자체 변경 시에는 여섯 앱 검사를 별도로 실행한다. 종료 결과와 실제 확인한 캡처는 MIGRATION에 기록한다.

## 지속 팝업·React DOM 소유권 검증

공통 `CompanyDialog.attach`/generated `useWorkspaceModal`과 `owned-modals.md`를 사용한다. `dialogs.test.mjs`와 일정 `useWorkspaceModal.test.tsx`는 실제 런타임·StrictMode·portal·해제/재연결·초안/가드/범위를 검사한다. `owned-modals.test.mjs`는 실제 소비자의 연결을 지우거나 private native 수명주기를 복원했을 때 구조 검사가 실패하는지 확인한다. 생성기 격리 fixture에도 검사 의존성을 포함한다.

```powershell
node --test tooling/tests/dialogs.test.mjs tooling/tests/owned-modals.test.mjs tooling/tests/generator.test.mjs
npm --prefix apps/schedule test
npm --prefix apps/schedule run build
npm --prefix apps/sheet run build
node tooling/prepare-razor-fixtures.mjs
$env:WORKSPACE_BROWSER_CHANNEL='chrome'
npx playwright test
```

`owned task modal`, `task conflict review`, `calendar common controls` 집중 검사는 초안·중첩 창·실제 포커스·계산된 두 테마/viewport 프레임·이미지 닫기 버튼 간격을 검사한다. 공통 CSS/런타임 변경의 최종 검증은 여섯 앱 전체 회귀이며 집중 검사로 대신하지 않는다. 실제 실행 결과와 화면 확인은 MIGRATION에 기록한다.

## 일정 업무 화면의 공통 JSON 저장 검증

`TaskPanel` → `useTaskWrites`와 `App`의 칸반 상태 선택·드래그 → `useTaskQuickStatus` → generated `workspace-form` → `CompanyForm.createTransport`가 실제 생성/수정/상태 전송 경로다. 공통 native POST도 같은 전송 코어를 사용한다. 칸반은 확인 전 행을 이동하지 않고 상세 preflight와 화면 행 버전을 대조하며, 전체 ACK 뒤에만 보드를 다시 조회한다. 도메인의 전체 ACK 검증과 서버 트랜잭션 검사를 공통 도구의 책임으로 혼동하지 않는다.

```powershell
node --test tooling/tests/forms.test.mjs tooling/tests/form-session.test.mjs tooling/tests/json-forms.test.mjs tooling/tests/schedule-task-writes.test.mjs
npm --prefix apps/schedule test
npm --prefix apps/schedule run build
npm --prefix apps/sheet run build
node tooling/prepare-razor-fixtures.mjs
$env:WORKSPACE_BROWSER_CHANNEL='chrome'
npx playwright test tooling/browser-tests/schedule-shell.spec.mjs --grep "kanban quick status uses checked shared writes" --output artifacts/browser-schedule-quick-status
npx playwright test
```

네이티브 입력/잠금 회귀, JSON 정확한 복사본·응답 분류, 미확정 문서 잠금/미전송 범위 복구와 실제 React 해제/라우트/늦은 ACK를 검사한다. 브라우저에서는 신규/수정/상태 확인·취소·프로필, 충돌 비교, 저장 후 GET 실패/읽기만 재시도와 독립 댓글 초안을 검증한다. 이 공통 런타임 변경의 최종 증거는 여섯 앱 전체 회귀이며 일정 집중 검사만으로 대신하지 않는다. 실행 완료 수치/실패·시각 검증은 MIGRATION에 기록한다.

## 일정 업무 저장 서버 계약 검증

`TaskWriteProtocolTests`는 실제 격리 TestServer/SQLite의 생성·수정·상태 저장을 검사한다. 합성 계정/CSRF·첨부·댓글, 전체 ACK/기준값, 레거시 형식, 권한/비공개·동시 쓰기와 커밋 전후 예외를 포함한다. 커밋 후 예외의 DB 반영도 확인하며 운영 데이터/인증/API를 사용하지 않는다. 검사 fixture의 선택적 transaction interceptor는 테스트에만 주입된다. 실제 UI 연결은 위의 React/브라우저 검사와 구분한다.

```powershell
dotnet test apps/schedule/tests/Schedule.Tests.csproj -c Release
node --test tooling/tests/schedule-task-writes.test.mjs
npm run check
npm --prefix apps/schedule test
npm --prefix apps/schedule run build
```

## 일정 이미지 업로드 검증

본문·댓글 공통 `Editor` → `useImageUploads` → generated `workspace-form`의 multipart 전송이 실제 업로드 경로다. 선택·붙여넣기·드롭 모두 최신 회사 계정과 첨부 목록을 대조하고 파일 SHA-256을 계산한 뒤 공통 확인창을 연다. 전송 중에는 편집기와 바깥 저장을 잠그며 서버가 확인한 digest·owner·전체 Attachment를 검증한 뒤에만 초안 목록에 넣는다.

```powershell
node --test tooling/tests/schedule-task-writes.test.mjs
npm --prefix apps/schedule exec vitest run src/useImageUploads.test.ts
dotnet test apps/schedule/tests/Schedule.Tests.csproj -c Release --no-restore
npm run pretest:browser
$env:WORKSPACE_BROWSER_CHANNEL='chrome'
npx playwright test tooling/browser-tests/schedule-shell.spec.mjs --grep "task image upload uses checked shared multipart writes" --output artifacts/browser-schedule-image-upload
npx playwright test tooling/browser-tests/schedule-shell.spec.mjs --output artifacts/browser-schedule-image-upload-all
```

서버 검사는 기존 단일 Attachment 응답과 opt-in envelope를 함께 확인하고 잘못된 actor·magic bytes가 파일 생성 전에 거부되는지 검사한다. 브라우저 집중 검사는 모바일 다크·PC 라이트에서 확인 취소 전 요청 0건, 컨트롤 잠금, 정확한 multipart 헤더·첨부 반영과 가로 넘침을 확인한다. 합성 HTTP는 운영 파일 볼륨 저장 증거가 아니며 첫 파일 쓰기 뒤 timeout/abort를 롤백으로 단정하지 않는다.

## 일정 업무 상세 조회 검증

`useTaskDetail.test.ts`는 실제 공통 읽기 세션과 React를 사용해 전체 상세/대상·댓글/첨부 관계, 원문·버전 후퇴, 오류·폴링 정지·명시적 재시도, 취소 무시/timeout·계정/라우트/해제와 기존 작업 결과 우선 적용을 검증한다. 브라우저 `task detail shared reads`는 실제 빌드에서 320/1440px·두 테마의 초안·권한 재확인과 늦은 응답을 검사한다. 기존 task action/conflict review 시나리오도 필수다. HTTP는 합성이며 운영 계정/DB를 사용하지 않는다.

```powershell
npm --prefix apps/schedule test
npm --prefix apps/schedule run build
npm run check
$env:WORKSPACE_BROWSER_CHANNEL='chrome'
npx playwright test tooling/browser-tests/schedule-shell.spec.mjs --grep 'task detail shared|task action confirmation|task confirmation refuses|task conflict review' --output artifacts/browser-schedule-detail-focused
npx playwright test tooling/browser-tests/schedule-shell.spec.mjs --output artifacts/browser-schedule-detail-all
```

## 공휴일 서버 계약과 native 복구

`LeavePageTests.Holiday` 필터는 실제 격리 SSO/SQLite와 테스트 HTTP로 추가·수정·삭제·JSON/온라인 가져오기, 전체 연도 기준값/큰 ID·정규화·집계·덮어쓰기·외부 조회 중 변경·입력/CSRF/역할 거부와 저장 후 감사 실패를 검사한다. 전체 Razor 준비에 포함되며 `leave.holiday.html/json`, `leave.holiday.imports.json`, `leave.holiday.unknown.html`을 생성한다. `leave-holidays.spec.mjs`는 실제 확인/순차 저장·초안·전체 응답·거부·계정/해제/늦은 응답을, `leave-holiday-native.spec.mjs`는 native unknown 화면의 320/1440px·두 테마 잠금/원문/새 탭 링크를 검증한다. 원문/ID·적용 건수 단위 검사는 `leave-holidays.test.mjs`다.

```powershell
node tooling/prepare-razor-fixtures.mjs
$env:WORKSPACE_BROWSER_CHANNEL='chrome'
npx playwright test tooling/browser-tests/leave-holiday-native.spec.mjs --output artifacts/browser-leave-holiday-native
npx playwright test tooling/browser-tests/leave-holidays.spec.mjs --output artifacts/browser-leave-holiday-shared
npx playwright test tooling/browser-tests/leave-shell.spec.mjs --grep 'admin settings common controls' --output artifacts/browser-leave-holiday-controls
```

## 채널 알림 설정 저장 검증

`LeaveWebhookTests`는 실제 격리 SSO/SQLite와 테스트 HTTP로 등록·삭제·정확한 발송 목록, 큰 ID·CSRF·직원 POST 거부·stale/invalid, 일부 발송과 감사 실패를 검사한다. `prepare-razor-fixtures.mjs`의 LeavePageTests 필터에 포함되며 `leave.webhook.html/json`을 생성한다. `leave-webhooks.spec.mjs`는 이를 실제 공통 자산과 연결해 320/1440px·두 테마 확인/순차 저장·초안·거부/손상/늦은 응답/폼 제거를 검증한다. `leave-webhooks.test.mjs`와 구조 변이 검사가 전체 ACK·공통 소유권을 검사한다. 운영 웹훅을 호출하지 않는다.

```powershell
node tooling/prepare-razor-fixtures.mjs
$env:WORKSPACE_BROWSER_CHANNEL='chrome'
npx playwright test tooling/browser-tests/leave-webhooks.spec.mjs --output artifacts/browser-leave-webhooks-focused
npx playwright test 'leave-' --output artifacts/browser-leave-webhooks-all
```

## 연차 공휴일·채널 설정 컨트롤

`leave-shell.spec.mjs`의 `admin settings common controls`는 실제 Razor로 공통 계산 색·44px 입력·모바일 단일 열, 고유 DOM ID/독립 입력, JSON 원문 FormData·native 검증, 테스트 발송 disabled와 표 키보드 진입/가로 넘침을 확인한다. 공휴일 덮어쓰기는 `cw-check-control`/`cw-checkbox`의 18px 크기와 선택 배경 변화도 검사하고 `.holiday-overwrite-check`에 앱별 skin을 두지 않는다. PC/모바일·라이트/다크 `fields.png`/`table.png`를 직접 확인한다. 이 검사는 컨트롤 범위이며 실제 저장/발송 수명주기는 위의 공휴일/채널 알림 설정 검증을 따른다. 운영 웹훅/공휴일 API를 호출하지 않는다.

```powershell
node tooling/prepare-razor-fixtures.mjs
$env:WORKSPACE_BROWSER_CHANNEL='chrome'
npx playwright test tooling/browser-tests/leave-shell.spec.mjs --grep 'admin settings common controls' --output artifacts/browser-leave-admin-controls-focused
npx playwright test 'leave-' --output artifacts/browser-leave-admin-controls-all
```

## 팀 일정 공통 조회 검증

`scheduleReads.test.ts`는 필수 응답·원문/정수 ID·주별 캐시·200개 연속 페이지·상태별 표시 한도를 검사한다. `useScheduleData.test.ts`는 실제 공통 런타임과 React를 함께 사용하여 조건 교체·timeout·폴링/오류 보존·계정/권한/pagehide·동일 계정 편집기 확인을 검사한다. 테스트 전용 Vite 파일 허용은 공통 UI 소스 디렉터리에만 추가하고 개발 서버 설정은 확장하지 않는다.

Chrome `schedule shared read`는 초기 503, 손상된 본문, 같은 조건의 정상값 유지, 조건 변경, HTML 403, 권한 변경 뒤 이동, 취소를 무시하는 늦은 JSON과 명시적 GET 재시도를 검사한다. `read-error-last-snapshot.png`, `read-denied.png`의 실제 PC/모바일·두 테마를 확인한다. 기존 업무/댓글/버전/TODO 회귀와 함께 실행하며 공통 JS 변경이므로 `pretest:browser` 뒤 여섯 앱 전체 검사가 필요하다. 대표 공통 연결을 삭제하거나 raw bootstrap을 되살리는 변이는 `checkScheduleReads`에서 검출하지만 완전한 데이터 흐름/보안 검사로 해석하지 않는다.

## 팀 일정 탐색·필터 검증

record cards and cell 시나리오는 업무 카드의 식별 색·실선 테두리·공통 강조/hover/선택/disabled, 주요 일정 상세와 업무 상세 진입, 셀 전체 기하·키보드 등록의 정확한 직원/날짜, 칸반 dragstart ID를 검사한다. record-cards.png/record-kanban.png를 직접 확인한다. pointer 클릭 후 programmatic focus만으로 focus-visible을 가정하지 않고 실제 Tab/Shift+Tab으로 진입한다. 공유 record 강조 선택자는 disabled보다 강한 specificity를 갖지 않도록 유지한다. 공통 CSS 변경 시 build:ui와 pretest:browser 후 여섯 앱 전체 Playwright를 실행한다. 합성 드래그 검사는 서버 PATCH나 운영 저장 증거가 아니다.

week board actions preserve는 겹친 4개 업무의 개별/전체·그룹 펼침, 주요 일정 밀도, 집중 보기 왕복, 지연된 기간 GET의 중복 클릭 차단, 모바일 날짜/직원 전달과 독립 범례 disclosure를 검사한다. board-legend.png/board-expanded.png/board-focus-view.png를 직접 확인한다. 다크 접기 버튼의 옛 expand-person 색 규칙과 compact 절대 위치가 공통 상태/크기를 덮어쓰지 않는지 확인한다.

일정 단위/빌드와 schedule-shell.spec.mjs 전체를 실행한다. board filters share 시나리오는 주간 일정/칸반의 계산 스타일, 필터 실제 GET query, 공통 초성 선택/포커스, 분류/기간/행 높이 선호, 보기 설정 DOM 유지와 TODO 왕복 복원을 검사한다. 주말/선택 주 및 상세 보기 checkbox의 공통 class·18px 입력·선택 배경과 switch 의미도 320/1440px·두 테마에서 확인한다. PC/모바일의 view-options-checkboxes.png, weekend-filter-selected.png, week-filter-selected.png와 board-controls.png/kanban-controls.png를 직접 확인한다. 문서 폭 외에 각 select의 필드 폭과 날짜 문구 내부 잘림을 확인한다. 칸반 업무 상태 PATCH와 이미지 multipart 업로드의 전체 수명주기는 위 집중 시나리오가 각각 검사하며, 개인 TODO checkbox까지 board filters 검사의 증거로 확대하지 않는다.

`schedule demo and today indicators use shared semantic pills`는 demo bootstrap과 고정 날짜를 사용해 warning/info `cw-state-pill`의 실제 계산 색과 기존 반응형 표시 정책을 확인한다. 320px에서는 demo pill이 숨고 모바일 오늘 pill이 보이며, 1440px 밀집 보드는 demo pill과 오늘 열 테두리를 보이고 중복 오늘 문구는 숨긴다. `schedule-state-pills.png`와 실제 scrollWidth를 확인한다. 전용 `.status-badge`/`.day-header small` palette·크기나 다크 보정을 다시 추가하지 않는다.

## 팀 일정 업무·댓글 컨트롤 검증

`calendar common controls`는 날짜 이동창과 중첩 달력의 계산 색/연도 폭·7열 셀 너비·높이, 주말/공휴일 색, 윤일/종료일 하한·지우기/실패 재시도를 검사한다. 연도는 실제 키보드 Tab 또는 Enter로 확정하고 native select의 `selectOption`만으로 blur가 일어났다고 가정하지 않는다. 실제 모바일 캡처로 4자리 잘림과 달력/이동창의 포커스 복귀를 확인한다.

관리 화면은 `management common controls`에서 긴 제목·원문/프로젝트 ID/버전, 기존 수정·신규 등록·삭제 취소/실행·충돌 초안·전송 중 비활성·보관함 이동을 검사한다. `management-controls.png`와 `management-editor.png`의 PC/모바일·두 테마 viewport를 직접 확인한다. synthetic 성공 응답으로 운영 DB/저장 결과 불확실성까지 검증했다고 주장하지 않는다.

일정 단위/빌드 후 `schedule-shell.spec.mjs` 전체를 실행한다. `task conflict review`와 `comment conflict review`의 PC/모바일·두 테마 시나리오에 실제 스타일/라벨·textarea 140px·날짜 입력/버튼 간격·편집 폭·이미지 닫기 후 포커스 검사가 포함된다. 편집 진입과 본문/댓글 viewport 캡처를 직접 확인한다. 공통 셸/엔티티/달력 popup의 별도 검사를 생략하거나 raw 업무 저장 수명주기 완료로 확대 해석하지 않는다.

## 팀 일정 기록 컨트롤 검증

`npm --prefix apps/schedule test`와 `npm --prefix apps/schedule run build` 후 Chrome에서 `npx playwright test tooling/browser-tests/schedule-shell.spec.mjs`를 실행한다. `support/schedule-controls.mjs`는 이관한 버전/TODO 루트의 실제 계산 스타일을 검사한다. 특히 다크 hover·fieldset disabled·탭 선택과 신규/기존 입력 라벨, 버전 표의 ArrowRight 이동/상세 폭을 확인한다. 이 검사는 합성 HTTP 기반이며 실제 운영 기록/개인 할 일을 변경하지 않는다.

버전 기록의 읽기 전용 상태는 `cw-state-pill`을 사용한다. 안정·해결 완료는 success, 불안정·롤백·건너뜀은 danger, 상태 미기재는 neutral이다. 일정 앱은 상태 판정·문구와 카드 배치만 소유하며 `.release-status`에 배경·글자색·테두리·크기·테마를 다시 만들지 않는다. 구조 변이와 `release lists share disclosure` 브라우저 검사는 공통 class/tone, 계산 색과 기존 목록 펼치기·실패 복구를 함께 확인한다.

## 연차 감사 조회 검증

`node tooling/prepare-razor-fixtures.mjs`에 포함된 `LeaveAuditTests`가 실제 Razor 출력과 조회·인가를 검증한다. `$env:WORKSPACE_BROWSER_CHANNEL='chrome'` 설정 후 `npx playwright test tooling/browser-tests/leave-audit.spec.mjs tooling/browser-tests/leave-shell.spec.mjs`로 작업 종류 info pill·단일 상세·검색/페이지·native GET·오류/권한/늦은 응답과 기존 연차 셸을 확인한다. 검색·페이지 GET은 공통 read session의 `leave-audit` 채널을 사용하고, 새 조회·입력 변경·범위 변경·해제와 15초 timeout 뒤 취소를 무시한 body가 적용되지 않는지 검사한다. 실제 계산된 두 테마 색/입력 높이·문서 너비와 viewport 화면을 구분해 검사한다. 감사 원문은 합성 값이며 운영 DB에 테스트 로그를 넣지 않는다.

## Portal 계정·조직 컨트롤 검증

`node tooling/prepare-razor-fixtures.mjs`로 격리 TestServer/SQLite에서 실제 Razor 출력과 계정·조직·아이콘 계약을 검증한다. 이후 `WORKSPACE_BROWSER_CHANNEL=chrome`에서 `portal-shell.spec.mjs`, `portal-notification-ids.spec.mjs`, `organization-form.spec.mjs`, `project-icon.spec.mjs`, `profile-form.spec.mjs`를 실행한다. `support/portal-controls.mjs`는 실제 계산 스타일을, 기존 시나리오는 등록/수정 필드 일치·공용/비공개·저장/충돌/원문·native fallback·계정 범위 등을 검사한다. 넓은 표의 요소 캡처를 모바일 문서 넘침으로 혼동하지 않고 실제 viewport 캡처/scrollWidth·키보드 이동을 함께 확인한다. 운영 계정/저장소에 테스트 쓰기를 보내지 않는다.

## CS 컨트롤 검증

`npm --prefix apps/cs run check`와 `npm --prefix apps/cs test` 후 PowerShell에서 `$env:WORKSPACE_BROWSER_CHANNEL='chrome'`를 지정하고 `npx playwright test tooling/browser-tests/cs-`를 실행한다. 공통 helper는 실제 입력/버튼의 계산 색·크기·라벨·선택/비활성과 `cw-state-pill`의 tone별 공통 배경/글자색을 검사하며 플레이어 검사는 편집기 기하·행 버튼 한 줄/셀 경계·모바일 표의 ArrowRight 스크롤도 확인한다. shell은 네 문서의 초기 neutral 상태와 레이아웃을, 실제 업무 모듈은 환경·거래·검색 작업·미리보기의 의미 tone 전환 및 읽기/쓰기 수명주기를 검사한다. 이미지의 줄바꿈·대비를 직접 확인하고 공통 CSS 변경 시 다른 앱 회귀도 실행한다. 예외와 남은 범위는 `packages/contracts/cs-controls.md`에 기록한다.

## 시트 조회 검증

`sheetReads.test.ts`는 전체 설정/분석/비교/기록 응답, truncated 규칙/빈 blocked 원문·큰 숫자 문자열과 잘못된 링크/날짜/건수/중복/대상을 검사한다. `api.test.ts`는 no-store·same-origin·기존 POST/GET, 손상 JSON/HTML/401·403 및 늦은 JSON 후 인증 부작용 배제를 검사한다. `useSheetData.test.ts`는 생성된 공통 `WorkspaceReadSession`의 `main`·`preview` 채널을 쓰는 실제 React hook에서 원자적 초기 표시·실패 재시도·늦은 결과/이전 finally·30초 관찰 제한·계정/화면/StrictMode/해제·쓰기 후 갱신을 검증한다. `sheet-read-session-contract.test.mjs`는 로컬 AbortController/Promise.race/timeout 복귀와 checked transport 우회를 거부한다. mock API와 실제 HTTP의 검증 범위는 구분한다.

`sheet-shell.spec.mjs`는 실제 배포 번들에서 잘못된 응답/다른 대상 뒤 정상 행 보존, 403 뒤 본문/원본 링크 제거, 명시적 다시 열기, 계정 변경 뒤 취소를 무시하는 JSON, 비교 중 이동/복귀를 추가 검사한다. 기존 수식/한국어 실행·후속 읽기 테스트의 합성 응답도 서버 전체 형식과 일치해야 한다. 누락된 fixture를 이유로 실제 응답 검증을 완화하지 않는다. 실행 명령과 시각 검증은 아래 시트 컨트롤 절차를 따른다.

## 시트 컨트롤 검증

`npm --prefix apps/sheet run typecheck`, `npm --prefix apps/sheet test`, `npm --prefix apps/sheet run build`, `npm --prefix apps/sheet run test:runtime`으로 실제 React/서버 출력을 검사한다. 이후 `WORKSPACE_BROWSER_CHANNEL=chrome`에서 `npx playwright test tooling/browser-tests/sheet-shell.spec.mjs`를 실행한다. 공통 버튼·필드·표 색과 비활성/키보드, 상단 Google/데모 연결 pill의 success/warning tone·계산 색, 수식/한국어 검색·빈 결과·읽기 전용 확인창, 스냅샷 메타데이터 단일 펼치기·긴 ID/화면 재진입을 실제 번들과 합성 HTTP로 검증한다. 수평 스크롤 키보드 이동은 ArrowRight를 사용하며 End를 가로 끝 이동으로 가정하지 않는다. 세 본문의 모바일 넘침과 실제 light/dark 스타일을 검사하고 캡처 전 문서를 맨 위로 돌려 고정 헤더 위치를 확인한다. 공통 런타임/CSS를 바꾸는 경우에는 시트 집중 검사만으로 다른 앱의 회귀를 생략하지 않는다.

## 통계 본문 조회 검증

`statistics-reads.md`에 따라 초기 `/api/config`와 필터별 `/api/analytics/overview`는 공통 read session의 독립 채널과 단일 checked JSON transport를 사용한다. `npm --prefix apps/statistics run check`, `npm --prefix apps/statistics test`와 루트의 `statistics-read-session-contract.test.mjs`로 private AbortController/Promise.race 복귀, 공통 취소·30초 제한·최신 ticket·해제, same-origin/no-store/manual redirect와 JSON 형식을 검사한다. `overview-contract.test.js`는 전체 데모 payload와 최상위/요약·추이·결과·버전·차원·빌드/추천 조합/룬·보스 하위 구조의 손상을 검사하고, 실제 `aggregateEvents` 결과도 같은 검증기를 통과한다. `statistics-shell.spec.mjs`는 기존 전체 화면/필터·상세에 더해 HTML bootstrap, 손상된 중첩 overview의 적용 전 거부와 계정 변경 뒤 취소를 무시하는 JSON을 실제 배포 문서에서 검사한다. 합성 HTTP와 격리 집계이며 운영 Azure/PlayFab을 검증한 것은 아니다.

## 통계 갱신의 접수 계약 검증

`npm --prefix apps/statistics test`는 실제 집계 코어/임시 SQLite와 캐시, 로컬 HTTP/IPC 접수·중복·timeout/늦은 응답·워커 교체 및 SSO 헤더 위조 거부를 포함한다. `test/refresh-runtime.test.js`는 실제 app-server와 worker를 실행하지만 외부 fetch는 `test-support/empty-azure-loader.js`로 차단하고 환경은 합성 값과 임시 데이터 경로만 전달한다. 이 로더를 운영 시작 명령에 넣지 않는다. Docker는 기존 `COPY lib`로 새 모듈을 포함하고 test-support는 포함하지 않는다.

접수 202와 실제 집계 ready/error를 구분한다. 변경 시 `packages/contracts/statistics-refresh.md`의 전체 ACK·revision·쿨다운·미확정 경계를 검사한다. context/status GET은 `statistics-refresh-context`·`statistics-refresh-status` 공통 read session 채널과 30초 관찰 제한을 사용하고, POST의 `requestMutation`만 전송 결과 미확정 처리를 위한 별도 AbortController/timeout race를 소유한다. 루트 `statistics-read-session-contract.test.mjs`는 이 경계가 다시 합쳐지는 변경을 거부한다. 실제 UI는 `WORKSPACE_BROWSER_CHANNEL=chrome`으로 `npx playwright test tooling/browser-tests/statistics-refresh.spec.mjs tooling/browser-tests/statistics-shell.spec.mjs`를 실행한다. 테마 이름만 붙이지 말고 실제 `html[data-theme]`도 검사한다. 격리 서버를 종료할 때는 부모 exit뿐 아니라 fork worker의 상속된 파이프 close까지 기다린 후 임시 SQLite를 제거한다. 운영 부하·배포 검증은 격리 테스트와 별개다.

## 통계 공통 컨트롤 검증

`npm --prefix apps/statistics run check`와 `npm --prefix apps/statistics test`로 앱 구문/계약/표 의미 색 매핑을 검사한다. `WORKSPACE_BROWSER_CHANNEL=chrome`에서 `npx playwright test tooling/browser-tests/statistics-shell.spec.mjs`를 실행한다. 합성 통계 HTTP만 사용하고 운영 refresh/API에 연결하지 않는다. 집중 네 시나리오는 native 숫자 입력을 실제 Tab으로 확정하고 정렬 버튼에서 Tab으로 설명 버튼에 이동한다. 진행도·완성 조합·보스 연계 checkbox의 공통 class, 실제 18px 크기, 선택 배경과 조건부 hidden도 320/1440px·라이트/다크에서 확인한다. 마우스 focus를 키보드 focus-visible로 오해하거나 synthetic change와 blur의 중복을 만들지 않는다. 두 폭/테마의 선택·비활성·셀 의미 색·표 포커스·가로 넘침과 조합 옵션 표시를 실제 계산 스타일/동작으로 확인한다. 공통 CSS를 변경했으므로 최신 생성 자산/React 빌드/실제 Razor fixture로 여섯 앱 전체 회귀도 필요하다.

상단 집계 상태를 변경할 때는 같은 브라우저 검사에서 `cw-state-pill`, 최종 warning tone과 `--cw-warning-bg`/`--cw-warning`의 실제 계산 색을 확인한다. 320px·390px에서는 상단 작업 영역과 긴 집계 시각이 문서 가로 폭을 늘리지 않는지도 함께 검사한다. 앱 단위 초기화 검사는 확인 중·데모와 집계 중·완료·오류의 tone 매핑을 실행한다.

## 공통 primitive 누락 방지

- 새 버튼/일반 입력/표/창은 `packages/contracts/ui-primitives.md`를 따른다. 새 페이지와 기존 파일 모두 검사한다. `npm run ui:debt`는 기존 표기·호출 위치를 읽기 전용으로 보여준다.
- `npm run check:primitives`는 정확한 기존 코드 서명/개수와 대조한다. 공통 UI 전환과 해당 동작 검증 후 `npm run ui:debt:prune`으로 제거된 부채만 정리한다. 새 예외/개수 증가를 수락하는 명령은 없다.
- `ui-primitives.test.mjs`는 literal HTML/JSX/템플릿, 잘못된 속성·조건부 클래스·동적 접미사, native 생성/확인, 정확한 부채 범위·중복/제거/메타데이터 검증을 검사한다. `generator.test.mjs`는 격리된 실제 여섯 앱 생성기에 새 raw 태그/기존 파일 추가/가짜 generated 파일/실제 생성 파일 변조를 주입해 실패를 확인한다. 감소와 신규 위반이 함께 있는 prune는 파일을 변경하지 않아야 한다.
- 생성 바이트 검사는 별도 작업 디렉터리를 명시할 수 있지만 기본 빌드 출력은 동일하다. CI가 실행하는 기존 `check:ui` → `check-architecture`에 primitive 검사가 포함된다. 원격 필수 보호 설정은 별도 확인 대상이다.
- 일반 primitive 검사는 모든 checkbox/file 소비자·임의 동적 생성·완전한 폼 수명주기를 보증하지 않는다. 단일 checkbox는 `cw-check-control`/`cw-checkbox`, 검색형 다중 선택은 `cw-choice-group`을 사용하고 이관한 소비자 계약에서 강제한다. 앱 UI 런타임을 변경하면 실제 서버/브라우저/테마/접근성 검증을 계속 수행한다.

## 연차 보정·발생분 편집기 검증

- `LeaveGrantManagementTests.cs`는 실제 격리 SSO/SQLite HTTP로 보정 합산·다섯 발생 유형·음수/퇴사/비공개·윤년 만료일·큰 ID 삭제·취소 신청 배정/정산 제한·기준값 충돌·CSRF/인가·감사 후 미확정·native 원문을 검사한다. `LeavePageTests` fixture 준비에 자동 포함된다.
- `checkLeaveGrantProtocol`과 변이 검사는 현재 서버 계약·공통 hash·업무 제한·원문 복구의 대표 누락을 거부한다. 생성기 격리 검사에도 공통 hash 파일을 복사한다. 이 검사는 실제 인가·경쟁 제어·정상 편집 UI 전환을 대신하지 않는다.
- 실제 오류 Razor fixture `leave.adjustment-recovery.html/.json`으로 Chrome `leave-grants-recovery.spec.mjs`를 실행한다. 320/1440px·light/dark, 공통 오류 표시·인코딩·쓰기 폼 제거·새 탭 GET·문서 넘침을 확인한다. `LeaveGrantSnapshot`은 정산과 공유하므로 정산 서버/브라우저 회귀도 실행한다.
- 정상 `leave.grants.html/.optional.html/.json`도 실제 격리 서버에서 생성한다. `leave-grants.spec.mjs`는 보정/추가/삭제 여섯 순서, 동일 슬롯 재사용 금지, 직원별 삭제 사유/별도 폼 초안 보존, 명시 날짜/윤년, 읽기 재시도·늦은 응답·scope/해제/실제 30초 전송 제한, 전체 ACK/403/409/422/500, 공통 버튼의 활성/비활성 색과 직원 표시를 검사한다. 직원별 Baseline GET은 공통 read session의 독립 채널을 사용하며 같은 직원의 동시 조회는 공유한다. 읽기 관찰 제한은 15초다.
- `leave-grants-values.test.mjs`는 BigInt 기반 정밀 일수/ID와 전체 반환값·윤년 만료일을 검사한다. `checkLeaveGrantClient`/변이 검사는 공통 세션/폼/확인/상태/필드/행/버튼·기준값·초안 연결의 대표 우회를 거부한다. 계약은 `packages/contracts/leave-grants.md`다. 공통 버튼/확인창 변경은 여섯 앱 전체 회귀가 필요하다.

## 연차 정산과 native 필드 검증

- `LeaveSettlementTests.cs`는 실제 격리 SSO/SQLite·CSRF·관리자/대상 정책·세 정산 유형·이월 기간/연결·기준값 충돌·감사 후 미확정·native 원문을 검사한다. 기존 Razor fixture 준비에 포함되며 `leave.settlements.html/.optional.html/.json`을 만든다.
- `WORKSPACE_BROWSER_CHANNEL=chrome` 설정 후 `npx playwright test tooling/browser-tests/leave-settlements.spec.mjs`로 두 폭/테마의 초성 선택·공통 확인·전체 응답·오류/미확정·계정/해제/timeout/DOM 제거·초안/중복 제출을 검증한다. HTTP와 직원/연차 기록은 격리하며 운영을 쓰지 않는다.
- `checkLeaveSettlements`와 변이 검사는 공통 전송/확인/필드 및 서버 연결의 대표 누락을 거부한다. 실제 테스트를 대체하지 않는다. `primitives.css` 변경 후에는 생성 자산·여섯 서비스 전체 브라우저 회귀를 다시 확인한다.

## 복수 폼 저장과 조회 순서 검증

- `form-session.test.mjs`는 공통 작업 세션의 상호 배제, 확인된 대상/기준값 소모, 미확정 문서 잠금, 초안·stale lease·계정/해제/bfcache·구독과 GET revision을 검사한다. `leave-form-session-contract.test.mjs`는 네 편집기의 공통 세션 연결과 늦은 읽기 보호를 제거하는 대표 변이를 거부한다.
- `leave-form-session.spec.mjs`는 실제 `leave.calendar-admin.html/.json` fixture에서 신청·강제 추가·외부 일정의 여섯 저장 순서/두 테마·폭, 취소/강제 삭제의 공유 대상, 확인된 외부 일정 생성→수정, 두 번째 쓰기의 미확정/422·scope/이탈, 늦은 달력/내역 GET의 성공/실패를 검증한다. 두 부분 GET은 `leave-dashboard-reads.md`에 따라 공통 read session의 독립 채널, 단일 checked HTML transport, 현재 직원과 폼 revision을 사용한다. 개인 초안은 저장한 기준값과 구분한다. 일반 날짜 선택 모드와 확인된 신청 폼의 달력 상세 동작도 함께 검사한다.
- `CompanyForm.createSession`을 수정하면 소비자 밖의 공통 런타임도 다시 생성하고 전체 서비스 브라우저 회귀를 수행한다. 계약과 API는 `packages/contracts/form-session.md`다. 이 검사는 실제 운영의 다중 탭 멱등성·DB CAS·배포 증거가 아니다.

## 달력 관리자 연차 서버 검증

- `LeaveCalendarAdminTests.cs`의 실제 SSO/SQLite 검사는 fixture 준비에 포함된다. 큰 ID의 추가→응답 기준값→삭제 왕복, 관리자/CSRF/전체 신청 날짜 변경, 입력·직원 정책, 과거/반차/미차감·기존 삭제 배정/상환 처리, 저장 전/후 미확정 및 native 원문 보존을 검사한다.
- `leave-external-recovery.spec.mjs`는 외부 일정과 관리자 추가/삭제 실패 화면을 같은 검사로 검증한다. 두 폭/두 테마에서 실제 인코딩 원문·쓰기 잠금·의미 색·가로 넘침·새 탭 GET을 확인하고 팝업도 격리한다.
- `leave-calendar-admin.spec.mjs`는 실제 Razor의 관리자 추가/삭제 흐름과 일반/optional 사유 설정을 검증한다. 공통 확인창, 모든 응답 필드·전체 날짜·초안/날짜 이동·다른 POST/늦은 GET·계정/해제/timeout/DOM 제거를 포함한다. `checkLeaveCalendarAdminClient`/변이 검사는 대표 공통 구조 우회를 거부한다.
- 서버/클라이언트 정적 누락 검사는 실제 인가/시각 검증과 별개다. 복수 초안 순차 저장은 공통 작업 세션으로 검증하며 기존 날짜 상세 프레임 등 남은 범위를 유지한다. fixture 정규식은 렌더링된 div 칩에 한정해 inline JS 템플릿 문자열을 JSON으로 읽지 않는다.

## 외부 일정 화면·서버 계약 검증

- `LeaveExternalScheduleTests.cs`는 전체 .NET 통합 및 기존 Leave fixture 준비에 포함된다. CRUD·응답 fingerprint 왕복·안전 정수 밖의 ID, 잘못된 수정 ID의 생성 전환 방지, 권한/CSRF/오래된 내용/대상 정책과 native 호환을 확인한다. 감사 실패 전에 DB 변경이 남는 경우와 업무 저장 자체 실패를 각각 검사한다.
- `leave.external-recovery.html/.json`으로 `leave-external-recovery.spec.mjs`를 실행한다. 실제 격리 Razor 오류 화면의 PC/mobile light/dark, 넘침·인코딩, 쓰기 UI 제거 및 새 탭 GET 복구를 검사한다. 운영 계정/일정은 사용하지 않는다.
- `leave-external-schedules.spec.mjs`는 실제 `leave.external-schedules.html/.json`을 사용한다. 공통 확인·native FormData·전체 응답, 초안/포커스·정확한 CRUD, 다른 신청 보존·달력 교체·계정/해제/timeout, 처리 중 GET 응답/오류 및 프로그램 입력 변경을 검사한다. `name=id`의 DOM 속성 가림 회귀는 실제 삭제 동작으로 검증한다. 연차 신청을 날짜 선택 상태로 둔 채 상세를 클릭하는 식의 잘못된 테스트를 피하고, 비활성 월간 보기 대신 실제 달력 이동 링크를 사용한다.
- `checkLeaveExternalScheduleClient`와 변이 검사는 대표 공통 처리/정확한 응답/달력 기준값/다른 연차 어댑터의 초안 연결 우회를 거부한다. 이는 전체 인가나 UI 적합성의 증명을 대신하지 않는다. 기존 상세 프레임·관리자 강제 작업 전환은 남아 있다. 계약은 `packages/contracts/leave-external-schedules.md`다.

## 직원 취소·철회 검증

- `LeaveSelfActionTests.cs`는 기존 Leave fixture 준비 범위에서 실행된다. 실제 격리 Portal SSO/Leave/SQLite로 세 상태 전환, 소유권/CSRF/대신보기·지난 날짜·기준값 불일치, native 호환과 commit 후 감사 실패를 검사한다. 월 경계를 넘는 신청도 목록/달력/관리자가 같은 해시를 사용하는지 검증한다.
- `leave-self-actions.spec.mjs`를 신청/승인/셸/알림/Discord와 함께 실행한다. 목록과 달력 상세의 확인/포커스·정확한 응답·초안 보존·403/409/422/500·동적 목록 교체·범위/해제/timeout, 변경된 확인 대상·제거된 폼·신청과 취소의 경쟁을 검사한다. 쓰기 관찰 중 beforeunload와 완료 후 이동도 구분한다. 실제 운영 신청/알림은 사용하지 않는다.
- `checkLeaveSelfActions`와 변이 검사는 공통 요청/확인창/상태, 공유 부분 폼/스냅샷/소유권, 전체 응답 대조와 입력·목록 잠금의 대표 누락을 거부한다. 생성기 격리 fixture는 새 서버 해시 소스도 포함한다. 정적 마커·통합 실행·브라우저/실제 화면 증거를 혼동하지 않는다.

## 직원 연차 신청 검증

- `LeaveApplicationTests.cs`는 실제 Portal SSO/Leave/SQLite에서 네 신청 유형, 주말/공휴일 제외, 현재 직원/대신보기/CSRF/형식 오류, native 호환과 HTML 원문 보관을 검사한다. DB commit 후 감사 실패를 강제로 발생시켜 신청이 남았는데 결과는 unknown인 경우도 확인한다. `WORKSPACE_RAZOR_SNAPSHOTS`를 설정한 기존 fixture 준비 명령은 일반 직원/관리자의 실제 신청 화면을 생성한다.
- `leave-application.spec.mjs`를 기존 Leave 셸/승인/알림/Discord spec과 함께 실행한다. 실제 Razor/공통 런타임에서 신청 확인, 포커스 복원, 패널 재열기 초안, 중복/미확정 잠금, 다른 POST 편집 초안, 정확한 응답/경로/필터, 계정 변경·해제·timeout 및 PC/mobile light/dark를 검사한다. HTTP는 격리하며 실제 신청/알림은 실행하지 않는다.
- `checkLeaveApplication`과 변이 검사는 대표 공통 처리/응답/서버 대조 우회를 거부한다. 새 서버 소스를 검사할 때 생성기 격리 fixture에도 해당 파일을 복사해야 한다. 정적 마커 검사는 실제 동작·인가·시각 검사와 별도 증거다. 계약은 `packages/contracts/leave-application.md`를 따른다.

## 연차 승인 검증

- `LeaveApprovalTests.cs`는 기존 `LeavePageTests` fixture 준비 범위에 포함된다. 실제 Portal SSO/Leave 인증·Razor/SQLite에서 승인/반려/취소 승인/반려·강제 삭제와 문자열 ID/로컬 직원/스냅샷 응답, CSRF·자기 신청·일반 직원 인가·native 호환·업무 변경 후 감사 실패를 검사한다. `leave.approvals.html/.json`은 격리 응답이며 운영 신청을 쓰지 않는다.
- `npx playwright test tooling/browser-tests/leave-approvals.spec.mjs tooling/browser-tests/leave-shell.spec.mjs tooling/browser-tests/leave-notifications.spec.mjs tooling/browser-tests/leave-discord.spec.mjs`로 실제 생성 fixture와 공통 자산을 검증한다. PC/mobile light/dark·비활성 의미 색·정확한 submitter/ID·확인 취소/포커스·중복 방지·다른 행 사유 보존·GET 복구·권한/오류·범위/해제/timeout을 포함한다. 승인 대기열의 3초 summary와 전체 목록은 공통 read session의 분리된 채널을 사용하며, 확인 시작·새 조회·계정 변경·해제에서 늦은 결과를 적용하지 않는지도 검사한다.
- `checkLeaveApprovals`와 변이 검사는 공통 처리·기준값·전체 응답 검증을 삭제하거나 개별 실행 confirm, 자체 `Promise.race`/`AbortController` 조회 수명주기를 복원하는 대표 우회를 거부한다. 실제 서버 인가와 화면 검증을 대체하지 않는다. 계약은 `packages/contracts/leave-approvals.md`이며 스냅샷을 원자적 상태 전환이나 멱등성 보장으로 설명하지 않는다.

## 공통 이미지 편집과 프로젝트 아이콘 검증

- `CompanyImageEditor`를 프로필/아이콘 어댑터가 함께 사용한다. 새 이미지 편집 화면은 엔진을 복제하지 않고 대상·권한·응답 계약을 제공한다. 프로젝트 계약은 `packages/contracts/project-icons.md`이며 조직 정보 저장과는 독립적이다.
- `ProjectIconFormTests`는 실제 Portal 인증/Razor/SQLite에서 생성·교체·삭제·기존 버전 충돌·CSRF·계정/프로젝트 대상·잘못된 파일/중복 입력·DB 오류·native 성공/오류와 비공개 이미지 읽기 권한을 검사한다. 프로필/조직 데이터가 바뀌지 않는지도 확인한다. fixture 준비는 `project-icon.edit.html`, `project-icon.context.json`, `project-icon.saved.json`을 생성한다. 조직 fixture의 context는 부서/프로젝트별로 분리해 병렬 생성의 덮어쓰기를 방지한다.
- `npx playwright test tooling/browser-tests/project-icon.spec.mjs tooling/browser-tests/profile-form.spec.mjs tooling/browser-tests/organization-form.spec.mjs`로 공통 엔진과 실제 두 이미지 폼/조직 초안을 함께 검증한다. Canvas 변환·multipart 필드·저장 후 이미지 로드·320/1440px light/dark·키보드 확인/포커스·읽기 전용 복구·계정/프로젝트 범위 변경·늦은 응답/해제/timeout·조직 전송 잠금을 포함한다. 모든 HTTP와 이미지는 격리 합성 데이터다.
- `checkProjectIcon`/`project-icon-contract.test.mjs` 및 `checkProfileForm`은 엔진 재사용·계정/대상/버전/전체 응답 검증 누락과 기존 raw 업로더 복원을 대표 변이로 검사한다. 정적 검사는 서버 인가나 임의 코드의 안전성을 증명하지 않는다. 공통 자산 변경 뒤에는 여섯 서비스 전체 브라우저 검사와 빌드/서버 검사를 수행한다.

## 부서·프로젝트 폼 검증

- `OrganizationFormTests`는 실제 Portal 인증/Razor/SQLite로 등록·기존 수정·native 리디렉션·CSRF·다른 계정·기존 버전 충돌·잘못된 대상/선택/색상·DB 실패와 HTML 초안 보관을 검사한다. `tooling/prepare-razor-fixtures.mjs`가 실제 HTML/context/저장 응답을 `artifacts/razor/organization.*`로 생성한다.
- `npx playwright test tooling/browser-tests/organization-form.spec.mjs tooling/browser-tests/portal-shell.spec.mjs`로 기존 Portal 화면과 함께 확인한다. Windows 설치 Chrome 사용 시 `WORKSPACE_BROWSER_CHANNEL=chrome`을 설정한다. HTTP는 격리하며 운영 조직을 변경하지 않는다.
- 검사에는 PC/mobile light/dark, 확인 취소·키보드·중복 클릭·전체 전송 잠금·변경된 초안/계정·해제 후 응답·422/409/403/500/손상 응답과 미저장 아이콘 보호가 포함된다. HTML 복구 원문이 코드로 실행되지 않고 모바일에서 줄바꿈되는지도 확인한다. `checkOrganizationForm`의 정적 변이 검사는 실제 동작/인가 테스트를 대체하지 않는다.

## 프로필 설정 검증

- `CompanyProfile`과 native `/settings/profile` 폼은 `packages/contracts/profile.md`를 따른다. `checkProfileForm`과 `profile-contract.test.mjs`는 공통 처리·계정/버전/응답·해제 연결을 삭제하거나 개별 fetch/confirm으로 되돌리는 대표 변이를 거부한다. 정적 문자열 검사는 인가나 동작 증명이 아니므로 아래 실동작 검사도 유지한다.
- `ProfileFormTests`는 실제 Portal 인증/Razor/SQLite로 저장·삭제·버전 충돌·CSRF·잘못된 계정/파일/입력·DB 오류·native POST를 검증한다. fixture 준비 명령에 포함되며 `profile.edit.html`, `profile.context.json`, `profile.saved.json`을 생성한다. 운영 프로필은 사용하지 않는다.
- `profile-form.spec.mjs`는 생성 셸과 실제 Razor를 사용해 320/1440px light/dark, 실제 Canvas PNG 변환, 전체 잠금, 확인 취소/키보드, 늦은 Bitmap/응답·범위/해제/timeout, 저장 후 읽기 실패 및 읽기 전용 복구를 검증한다. 공통 자산 변경이므로 여섯 앱 전체 브라우저 회귀와 일정/시트 빌드도 수행한다.

## 통합 알림 계약 검증

- Leave는 상단 종·숫자 배지·팝오버를 앱 CSS에서 만들지 않고 공통 셸의 알림 UI만 사용합니다. `checkLeaveLegacyNotificationCss`는 퇴역 selector 재도입을 거부하는 동시에 `/Notifications`의 실제 목록·읽지 않음·작업·모바일 스타일을 필수로 확인합니다. 제거 후에는 실제 Razor fixture와 `leave-notifications.spec.mjs`, `leave-shell.spec.mjs`를 함께 실행해 본문 알림과 권한별 셸을 확인합니다.
- `notification-contract.test.mjs`는 long 경계·구형 안전 숫자·잘못된 ID/응답·동일 소스 중복을 검사하고, 여섯 서비스 출처에서 실제 생성된 공통 셸의 정확한 읽음 URL과 인접한 큰 ID 비교를 확인한다. DOM 테스트는 실제 앱별 레이아웃 증거를 대신하지 않는다.
- `PortalNotificationTests`는 실제 Portal/격리 DB와 내부 HTTP 대역을 사용해 공개 JSON 문자열, 실제 Razor 키, long 읽음 전달, CSRF 및 공용 계정의 서비스 인가를 검사한다. 운영 알림을 변경하지 않는다. fixture 준비 명령에 포함되며 `portal.notifications.large.html/.json`을 생성한다.
- 공통 자산 변경 후 `npm run build:ui`, 일정/시트 빌드, Razor fixture 준비와 `npx playwright test shell.spec.mjs portal-notification-ids.spec.mjs`를 실행한다. 새 알림 화면 검사는 실제 서버 fixture와 격리 HTTP를 사용하여 상단 알림/본문 읽음 경로를 확인한다. 다른 서비스의 전 업무 쓰기 성공을 입증하는 검사는 아니다.

## 통합 알림 요청 검증

- `notification-session.test.mjs`는 순수 요청 처리기의 직렬화·계정 전환·취소 무시·timeout·해제·미확정 응답·확인된 쓰기와 후속 조회 실패의 분리를 검증한다. 모든 소비 앱의 생성 셸은 `notification-contract.test.mjs`에서 실행한다.
- `notification-session.spec.mjs`는 실제 Portal Razor와 생성 셸을 브라우저에서 함께 사용한다. HTTP는 격리하며 `expectedUserId`와 기존 CSRF, 정확한 204 확인, 전체 쓰기 잠금, 읽기 전용 복구, 본문 계정 무효화 및 반복 상태를 검사한다.
- 공통 코드 변경 시 `npx playwright test shell.spec.mjs portal-notification-ids.spec.mjs notification-session.spec.mjs`로 여섯 앱 소비자 회귀를 실행한다. Portal 통합 서버 테스트는 잘못된/중복/빈 화면 계정 값을 내부 호출 전에 거부하는지도 확인한다. 요청 취소가 실제 서비스 DB 롤백이라는 뜻은 아니다.

## 공통 테마 검사

- `npm run check:ui`의 구조 검사에 `tooling/check-theme-contract.mjs`가 포함된다. 빠른 단독 확인은 `node tooling/check-theme-contract.mjs`로 실행한다. 서비스 등록에서 소스 경계를 도출하므로 새 UI 파일을 별도 allowlist에 등록할 필요가 없다.
- 없는 `--cw-*` 이름, 페이지별 재정의, 공통 정의의 다크 값 누락/중복은 실패한다. 새 색상이 필요하면 먼저 공통 소유 파일의 두 모드에 정의하고 생성 자산을 갱신한다. 토큰 이름을 문자열로 조립하거나 검사 회피를 위해 파일을 제외하지 않는다.
- `theme-contract.test.mjs`는 정의/참조/덮어쓰기 변이와 여섯 앱의 새 중첩 파일 포함을 검사한다. `generator.test.mjs`는 생성된 페이지 옆에 잘못된 CSS를 추가하면 실제 구조 검사 명령이 실패하고 올바른 토큰으로 수정하면 통과하는지 확인한다.
- 정적 이름 검사는 시각 검증을 대체하지 않는다. `cs-product-commands.spec.mjs`와 `leave-shell.spec.mjs`는 변경된 상품 입력/아이콘/미리보기 및 Discord 설정 안내 배경을 실제 공통 토큰의 계산값과 비교한다. 기존 배경값으로 되돌리면 이 검사가 실패해야 한다.

Node 22+, .NET SDK 10, Docker를 사용합니다. 루트 npm 설치와 앱별 설치는 구분합니다. 기존 앱 lockfile을 즉시 하나로 재해석하지 않고 각 앱의 재현 가능한 빌드를 보존합니다.

```sh
npm ci --ignore-scripts
npm ci --ignore-scripts --prefix apps/sheet
npm ci --ignore-scripts --prefix apps/schedule
npm run build:ui
npm run check
npx playwright install chromium
npm run test:browser
node tooling/verify-import.mjs
npm run source:check
npm run source:remote-check
npm run source:legacy-inspect
```

Windows에서 설치된 Chrome을 사용할 경우 PowerShell에서 `$env:WORKSPACE_BROWSER_CHANNEL='chrome'`을 설정한 뒤 브라우저 테스트를 실행합니다. 사용자 프로필을 재사용하지 않습니다. `source:check`는 `archive/*` ref를 포함한 최초 수입 이력과 정확한 트리를 현재 모노레포 안에서 확인합니다. `source:remote-check`는 checkout을 fetch하지 않고 여섯 과거 GitHub 원격의 실제 main commit을 읽기 전용으로 대조합니다. 과거 checkout을 쓰레기통에서 잠시 복원해 조사할 때만 `source:legacy-inspect`를 사용하며, 정상적인 개발·배포는 해당 checkout에 의존하지 않습니다. 운영 동결 직전에 보존 검사와 원격 검사를 다시 실행하되, 통과를 branch protection이나 배포 승인으로 확대하지 않습니다.

## CI 정책 변경

`npm run check:ci`는 `tooling/verification-policy.json`과 루트 워크플로의 필수 job·명령·서비스 matrix 및 집계 조건을 검사합니다. 루트 `npm run check`에도 포함됩니다. `node --test tooling/tests/verification-gate.test.mjs`는 검사 누락·조건부 생략·실패/취소/건너뜀·잘못된 실행 정보를 의도적으로 넣어 실패 여부를 확인합니다. 워크플로 작성 형식을 바꾸면 제한된 형식 검사기와 테스트도 함께 검토합니다.

CI 집계의 성공 기록은 정확한 commit/tree/run/attempt를 담지만 배포 승인이나 서명이 아닙니다. 로컬에서 CI 환경변수를 만들어 운영 증거를 발급하지 않습니다. 실제 원격 실행, 보호 규칙, 이미지 digest 연결 및 서비스별 배포·롤백은 [배포 문서](DEPLOYMENT.md)의 별도 확인 대상입니다.

### 의존성 보안 검사와 테스트 도구

루트·CS·통계·일정·시트의 다섯 npm 프로젝트는 CI에서 각각 `npm audit --audit-level=low --include=dev --include=optional --registry=https://registry.npmjs.org`를 실행합니다. 개발/선택 의존성을 빼거나 높은 위험도만 통과 기준으로 삼지 않습니다. 조회 장애도 성공으로 처리하지 않습니다. 로컬 공통 `npm run check`는 네트워크 없이 실행할 수 있는 구조/계약 검사이며, 온라인 audit를 수행했다는 뜻이 아닙니다. 오프라인 설치 로그의 `0 vulnerabilities`를 최신 보안 확인으로 보고하지 않습니다.

일정·시트의 Vitest는 보안 수정 버전 4.1.11로 고정했습니다([공식 공지](https://github.com/vitest-dev/vitest/security/advisories/GHSA-82fw-gwwq-j7x9), [v4 이관 안내](https://v4.vitest.dev/guide/migration)). 테스트 내용/개수와 기존 Vite 7·React 19는 유지합니다. 시트의 간접 런타임 의존성 qs는 6.16.0, 빌드 도구 esbuild는 0.28.2로 잠겼습니다. tsup 8.5.1이 esbuild를 0.27 범위로 요구하므로 시트 manifest에 **tsup → esbuild 0.28.2** override를 명시했습니다. 상위 tsup이 수정 버전을 기본 지원하면 override를 제거하고 설치·빌드·런타임 검증을 다시 수행합니다. `npm audit fix --force`로 관련 없는 메이저 버전을 일괄 변경하지 않습니다.

시트의 `npm run build && npm run test:runtime`은 생성된 `dist/server/index.js`와 정적 자산을 실제 실행합니다. 테스트 전용 어댑터만 loopback 임시 포트로 바인딩하고 자식 프로세스의 외부 TCP 연결을 막습니다. 테스트 환경은 허용한 OS 변수와 합성 설정만 전달하고 Google 키/회사 세션/.env/프록시를 상속하지 않습니다. 임시 데이터 디렉터리에서 데모 조회, 실제 쓰기 차단, 요청 크기/잘못된 JSON, 등록 경로/자산, 인증 필수 상태의 비로그인 거부를 확인합니다. 종료가 확인된 테스트 프로세스의 자체 임시 디렉터리만 정리합니다.

이 런타임 검사는 Google Sheets 실제 읽기·쓰기나 로그인 성공/세션 갱신 E2E, 컨테이너 배포 검증을 대체하지 않습니다. CI frontend의 시트 build 다음에 실행하며, 명령 누락이나 잘못된 조건 변경도 정책 검사 대상입니다. 신규 도구 설치/갱신 시에는 lockfile의 실제 버전과 diff를 확인해야 하며 설치 명령의 성공 메시지만으로 갱신을 단정하지 않습니다.

## 공통 UI 변경

텍스트 복사는 생성 자산의 `CompanyClipboard.copyText(value)`를 사용합니다. 앱 코드에서 `navigator.clipboard`, `document.execCommand('copy')`, 임시 textarea를 직접 구현하지 않습니다. 공통 원본은 `packages/workspace-ui/src/clipboard.js`, 계약은 `packages/contracts/clipboard.md`입니다. `node --test tooling/tests/clipboard.test.mjs`와 CS 상품 명령의 `Product JSON copy` 브라우저 검사로 최신 API·fallback·정리·원문 보존을 확인합니다.

개인 TODO는 `apps/schedule/src/usePersonalTodos.ts`, `personalTodoContract.ts`, `personalTodoWrites.ts`를 참고합니다. 삭제·편집 취소·다른 TODO 편집·목록 탭 전환·페이지 이탈은 공통 확인창을 사용하고, 초안·원문/대상·버전·계정/탭을 적용 직전에 다시 대조합니다. 페이지 이탈은 `useWorkspaceNavigationRequest`로 사이드바·링크와 브라우저 history를 함께 처리하고 새 TODO와 수정 초안을 모두 보존합니다. 새로고침·탭 닫기의 `beforeunload`는 유지합니다. 쓰기는 공통 문서 세션/전송과 서버 전체 ACK를 사용하며, 결과 표시는 `WorkspaceState`, 목록은 별도 공통 GET으로 복구합니다.

TODO 전용 브라우저 검사는 일정 빌드 후 `node node_modules/@playwright/test/cli.js test tooling/browser-tests/schedule-shell.spec.mjs --grep "personal TODO"`로 실행합니다. 편집 취소·대상·탭·페이지 이탈은 PC/모바일·두 테마에서 공통 창 취소 후 입력/URL 보존, 승인 후 전환, native dialog·쓰기 없음과 실제 새/수정 초안 표시를 확인합니다. 전체 일정 회귀는 같은 파일에서 grep 없이 실행합니다. 실제 번들·공통 확인창과 격리 API 응답을 사용하며 운영 계정/데이터를 사용하지 않습니다.

완료 checkbox 검사는 같은 브라우저 시나리오에서 `todo-check-control cw-check-control`과 `todo-check cw-checkbox`, 18px 입력·최소 42px 클릭 영역 및 라이트·다크의 미선택/선택 공통 배경을 확인합니다. 구조 검사는 TODO CSS가 크기·색·포커스를 다시 소유하면 실패합니다.

원본은 `packages/workspace-ui/src`와 `packages/contracts`입니다. `apps/portal/wwwroot/js/company-workspace.js`, `company-entities.js`, `css/company-workspace.css`, CS `lib/workspace-pages.js`, 통계 `public/workspace-routes.js`는 생성 결과입니다. 기존 Dockerfile과 외부 소비자의 자산 URL을 보존하기 위해 현재는 결과도 추적합니다. 변경 후 `npm run build:ui`가 모든 앱 HTML/Razor의 버전 참조를 같은 내용 해시로 갱신합니다. `--check`는 생성 결과가 다르면 실패합니다.

### 실행 확인 연결

정적/Razor는 `CompanyDialog.confirm(options)`, React는 generated `confirmWorkspaceAction(options)`를 사용합니다. `title`, `message`, `details`, `confirmLabel`, `confirmationText`(선택), `disabledReason`, `signal`, `validate`를 전달합니다. 취소는 null, 확인은 `{confirmation:string}`을 반환합니다. 값은 textContent로 표시하며 정확한 확인 문구를 임의 trim/변환하지 않습니다. 구성 예는 `apps/sheet/src/client/useSheetActions.ts`입니다.

확인창의 각 detail은 `{label,value,entity?:{kind:'employee'|'project',id:string|null,name:string}}`로 프로필/아이콘을 선택적으로 표시할 수 있습니다. React의 generated `ConfirmationDetail`도 같은 정의입니다. 기존 텍스트 detail은 그대로 동작합니다. `CompanyEntityDisplay`가 기존 허용 URL/이니셜을 표시하며 이름이나 로컬 ID로 회사 계정을 추정하지 않습니다. Leave는 `localEmployeeId()`로 매핑하고 연결이 없으면 null을 전달합니다. 이미지 표시 자체는 인가를 대신하지 않습니다.

호출자는 확인 전 대상/버전/로그인 범위를 캡처하고 검증 콜백 및 await 직후에 다시 확인해야 합니다. 페이지 해제/전환은 AbortController로 취소합니다. 확인창 자체를 서버 인가로 사용하지 않습니다. 실제 쓰기는 확인 후 한 번만 호출하고 확인 응답 검증과 후속 읽기 실패를 구분합니다. 반환값을 받았다고 성공 메시지를 표시하거나 통신 실패를 자동 재전송하지 않습니다.

공통 비교창도 같은 native dialog 수명주기를 사용합니다. 서비스별 확인창 복제와 시트 쓰기 연결 누락은 정적 검사/변이 테스트로 검사하지만 모든 임의 우회를 증명하는 것은 아닙니다. 신규 동작은 실제 브라우저의 포커스·모바일/테마·중복 제출·오래된 값/권한·실패/성공 검사를 함께 추가합니다. 동기식 navigation guard를 단순히 Promise를 반환하는 확인창으로 대체하면 안 됩니다. 남아 있는 이탈 확인은 라우터의 비동기 전환 계약과 함께 별도 이관합니다.

추가/삭제처럼 확인과 함께 도메인 입력이 필요한 양식은 `CompanyDialog.present(dialog, options)`와 `.cw-review > .cw-dialog-form`을 사용합니다. `header`/`.cw-review-body`/`footer` 안에 업무 필드를 두고 모달 배경·테두리·버튼 글꼴을 앱 CSS로 다시 만들지 않습니다. 반환된 `finish(result)`와 `closed`를 사용하며 같은 DOM 노드를 다시 열 수도 있습니다. `canCancel:()=>!pending`은 사용자 Escape만 보류합니다. 계정 변경/abort/외부 close는 항상 닫히므로 늦은 API 응답의 범위 검증은 호출자 책임입니다.

CS 플레이어 데이터는 `runMutation`과 `player-data-contract.js`를 참고합니다. 쓰기 성공 확인과 목록 읽기를 분리하고, 새 토큰/원문을 적용하기 전에 확인 응답을 검증합니다. 잘못된 응답/통신 오류에서는 초안을 유지하고 같은 토큰의 반복 쓰기를 막습니다. 명시적 목록 재확인은 확인된 성공에만 제공하며 읽기만 수행합니다. 일반 새로고침으로 초안을 버리는 동작은 기존 동기식 확인을 유지합니다. `cs-player-data.spec.mjs`는 실제 handler와 메모리 PlayFab을 연결해 쓰기·후속 읽기 실패·범위 변경을 검사합니다.

JSON 편집기의 변경 요약은 `cw-state-pill`을 사용하며 수정은 warning, 추가는 success, 삭제는 danger tone입니다. CS 코드는 diff 판정·개수와 이동 동작만 소유하고 배경·글자색·크기·테마를 `.diff-chip`에서 다시 만들지 않습니다. `cs-player-data.spec.mjs`는 라이브/테스트와 PC/모바일·라이트/다크에서 실제 계산 색, 변경 이동과 초안 보존을 함께 확인합니다.

저장·추가·삭제 확인 checkbox는 같은 spec의 PC/모바일·라이트/다크 시나리오에서 공통 class, 18px 입력, 선택 계산 배경과 긴 UID/키 문구의 높이·문서 폭을 확인합니다. `checkPlayerMutations`는 세 템플릿이나 공통 CSS가 빠지거나 플레이어 전용 배경·테두리·입력 크기 skin이 돌아오면 실패합니다. 실제 PlayFab 쓰기나 전체 서비스 브라우저 회귀와 구분합니다.

로그 장기 범위 확인은 `cs-log-search.spec.mjs`의 320/1440px·라이트/다크 시나리오에서 공통 class와 18px 입력, 선택/미선택 계산 배경, 긴 안내 문구와 실제 `confirmLongRange` 요청을 확인합니다. `checkLogSearch`는 전용 배경·테두리·글자색·입력 크기가 돌아오면 실패합니다. 합성 Azure/Parquet을 사용하므로 운영 로그 검색 완료 증거가 아닙니다.

일정 보관·복원·댓글 삭제는 `apps/schedule/src/useTaskActions.ts`를 참고합니다. 사전 읽기 중에도 중복 요청을 잠그고, 버튼을 비활성화하기 **전** `returnFocus`를 캡처합니다. 상세 창 안에서 여는 확인창도 취소 시 실행 버튼으로 돌아와야 합니다. 열린 댓글/업무 초안을 버리는 작업은 저장/취소 전 차단합니다. 최신 상태가 달라졌을 때 버전만 올려 자동 실행하지 않습니다. 완료 확인 뒤의 목록 갱신 콜백은 오류를 삼키지 않아야 하며, 일정의 `changed(true)`가 해당 경로입니다. HTTP 204 삭제와 JSON 업무 응답은 서로 다른 기존 계약으로 검증합니다.

일정 확인 검사는 빌드 후 `node node_modules/@playwright/test/cli.js test --grep "task action confirmation|task confirmation refuses"`로 실행합니다. 실제 API 쓰기는 격리 응답으로만 수행합니다. 일정 단독 `npm ci && npm test`도 가능하도록 DOM 테스트 의존성을 해당 앱 lockfile에 포함합니다. 단위 테스트만으로 모달 포커스/모바일 크기를 검증했다고 주장하지 않습니다.

## 새 페이지

```sh
npm run page:new -- cs example "새 페이지"
npm run page:new -- statistics example-report "새 통계 보고서"
npm run page:new -- sheet example-report "새 시트 보고서"
npm run page:new -- schedule example-report "새 일정 보고서"
npm run page:new -- home example-report "새 회사 보고서"
npm run page:new -- leave example-report "새 연차 보고서"
npm run check
npm run test:browser
```

현재 검증된 생성기는 CS 정적 페이지, 통계 SPA, 시트·일정 React, Portal·Leave Razor 어댑터입니다. CS는 새 HTML 파일을 만들고 통계는 기존 index.html의 본문에 새 view를 추가합니다. 시트는 `src/client/pages/<slug>.tsx`, 일정은 `src/pages/<slug>.tsx`를 만들고 generated 페이지 목록에 컴포넌트를 연결하며 기존 App의 업무 코드는 수정하지 않습니다. 일정 서버의 `WorkspaceRoutes.g.cs`도 같은 계약에서 생성합니다. 등록된 모든 페이지는 공통 메뉴, 서비스별 서버 경로, 계약 테스트 및 PC/모바일·테마 브라우저 테스트의 대상이 됩니다. 중복·예약 경로와 기존 본문 덮어쓰기는 거부합니다. 서버의 기존 서비스 접근 권한 및 중앙 세션 검증을 유지합니다. 일정처럼 HTML 셸이 공개인 서비스도 업무 API는 별도로 로그인·권한을 검증합니다. 개별 페이지에 더 세밀한 권한이 필요하면 서버 어댑터부터 확장해야 하며 UI roles 조건만 추가해서 보안을 구현하면 안 됩니다.

Portal은 `home`으로 생성합니다. `Pages/Workspace/<slug>.cshtml` 본문과 기본 `EmployeeOnly` 정책을 등록하고, 경로·서버 policy·제목·메뉴를 `Workspace/*.g.cs`에 생성합니다. 관리자 전용이라면 계약의 `policy`를 `AdminOnly` 또는 `MasterOnly`로 지정합니다. 공개 페이지는 명시적 `anonymous:true`가 필요합니다. `@page`에 경로를 쓰거나 페이지에서 Layout·Title·Authorize를 별도로 정의하지 않습니다. `/api/workspace/navigation`은 동일한 서버 정책으로 메뉴를 필터링하며 등록 경로는 역할별 실제 Razor 렌더링 검사에 포함됩니다. 조직 관리처럼 query variant가 같은 Razor 본문을 공유하면 경로와 서버 policy가 같아야 합니다.

Leave는 `leave`로 같은 Razor 생성기를 사용합니다. 기본 정책은 Leave의 `EmployeeOnly`이고, `AdminOnly`/`MasterOnly`는 기존 로컬 정책을 그대로 사용합니다. 회사 admin/master가 모두 Leave Master인 기존 매핑에 유의합니다. 루트/신청/달력 호환 리디렉션과 SSO/Discord 콜백은 일반 업무 페이지 생성 대상이 아닙니다. 일정 관리 권한은 bootstrap에서 전달된 정보로 메뉴에 반영하지만 기존 업무·주요 일정 API의 서버 인가 검증을 대체하지 않습니다.

표에는 `cw-data-table`, 상태 배지에는 `cw-state-pill`과 `data-tone="success|warning|danger"`를 사용합니다. 원본은 `packages/workspace-ui/src/primitives.css`이며 기존 셸의 재로그인 안내용 `cw-status`와 혼용하지 않습니다. 앱은 열 너비·가로 스크롤 등 업무별 레이아웃을 소유하고 공통 스타일은 읽기 크기·테마·상태 색을 소유합니다. 다른 기존 표/폼의 전환은 아직 남아 있습니다.

가로로 긴 표 안에서 상세 폼을 펼칠 때는 스크롤 컨테이너에 `cw-table-scroll`, 상세 폼에 `cw-table-detail`을 적용합니다. 상세 너비는 표의 전체 너비가 아니라 현재 보이는 컨테이너 너비(`cqw`)를 사용하고 가로 스크롤 시 왼쪽 위치를 유지합니다. 회사 직원 표의 실제 프로젝트 검색/편집 영역이 모바일 경계 안에 있는지도 검사합니다. 문서 scrollWidth 검사만으로 스크롤 표 안쪽 입력칸의 잘림을 검증할 수는 없습니다.

## 로딩·오류·빈 결과

새 페이지는 공통 상태 컴포넌트를 사용합니다. 색·아이콘·알림 role·버튼을 페이지에서 복제하지 않습니다. 준비 중인 상태를 실제 0건 조회 성공으로 표시하지 않습니다.

정적 HTML/Razor 예시:

```html
<div data-workspace-state="empty" data-state-title="검색 결과 없음"
     data-state-message="검색 조건을 변경해 주세요."></div>
```

동적 화면은 `CompanyState.render(element, {kind:'error', message, actionLabel:'다시 시도', onAction:retryRead})`를 사용합니다. `kind`는 loading/empty/error/denied/success입니다. 텍스트는 HTML이 아닌 문자열로 처리됩니다. 선언형 액션은 `data-state-action-label`을 지정하고 해당 요소의 `workspace-state-action` 이벤트에서 처리합니다. `preventDefault()`로 기본 콜백을 취소할 수 있습니다.

React 페이지는 `../generated/workspace-state`의 `WorkspaceState`를 import하여 같은 props를 넘깁니다. React는 mount만 소유하며 내부 자식은 직접 변경하지 않습니다. 공통 자산을 사용할 수 없는 경우에도 텍스트 오류 안내가 남습니다. 새 페이지 생성기가 공통 empty 상태와 import를 포함합니다.

읽기 재시도와 업무 저장 재실행을 구분합니다. 상태 컴포넌트에 자동 저장 재시도는 없으며 쓰기 결과 불명확 시에는 서버 상태를 확인해야 합니다. 초기 설정·목록 읽기가 실패한 경우 분석만 다시 실행하는 식으로 일부 초기화 단계를 생략하지 않습니다. 로그인 만료 안내는 초안을 남기며 사용자가 로그인 이동을 선택하기 전에 페이지를 바꾸지 않습니다.

## 직원·프로젝트 사진과 검색 선택

정적 HTML/Razor의 새 사진 표시는 `data-workspace-entity="employee|project"`, `data-workspace-entity-id="회사 ID"`, `data-workspace-entity-name="표시 이름"`을 가진 span을 사용합니다. 기존 `data-company-avatar`, `data-company-project`, `data-company-local-employee` 마커는 호환됩니다. 사진 표시 자체는 업무 목록에 직원을 추가하거나 공개 범위를 결정하지 않습니다.

React는 generated `WorkspaceEntity`에 kind/id/name을 전달합니다. 앱이 프로필 URL·갱신 이벤트·이미지 오류 상태를 별도 구현하지 않습니다. 일정의 Avatar/ProjectIcon은 기존 호출부를 유지하기 위한 얇은 연결입니다.

단일 select에는 `data-company-picker="employee"` 또는 `"project"`를 명시합니다. Leave 직원 선택은 `data-company-local="true"`도 필요합니다. 사진 ID를 따로 지정해야 하면 option에 `data-company-id`를 사용하되 option.value는 기존 폼/React 상태의 업무 ID를 유지합니다. grantId 등 다른 도메인 ID를 직원 ID로 해석하지 않습니다. multiple select를 단일 선택기로 대체하지 않습니다.

구조 검사는 알려진 Leave 직원 필드에서 명시적 연결 누락과 React의 개별 profileUrl/projectUrl 구현을 거부합니다. 이것은 정적 패턴 검사이므로 새 필드의 의미와 서버 필터링은 별도로 검토합니다. 테스트에서 동명이인, 로컬/회사 ID 차이, 초성 검색, 오래된 옵션 변경, disabled/fieldset, 프로필 갱신/이미지 실패, 키보드와 form reset을 확인합니다.

선택창 키보드 검증에는 IME 조합 Enter·방향키와 keyCode 229도 포함합니다. 실제 Chrome 검사는 composition/keyboard 이벤트를 주입하며 Windows IME 후보창 자체를 수동 검증했다는 뜻은 아닙니다. 일정 `ReleaseIdentity.test.tsx`와 브라우저 `release identities|shared entity profiles`는 정확한 ID 연결, 허용 목록 밖 변경자의 사진 미노출, 시스템 이전 기록 구분, 비공개 표시와 사진 갱신을 검사합니다. 320px/1440px light/dark에서 상세창뿐 아니라 긴 프로젝트명이 있는 배경 목록의 문서 너비도 확인합니다. 큰 버전 표는 자체 스크롤을 유지합니다.

버전 기록 편집은 `useReleaseEditor`/`releaseReview`가 공통 비교·상태·양쪽 라우터 이탈 보호를 연결합니다. 고정 ID/프로젝트/버전 번호를 임의 교체하지 않으며 서버 저장 응답의 정규화 내용·새 버전을 확인한 후에만 기준을 바꿉니다. `releaseReview.test.ts`·`useReleaseEditor.test.ts`·서버 `ReleaseTests` 및 Chrome `release editor`가 충돌 조합·초안·권한·중복 쓰기·늦은 응답·저장 후 목록 실패와 신규 등록을 검증합니다. 목록 실패를 호출자에게 전달하는 `load(false,true)`와 읽기 전용 `refreshList` 연결을 유지해야 합니다. 신규 POST의 불확실한 결과를 단순 조회로 미반영 확정하거나 자동 재등록하지 않습니다.

다중 선택은 `fieldset data-workspace-choices="employee|project"` 안에 `input type="search" data-choice-search`와 `label data-choice-label`을 둡니다. 실제 checkbox의 name/value/checked/disabled는 기존 폼 그대로 유지하고 검색 문자열에는 `span data-choice-text`를 사용합니다. 사진은 공통 entity marker를 사용합니다. 검색은 행의 필터 클래스만 변경하며 선택값이나 서버가 hidden 처리한 행을 되살리지 않습니다. 선택·표시 건수/빈 결과는 공통 코드가 추가합니다. 서버 재조회로 선택지가 동적으로 추가될 때는 `CompanyEntityChoices.upsertCheckbox(group, options)`를 사용하며 앱에서 checkbox DOM을 직접 생성하지 않습니다. 외부 코드가 checkbox 속성만 직접 변경한다면 input/change 이벤트 또는 `CompanyEntityChoices.refresh()`로 갱신합니다.

Leave 달력의 `SelfOnly`/`ShowOthers` 선호는 [leave-calendar-preferences.md](../packages/contracts/leave-calendar-preferences.md)를 따릅니다. 역할별 `cw-check-control`/`cw-checkbox`와 같은 이름의 hidden `false`, `SaveCalendarPreference=true`는 Razor가 함께 렌더링합니다. 공통 primitive가 시각 상태를 소유하며 레이아웃에서 페이지 전용 input을 동적으로 만들거나 선호 DB를 다시 조회하지 않습니다.

textarea 기반 직원/프로젝트 후보는 generated `WorkspaceSuggestions`에 kind/items/query/label/anchor/onChoose/onDismiss를 전달합니다. items에는 서버가 현재 조회자에게 허용한 후보만 넣고 value는 안정적인 업무 키로 지정합니다. 소비자는 선택 결과의 업무 저장 형식과 커서 위치를 처리합니다. 입력 제어와 파일 업로드는 이 컴포넌트의 책임이 아닙니다. 구형 개별 `mention-picker`, `data-search-choices` 패턴은 구조 검사에서 거부합니다.

## 계정 필드 추가·변경

1. `packages/contracts/account-fields.json`에 필드 이름·타입·기본값·섹션/표 위치를 정의합니다. `npm run build:ui`가 `apps/portal/Workspace/AccountFields.g.cs`를 생성합니다. 생성 파일은 직접 수정하지 않습니다.
2. Portal의 `Pages/Shared/_AccountField.cshtml`에 한 번만 렌더러를 구현합니다. 등록과 수정 화면은 같은 목록을 순회합니다. `UsersModel.InputFor`, `Prepare`, `Apply`에 기존 값 읽기·정규화·저장을 연결하고 필요할 때만 DB 스키마를 변경합니다.
3. 구조 검사는 중복 입력 HTML, 미구현 렌더러/조회 투영/서버 정규화를 거부합니다. 등록과 수정에만 따로 입력 필드를 추가하거나 검사 예외를 만들지 않습니다.
4. `AccountFormTests`에 값 저장 왕복과 권한/잘못된 값 검사를 추가합니다. 이 테스트는 실제 antiforgery 토큰과 ASP.NET form binding, 격리 DB를 사용합니다. 브라우저의 계정 필드 테스트도 같은 계약을 읽어 등록·기존 수정 양쪽 표시와 입력/취소를 확인합니다.

## 공통 폼 저장 연결

정적/Razor 폼은 `CompanyForm.attach(form, {state, canSubmit, prepare, onSaved, onSettled})`로 연결합니다. `state`는 공통 결과 표시용 빈 요소이며, `prepare(FormData)`는 필요한 경우 변경 행만 선택합니다. `onSaved(data, submittedFormData, context)`는 서버 확인 데이터 전체를 먼저 검증한 뒤 업무별 저장값/버전/reset 기준을 갱신합니다. 부분 응답으로 먼저 한 행을 적용하지 않습니다. `onSettled(saved, outcome)`은 잠금 해제 뒤 한 번 호출되며 outcome은 saved/invalid/conflict/denied/unknown/scope-changed입니다. 기본 timeout은 30초이고 timeout은 서버 작업 취소 또는 롤백의 증명이 아닙니다.

`onSaved`는 검증과 반영을 동기적으로 수행하는 것을 기본으로 합니다. 자체 비동기 처리가 필요하면 `context.signal`을 전달하고 각 await 뒤 값을 바꾸기 전에 `context.isCurrent()`를 확인합니다. 계정 범위 변경·timeout·연결 해제 뒤에는 이전 요청이 JSON을 읽거나 취소를 무시하고 성공 응답을 보내도 적용하지 않습니다. 페이지/폼을 해제할 때 반환된 컨트롤러의 `dispose()`를 호출합니다. 이 함수는 원래 입력 잠금을 복원하고 리스너를 제거하며, 해제 뒤에는 onSaved/onSettled/결과 표시로 이전 화면을 갱신하지 않습니다. 범위 변경 후 새 저장을 허용할 조건은 소비자의 최신 조회·버전·인가 정책으로 정하며 공통 전송기를 권한 검증으로 사용하지 않습니다.

서버는 Accept `application/vnd.company.workspace-form+json` 요청에 같은 Content-Type과 `{protocol:'workspace-form-v1', outcome, message, data}`를 응답합니다. `saved`는 실제 커밋 후 2xx에만 사용하고, 검증 실패는 422 `invalid`, 버전 충돌은 409 `conflict`로 구분합니다. 401/403은 서버 인증·인가가 처리하며 antiforgery를 제외하지 않습니다. 알려지지 않은 5xx나 커밋 중 오류는 확정된 미저장으로 알리지 않습니다. 자동 로그인 이동·자동 쓰기 재시도·원래 버전 교체로 충돌을 우회하지 않습니다.

네이티브 입력과 이탈 방지의 소유권은 소비자에게 있습니다. 초안을 브라우저 저장소에 영구 보관하지 않습니다. Portal 일괄 계정 편집이 첫 소비자이며 다른 기존 폼의 이관은 후속 작업입니다.

### HTML 제출 실패와 초안 복원

Portal 일반 POST도 동일 AccountFields/FormValues로 만든 `Baseline`(ID·ticks 문자열·필드값)을 함께 제출합니다. 이 값은 비신뢰 표시 데이터이며 실제 쓰기의 권한/현재 버전 검사는 서버 원본으로 수행합니다. `RecoverHtmlDraftsAsync`는 실패 뒤 현재 목록을 읽되 기존 버전을 새 버전으로 교체하지 않습니다. `EditInputFor`/`EditVersionFor`가 복원 가능한 행만 같은 `_AccountField`에 연결하며 API 확인 응답의 `InputFor`는 저장된 원본만 투영합니다.

복원 시 `row._original`뿐 아니라 input.defaultValue·checkbox.defaultChecked·option.defaultSelected도 원래 기준에 연결합니다. 현재 초안을 바꾸지 않은 채 native reset 기준만 변경해야 합니다. 확인된 저장 또는 비교 적용 후에는 hidden Baseline의 value/defaultValue도 갱신합니다. 보관된 기존 선택을 초안에서 해제해도 되돌릴 수 있도록 해당 옵션을 남깁니다.

형식 오류·누락/손상된 기준·사라진 선택지·수정 불가 계정은 raw 원문을 복사용으로 보관하고 자동 재기준화하지 않습니다. 반환 HTML은 Razor 인코딩을 사용하며 임의 POST 키·토큰·서버 예외 내용을 출력하지 않습니다. 미확정 저장은 반복 쓰기를 잠급니다. 프레임워크/네트워크가 handler 이전에 거부한 요청과 제출하지 않은 다른 폼은 이 복원 범위가 아닙니다. JS 없는 제출은 같은 필드의 전체 POST를 사용하며 독립 편집기를 만들지 않습니다.

`node tooling/prepare-razor-fixtures.mjs`는 페이지 검사와 AccountFormTests를 실행하여 성공 화면뿐 아니라 실제 실패 응답도 artifacts/razor에 생성합니다. `portal-shell.spec.mjs --grep "HTML account recovery"`는 복원·기준값·충돌 비교·별도 신규 초안·되돌리기·실행 가능한 HTML 미삽입·미확정 반복 차단과 JS 없는 native FormData 제출을 검증합니다. 브라우저 쓰기는 격리 응답이며 운영 계정을 변경하지 않습니다.

## 변경 비교와 충돌 해결 연결

`CompanyForm.attach`의 선택적 `onConflict`는 409 충돌 안내에 비교 버튼을 추가합니다. 콜백은 사용자가 버튼을 눌렀을 때만 실행되며 자동 읽기/쓰기 재시도가 아닙니다. 최신 값 읽기와 접근 권한 검사는 소비자 서버가 수행합니다.

```js
const selected = await CompanyReview.open({
  title: '변경 내용 비교',
  items: [{id: '123', label: '표시 이름', entityKind: 'employee', fields: [
    {key: 'Name', label: '이름', before: ['원본'], draft: ['내 변경'], current: ['서버 변경']}
  ]}],
  returnFocus: resultElement,
  validate: items => validateBusinessCombination(items) // 오류 문자열 또는 null/undefined
});
if (selected === null) return; // 취소는 기존 초안/버전을 유지
// 이후 초안 갱신만 수행. 서버 저장은 별도의 명시적 동작으로 연결.
```

각 필드의 before/draft/current는 문자열 배열입니다. 숫자 ID나 ticks를 JS number로 바꾸지 않습니다. 순서 없는 다중 선택은 `set:true`, 표시 변환은 `format(values)`, 프로젝트 아이콘은 `entityKind:'project'`로 지정합니다. 컴포넌트는 모든 문자열을 텍스트로 출력하며 HTML을 받지 않습니다. 동시에 한 창만 열리고 취소/계정 범위 변경은 null을 반환합니다. validate는 동기 업무 조합 검사이며, 저장 시 서버 검증을 대체하지 않습니다.

Portal `GET /Admin/Users?handler=Review&ids=...`는 `workspace-form-v1`의 `snapshot` 결과를 반환합니다. 서버 필터링된 `choices.DepartmentId/ProjectIds`의 value와 계정 id/updatedAtTicks는 문자열이고 fields는 동일 계정 계약을 따릅니다. 응답 전체·계정 집합·필드 값·현황·선택 목록을 검증한 뒤에만 DOM 선택지와 reset 기준을 바꿉니다. 읽는 동안 사용자가 초안을 고치거나 로그인 범위가 바뀌면 다시 비교해야 합니다. 적용 직후 POST를 호출하지 않으며, 후속 저장에도 비교한 버전 검사를 유지합니다. 취소, 권한 거부, 잘못된 응답, 새 프로젝트 추가 및 재충돌을 회귀 검사에 포함합니다.

React 소비자는 생성된 `workspace-review`에서 `openWorkspaceReview`와 타입을 가져옵니다. 새 창을 따로 만들지 않습니다. 읽기 시작 시 초안과 원본 버전을 캡처하고 최신 데이터/권한을 확인한 뒤 `items`로 전달합니다. 컴포넌트 해제와 계정 범위 변경 시 AbortController를 중단하도록 연결하고 `signal`을 넘깁니다. 적용 직전에도 초안과 권한을 재검사합니다. 일정 업무의 `taskReview.ts`/`TaskPanel`, 댓글의 `commentReview.ts`/`CommentComposer`가 연결 예시이며 다른 저장 폼 전체의 전환 완료를 뜻하지 않습니다.

업무 비교 브라우저 검사는 `node node_modules/@playwright/test/cli.js test --grep "task conflict review"`로 실행합니다(먼저 `npm run pretest:browser`). 실패 조회, 편집 권한 회수, 조회 중 입력, 계정 범위 변경, Escape/페이지 이동, 첨부 선택, 새 디렉터리 ID 및 검토 이후 재충돌을 확인합니다. 테스트의 저장 요청은 격리 응답만 사용하며 운영 업무를 쓰지 않습니다.

댓글 검사는 `--grep "comments and replies|comment conflict review"`로 실행합니다. 신규 댓글/답글/기존 댓글 모두 같은 composer를 사용합니다. 저장 확인과 목록 갱신 콜백을 분리하고, 목록 조회 실패를 이유로 성공한 POST/PUT를 반복하지 않습니다. 작성자 권한·삭제·보관 여부는 업무 편집 권한과 별도로 확인합니다. 서버 GET은 초안이나 버전을 수정하지 않으며, 최종 PUT은 검토한 버전이 다시 오래되었을 때 409를 반환해야 합니다. 멘션 원문 보존을 검사할 때는 멘션 밖의 텍스트를 실제로 수정해야 합니다. 전체 textarea를 교체하면 기존 멘션을 지운 사용자 입력으로 처리되는 것이 정상입니다.

## 상세 펼치기 연결

```html
<div id="account-details">
  <button type="button" data-cw-disclosure="account-123"
    data-cw-open-label="닫기" data-cw-closed-label="정보">정보</button>
  <div data-cw-disclosure-panel="account-123" hidden>상세 폼</div>
</div>
```

```js
const details = CompanyDisclosure.attach(document.getElementById('account-details'));
details.setOpen('account-123', false, {returnFocus: searchInput});
// 동적으로 버튼/패널을 교체한 뒤 details.refresh(), 페이지 해제 시 details.destroy().
```

같은 키의 버튼을 여러 개 둘 수 있지만 패널은 하나여야 합니다. 키는 사용자 이름 대신 안정적인 ID에서 만들고 숫자로 변환하지 않습니다. 직접 `hidden`/ARIA/문구를 따로 변경하지 않습니다. 문구 속성을 생략하면 버튼 안의 프로필·아이콘·공개 범위 표시는 그대로 유지됩니다. 컨트롤러는 입력값/초안/버전을 변경하거나 저장하지 않으며 숨긴 필드도 원래 form 제출에 포함됩니다.

React에서는 `generated/workspace-disclosure`의 `useWorkspaceDisclosure(rootRef,{onChange})`를 사용합니다. 패널을 조건부로 제거하지 말고 초기 `hidden`을 지정한 채 유지합니다. `hidden={open}`이나 별도 `aria-expanded`로 상태 소유권을 중복시키지 않습니다. 반환한 `ready`가 false이면 버튼을 비활성화하며, `setOpen(key,open)`으로 명시적 전환을 요청할 수 있습니다. 루트 DOM 교체와 해제는 hook이 처리합니다. `apps/schedule/src/Releases.tsx`의 마이너/미기재/이력 본문이 예제입니다. `workspaceDisclosure.test.jsx`는 모노레포의 실제 공통 DOM 원본과 generated hook을 함께 실행하는 Vitest 검사이며, 모노레포 루트에서 `npm --prefix apps/schedule test`로 실행합니다.

한 개만 열려야 하는 정적 패널 그룹은 `attach(root,{single:true})`를 사용합니다. `beforeChange(detail)`를 제공하면 정확히 `true`를 반환할 때만 전환합니다. 비동기 확인이 필요하면 이벤트를 먼저 취소하고 소비 페이지에서 대상/초안/권한을 다시 검증한 후 새 전환을 요청해야 합니다. Promise를 바로 guard로 반환하지 않습니다. `workspace-disclosure-before-change`는 cancelable이며 `workspace-disclosure-change`는 적용 후 통지입니다. 계정 권한 변경이나 저장 실패 처리는 이 컴포넌트가 대신하지 않습니다.

Portal 실제 Razor 회귀는 `--grep "shared account disclosure"`로 실행합니다. 먼저 `npm run pretest:browser`로 HTML/번들을 갱신합니다. 키보드·다중 버튼·검색 후 재열기·초안/FormData/버전 보존·모바일 폼 너비를 검사합니다.

CS의 이동형 편집기는 `apps/cs/public/player-data.js`를 참고합니다. 편집기 DOM을 키마다 복제하지 않고 공통 패널 슬롯 사이에서 재사용합니다. 검색은 기존 행을 숨기고 공통 API로 닫으며 초안과 편집기 위치를 보존합니다. 저장소 ID와 원래 키를 함께 사용하여 저장소가 다른 같은 이름의 키를 혼동하지 않습니다. 조회/저장 중 사용자 입력은 fieldset으로 잠그고, 응답 처리 후 패널 복원은 내부 경로로 구분합니다. 실행 확인과 결과 안내는 위의 공통 모달/상태 계약을 사용합니다.

`node node_modules/@playwright/test/cli.js test tooling/browser-tests/cs-player-data.spec.mjs`는 실제 CS 편집 모듈과 실제 player-data API handler를 실행하고 PlayFab 전송만 메모리 클라이언트로 대체합니다. 라이브/테스트 구성, 세 저장소, 큰 정수/이스케이프 보존, GZip 저장, 추가/삭제, 충돌 초안, 중복 제출 잠금과 PC/모바일·두 테마를 확인합니다. 테스트에서 실제 Title이나 인증 키를 설정하지 않습니다.

## 서비스별 실행 명령

### Schedule 댓글 저장 검증

새 댓글·답글·수정은 `schedule-comment-writes.md`와 `useCommentWrites`를 함께 유지한다. 업무 상세의 `commentEditing` actor/기준 토큰, 전송 전 계정·상세 재조회, 공통 확인창, markSent와 전체 댓글/첨부 ACK 중 하나라도 생략하지 않는다. 새 댓글 기준은 댓글 목록 추가 뒤, 루트 댓글 기준은 답글 추가 뒤 바뀌어야 하며 연속 등록을 막는 고정 resource 키로 되돌리지 않는다.

`npm --prefix apps/schedule test -- --run`, `dotnet test apps/schedule/tests/Schedule.Tests.csproj --no-restore`, `node --test tooling/tests/schedule-task-writes.test.mjs`를 실행한다. 실제 번들은 `npx playwright test tooling/browser-tests/schedule-shell.spec.mjs --grep "new comments and replies|comment conflict review|shared mention suggestions"`로 확인한다. 확인 취소 전 요청 0건, 사전 충돌의 write 0건, 연속 댓글/답글, scope 중단 뒤 미전송 복구, sent 중복 차단, malformed ACK 잠금과 저장 성공 뒤 GET 실패의 재전송 0건을 유지한다. 합성 응답은 운영 댓글 저장 증거가 아니다.

### Schedule 주요 일정 저장 검증

주요 일정 생성·수정·삭제는 `schedule-milestone-writes.md`, `useMilestoneWrites`, `MilestoneWriteProtocol`을 함께 유지한다. 편집 GET의 actor·전체 생성/행별 기준 토큰, 전송 전 계정·기준 재조회, 공통 확인창, markSent와 전체 Milestone ACK 중 하나라도 생략하지 않는다. 생성 기준은 접근 가능한 목록 변경 뒤, 행 기준은 해당 행 변경 뒤 바뀌어야 한다. 일반 직원 배열 조회와 레거시 단일 Milestone/204 응답을 유지한다.

`npm --prefix apps/schedule test -- --run`, `dotnet test apps/schedule/tests/Schedule.Tests.csproj --no-restore`, `node --test tooling/tests/schedule-task-writes.test.mjs`를 실행한다. 실제 번들은 `npx playwright test tooling/browser-tests/schedule-shell.spec.mjs --grep "management common controls|milestone write"`로 확인한다. 생성·수정·삭제 확인 취소 전 요청 0건, 사전 충돌의 write 0건, 정확한 actor/state 헤더와 삭제 `{version}`, malformed ACK 잠금, 저장 성공 뒤 GET 실패의 재전송 0건과 포커스 복귀를 유지한다. 합성 응답은 운영 주요 일정 저장 증거가 아니다.

### Schedule 업무 보관·복원·댓글 삭제 검증

업무 상세 작업은 `schedule-task-actions.md`, `useTaskActions`, `TaskWriteProtocol`과 `CommentWriteProtocol`을 함께 유지한다. 최신 회사 계정·상세 재조회, 업무 또는 대상 댓글의 opaque 기준, 공통 확인, 정확한 `{version}`, markSent와 전체 Task/첨부 또는 삭제 Comment ACK 중 하나라도 생략하지 않는다. 레거시 Task와 삭제 204 응답은 유지한다.

`npm --prefix apps/schedule test -- --run`, `dotnet test apps/schedule/tests/Schedule.Tests.csproj --no-restore`, `node --test tooling/tests/schedule-task-writes.test.mjs`를 실행한다. 실제 번들은 `npx playwright test tooling/browser-tests/schedule-shell.spec.mjs --grep "task action confirmation|task confirmation refuses"`로 확인한다. 확인 취소·사전 변경의 write 0건, actor/state 헤더와 정확한 본문, scope 미전송 복구, malformed ACK의 같은 문서 잠금, 저장 성공 뒤 GET 실패의 재전송 0건을 유지한다. 합성 응답은 운영 저장 증거가 아니다.

계정 신규 등록을 수정할 때는 `account-fields.json`의 동일 필드가 초기값·신규/기존 렌더링·서버 정규화·응답에 모두 포함되는지 확인합니다. 앱별 저장 코드를 직접 fetch/자동 새로고침으로 대체하지 않습니다. 새 필드가 다중 값이거나 서버 의존 권한을 추가한다면 `account-create.js`의 응답 확인 규칙과 단위·서버·실제 Razor 브라우저 검증을 함께 갱신합니다. 단순 문자열 구조 검사는 강제 보안 장벽이 아니라 누락 탐지 보조 장치입니다.

- 루트 `npm run check`: 신규 등록 전송/응답/초안 보호 및 누락 변이 검사 포함.
- `dotnet test apps/schedule/integration-tests/CompanyIntegration.Tests.csproj -c Release`: 신규 등록 실제 트랜잭션·정규화·중복/권한/CSRF 거부와 저장 실패 롤백 검증 포함.
- `node tooling/prepare-razor-fixtures.mjs` 후 `npx playwright test tooling/browser-tests/portal-shell.spec.mjs`: 실제 Razor의 신규 등록 및 기존 직원 일괄 편집 초안 보존 검증. 로컬 Chrome 사용 시 `WORKSPACE_BROWSER_CHANNEL=chrome`을 설정합니다. 브라우저 쓰기는 격리 응답이고 실제 DB 쓰기는 서버 테스트에서 별도로 확인합니다.

| 앱 | 작업 디렉터리 및 명령 |
| --- | --- |
| portal | apps/portal: `dotnet build -c Release` |
| leave | apps/leave: `dotnet build -c Release` |
| schedule | apps/schedule: `npm ci`, `npm test`, `npm run build`, `dotnet test tests/Schedule.Tests.csproj -c Release` |
| cs | apps/cs: `npm ci --ignore-scripts`, `npm run check`, `npm test` |
| statistics | apps/statistics: `npm ci --ignore-scripts`, `npm run check`, `npm test` |
| sheet | apps/sheet: `npm ci`, `npm test`, `npm run typecheck`, `npm run build` |

서비스 간 계약은 루트에서 `dotnet test apps/schedule/integration-tests/CompanyIntegration.Tests.csproj -c Release`로 실행합니다. 각 앱의 Docker build context는 `apps/<app>`입니다. 앱 안의 옛 .github/workflows는 이전 이력 자료이며 모노레포 CI는 루트 `.github/workflows/verify.yml`입니다.

## 검증 범위와 한계

- CS 상품 명령 변경은 `tooling/browser-tests/cs-product-commands.spec.mjs`, 앱 `npm test`/`npm run check`, 루트 `npm run check`를 실행합니다. 실제 페이지와 기존 상품 API를 연결하고 두 환경의 PlayFab은 메모리 client로 격리합니다. 설정·미리보기·명령 조회는 `cs-product-command-reads.md`에 따라 공통 read session의 세 채널을 사용하고 실제 execute/delete는 별도 변경 허용 목록과 불확실 응답 잠금을 유지합니다. 실행/Dry Run·부분 실패와 동일 ID 재시도·병합 승인·스냅샷 변경·삭제 후 조회 장애·권한/범위·만료/관찰 timeout·늦은 preview/lookup/execute JSON·모바일/테마를 검사합니다. Dry Run·병합 승인은 공통 checkbox class, 18px 입력, 선택/미선택·disabled 계산 상태와 긴 문구 폭도 확인합니다. UID 원문과 명령 JSON을 복사·표시하는 데 일반 JSON parse/stringify 왕복을 쓰지 않습니다. 게임 내 지급 완료나 실제 PlayFab 인증 성공을 입증하는 테스트가 아닙니다.

- CS Steam 환불 변경은 앱 `npm test`/`npm run check`, 루트 `npm run check`와 `tooling/browser-tests/cs-steam-refunds.spec.mjs`를 실행합니다. 브라우저는 실제 페이지·도메인 handler를 사용하되 모든 HTTP와 Steam client를 격리합니다. Production/Sandbox 표시는 합성 설정이며 실제 결제 환불이 아닙니다. 설정·거래 변경, 64비트 식별자, 확인 취소·포커스·전송 중 잠금·초안 이동, 완료 후 조회 실패·읽기 재시도, 미확정 응답·401/403·timeout·계정 변경·해제·abort를 무시하는 늦은 JSON 응답을 검증합니다. 설정과 거래 query는 `cs-steam-refund-reads.md`에 따라 공통 read session의 두 채널을 사용하고 실제 refund는 별도 변경 허용 목록과 반복 실행 잠금을 유지합니다. 서버 단위 테스트는 실제 추출 handler의 주문 잠금·재검증·감사 실패 경계를, 실제 gateway 테스트는 SSO/CSRF/Origin과 정적 자산 제공을 검증합니다. 공통 확인/상태·응답 검증·테마 토큰·읽기 수명주기 연결을 제거하면 구조 변이 검사가 실패해야 합니다.

- CS 로그 검색 변경은 앱 `npm test`/`npm run check`, 루트 `npm run check` 및 `tooling/browser-tests/cs-log-search.spec.mjs`를 실행합니다. 실제 job handler를 사용하되 Azure 목록/Parquet 전송과 브라우저 네트워크는 격리합니다. PC/모바일·light/dark, 공통 상태/펼치기·큰 정수·장기 확인, 부분 결과, 기존 작업 읽기 복구, 시작 미확정·계정 변경·타임아웃과 늦은 취소를 확인합니다. 설정과 status는 `cs-log-search-reads.md`에 따라 공통 read session의 두 채널과 단일 checked transport를 사용하고, search/cancel 변경 요청은 별도 허용 목록과 불확실 응답 잠금을 유지합니다. 서버 큐·소유자 인가·기간 제한 없는 기존 정책을 UI 검사 편의로 변경하지 않습니다. 새 모듈은 정적 파일 allowlist에 등록하며 상태/펼치기/테마·읽기 수명주기를 개별 구현으로 되돌리면 구조 검사에서 실패해야 합니다.

- 배포 경계 테스트는 `tooling/tests/deployment-preflight.test.mjs`에서 Docker 읽기 호출을 격리해 검사하며 실제 컨테이너를 생성하지 않습니다. 여섯 앱과 Compose 식별자 누락, 볼륨/경로/포트/네트워크 차이, 미고정 이미지, 모호한 mount, 비밀값 출력 및 엔진 변경 거부가 루트 `npm run check`에 포함됩니다. 실제 로컬 점검 명령과 한계는 `docs/DEPLOYMENT.md`를 따릅니다. 이 도구에는 배포·재시작·빌드·이미지 게시 명령이 없습니다.

- DOM 테스트는 공통 코드의 실제 실행과 메뉴/권한/테마 상태를 검증하지만 렌더링 크기를 증명하지 않습니다.
- CS 플레이어 조회/상태 변경 시 `cs-player-data.spec.mjs`의 설정 재확인·반복 오류·초안 보존·401/403 HTML·잘못된 대상·입력 변경·scope/pagehide·취소를 무시하는 JSON·관찰 deadline 검사를 실행합니다. 설정과 전체 저장소 lookup은 `cs-player-data-reads.md`에 따라 공통 read session의 두 채널을 사용하고 save/add/delete는 별도 변경 허용 목록과 미확정 결과 잠금을 유지합니다. 초기 표시뿐 아니라 테마 전환 전후 실제 canvas 픽셀이 바뀌고 복원되는지도 검사합니다. 공용 CS 스타일/테마를 변경하면 CS 다섯 브라우저 spec 전체를 실행합니다. `CompanyState` 액션은 `actionLabel`/`onAction`으로 연결하며 임의의 버튼 옵션으로 대체하지 않습니다. 조회 실패 뒤 기존 토큰 쓰기를 허용하는 기대값으로 회귀 검사를 완화하지 않습니다.
- 브라우저 테스트는 실제 CS/통계 HTML·CSS 및 시트·일정 React 배포 빌드를 320/390/1440px, light/dark에서 실행합니다. `npm run test:browser`는 시트·일정 빌드를 선행하므로 두 앱 의존성도 설치해야 합니다. CS 기본 셸 검사는 도메인 JS를 격리하고, 별도 플레이어 데이터 검사는 실제 편집 JS/API handler와 메모리 PlayFab을 사용합니다. 통계는 실제 app.js와 예제 응답, 시트·일정은 실제 번들과 합성 응답으로 검사합니다. 실제 PlayFab/Azure/직원/Google Sheets 데이터에 접근하지 않습니다. 따라서 운영 환불/저장/로그 조회나 집계·시트 갱신 성공까지 증명하는 것은 아닙니다.
- 일정 .NET 테스트는 실제 배포 HTML의 경로/인증 경계를 확인하므로 `npm run build --prefix apps/schedule` 후 실행합니다. CI integration도 이 순서를 유지합니다.
- Portal 브라우저 fixture는 `tooling/prepare-razor-fixtures.mjs`가 격리 SQLite DB와 ASP.NET TestServer로 실제 Razor HTML을 생성합니다. 일반 직원·공용 계정·관리자·마스터·비로그인을 검사하며 실제 Google 로그인이나 운영 DB는 사용하지 않습니다. `npm run test:browser`가 자동 실행하므로 .NET SDK도 필요합니다. 경로 지정이 필요하면 `WORKSPACE_DOTNET`을 설정합니다. 서버 렌더링 결과는 `artifacts/razor`에만 남으며 Git에 포함하지 않습니다.
- Leave fixture도 실제 Razor 렌더링을 사용합니다. 테스트 Portal이 실제 서명한 SSO 토큰으로 로그인하고 Leave의 named 세션 HTTP 연결만 TestServer에 연결하므로 HMAC·권한·활성/폐기 검증은 그대로 실행합니다. 인증 장애는 503, 비활성/권한 부족은 403, 폐기 세션은 401인 기존 경계를 검증합니다. 승인 대기/취소 대기 합계와 부분 대기열 HTML도 테스트 DB에서 읽습니다. 운영 연차 승인/취소는 수행하지 않습니다.
- 브라우저 스크린샷은 `artifacts/browser`에 남습니다. 색 대비와 시각적 일관성 검토를 병행합니다. 조회 화면 검사만으로 실제 계정 변경·프로필 업로드·연차 신청/승인 성공을 주장하지 않습니다.
- CI 파일 추가만으로 원격 보호가 활성화되지 않습니다. 원격에서 `Workspace Verification / required`를 필수 상태로 설정하고 우회 정책도 확인해야 합니다. 운영 배포 경로 연결 역시 별도 미완료 항목입니다.

### Leave 알림 폼 검증

- 일정 클라이언트 빌드 후 .NET 통합 테스트 또는 `node tooling/prepare-razor-fixtures.mjs`를 실행합니다. `LeaveNotificationTests`가 격리된 실제 Portal/Leave와 SQLite에서 소유권·CSRF·중앙 세션·64비트 ID·저장 실패·과거 미읽음·기존 native URL을 검사합니다. 알림 fixture와 저장 응답은 실제 Razor/handler 출력이며 `artifacts/razor/leave.notifications.fixture.*`에만 생성됩니다.
- `npx playwright test tooling/browser-tests/leave-shell.spec.mjs tooling/browser-tests/leave-notifications.spec.mjs`로 기존 Leave 화면과 새 폼을 함께 검증합니다. 설치된 Chrome은 `WORKSPACE_BROWSER_CHANNEL=chrome`을 설정합니다. 브라우저 HTTP는 모두 격리하며 실제 알림/연차를 변경하지 않습니다.
- Playwright의 fieldset `toBeDisabled`는 native disabled 상태와 다를 수 있으므로 `toHaveJSProperty('disabled', true)` 및 실제 하위 버튼 잠금을 함께 확인합니다. 저장 응답 수신 전후·미확정·계정/target 변경·timeout·해제·무시된 abort 뒤 늦은 JSON·후속 갱신 실패가 포함됩니다. 키보드 Enter 제출과 320/1440px·light/dark 화면도 확인합니다.
- `npm run check`의 알림 계약/구조 변이 검사는 공통 폼·상태·teardown·화면/서버 계정 대조·문자열 ID·테마 토큰 회귀를 검사합니다. 구조 마커 검사만으로 서버 인가나 실제 동작을 증명하지 않으며 통합/브라우저 검사를 대체하지 않습니다.

### Leave Discord 설정 검증

- 같은 Razor 준비 명령이 `LeaveDiscordTests`도 실행합니다. 실제 SSO/Leave handler와 SQLite를 사용하되 Discord HTTP만 격리하여 채널 생성·DM 요청을 기록합니다. OAuth는 서버의 redirect/correlation cookie까지만 검사하며 실제 Discord 인증·수신은 수행하지 않습니다. `.fixture.html/.fixture.json`과 미연동 HTML은 일반 직원·관리자 각각 실제 handler 결과로 생성합니다.
- `npx playwright test tooling/browser-tests/leave-discord.spec.mjs tooling/browser-tests/leave-notifications.spec.mjs tooling/browser-tests/leave-shell.spec.mjs`를 실행합니다. 저장·해제·DM과 초안·계정 변경·확인 중 입력 변경·키보드/포커스·이탈·OAuth native 이동·timeout·취소를 무시한 JSON을 검사합니다. 선택 배경이 실제 공통 토큰과 같고 저장 안내가 고정 상단바에 가리지 않는지도 확인합니다.
- `checkLeaveDiscord`는 공통 폼/확인창/상태의 우회, 서버 대상 확인 및 OAuth/DM 도메인 연결 누락을 검사합니다. 화면 CSS의 의미 토큰 이름을 실제 토큰 정의와 비교하므로 존재하지 않는 색상 이름을 쓰면 실패합니다. 서버 인가/DB 보존/실제 시각 검증은 각 통합/브라우저 검사로 별도 수행합니다.

## 연차 날짜 상세 프레임 검증

`leave-day-detail.md`와 `checkLeaveDayDetail`을 함께 유지한다. 실제 Razor fixture를 갱신한 후 `leave-calendar-admin.spec.mjs`에서 Enter/Tab/Escape, nested confirm, 기존 폼 노드/초안, scope/노드 교체, sticky 닫기와 PC/모바일 두 테마를 검사한다. CSS/세 숨김 소비자가 바뀌면 전체 Leave 브라우저 검사를 실행한다. 실제 날짜 선택과 신청 기간 선택의 차이를 유지하며 테스트의 배경 클릭을 강제로 우회하지 않는다.

## 시트 실행 저장 검증

`npm test --prefix apps/sheet`, `npm run typecheck --prefix apps/sheet`, `npm run build --prefix apps/sheet`와 루트 `npm run check`를 실행한다. `sheetWrites.test.ts`는 전송 명령과 saved 영수증의 전체 결합을, `sheet-write-context.test.ts`는 문자열 actor·enhanced 요청·기준 대조를, `useSheetActions.test.ts`는 확인 중 변경·중복 실행·이탈/계정 변경·성공 후 조회 실패와 늦은 후속 조회 배제를 검사한다. 구조 변이 검사는 조회 `api.ts`에 쓰기 shortcut이 다시 생기거나 서버 공통 envelope/actor·state 검사/클라이언트 transport·`after-write` read session이 빠지면 실패해야 한다. 테스트는 합성 응답만 사용하며 실제 Google 시트를 변경하지 않는다.

## Portal 직원 충돌 비교 조회 검증

`node --test tooling/tests/account-fields.test.mjs`와 루트 `npm run check`는 `account-review` 공통 읽기 채널·30초 제한·취소/해제와 사설 읽기 세션 재도입을 검사한다. `portal-shell.spec.mjs`의 conflict review 및 bulk scope invalidation 시나리오는 PC/모바일·두 테마의 3-way 비교, 64비트 버전·초안 보존과 취소를 무시한 늦은 응답 배제를 확인한다. 합성 Review 응답은 운영 Portal DB나 SSO를 사용하지 않는다.
