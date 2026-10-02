# 구조와 소유권

## 같은 서비스의 등록 페이지 전환

Portal·Leave·CS의 `clientNavigation` 메뉴는 공통 상단바·사이드바 문서를 유지하고, 서버가 승인한 새 HTML의 본문만 교체한다. Portal·Leave는 서버 HTML의 서비스·페이지·회사 계정·역할을, CS는 게이트웨이의 `X-Workspace-Identity` 헤더를 검증한다. 각 페이지는 이탈 확인과 정리·재시작 수명주기를 제공하며 기존 서버 GET/인가와 폼 POST는 유지한다. 메뉴 권한 조회는 동시 요청을 합치고 동일한 스냅샷에서 재렌더링하지 않지만 주기 검증은 계속한다. 계약은 `packages/contracts/page-navigation.md`다.

## 봉인된 Native POST 소유권

Razor/HTML의 literal native POST는 브라우저 변경 경로이므로 `packages/contracts/native-post-boundaries.json` v2가 검토된 31개 폼/16개 소유 파일과 각 폼의 handler/action/id/업무 marker identity를 봉인한다. submitter `formmethod`, JavaScript property 할당과 `setAttribute`로 만든 literal POST도 정규화 표기의 hash identity로 같은 목록에 포함한다. 신규 페이지 POST, 같은 수 안의 identity 변경, 퇴역한 정책 항목과 범용 문서만 가리키는 폼은 구조 검사에서 실패한다. 새 업무 저장은 페이지를 목록에 추가하는 것으로 허용하지 않고 공통 form/write transport와 계정·대상·기준값·전체 영수증·미확정 결과의 구체 계약을 먼저 연결한다. Portal 계정 Add/BulkUpdate는 `portal-account-writes.md`, 외부 SSO `form_post`는 `sso-launch.md`에 각각 연결한다. 정적 identity 검사는 계산 문자열·런타임 반사, 서버 인가·CSRF·트랜잭션을 증명하지 않으며 상세는 `packages/contracts/native-post-boundaries.md`와 각 identity의 소비자 계약을 따른다.

연차 대시보드의 부분 HTML은 페이지 안에서 raw 요청하지 않는다. 전용 `leave-dashboard-read.js`가 동일 출처·허용 경로와 query cardinality·HTML 응답·취소를 확인하고, Razor 페이지의 공통 read session이 달력/신청목록 채널과 현재 직원·폼 revision·영역 교체를 소유한다. 네트워크 경계와 화면 수명주기를 분리하되 둘 중 하나만 통과한 응답을 적용하지 않는다.

## GET 필터의 공통 자동 이동

직원 선택처럼 값 변경 즉시 목록을 다시 여는 필터는 inline handler나 `form.submit()`을 쓰지 않는다. GET 폼의 control이 `data-cw-auto-submit`을 선언하면 공통 navigation 런타임이 취소되지 않은 change만 native `requestSubmit()`으로 전달한다. POST와 disabled·`aria-busy` 폼은 자동 제출하지 않으며 명시적 조회 버튼과 원래 hidden query를 유지한다. 상세는 `packages/contracts/automatic-navigation.md`다.

## 봉인된 브라우저 네트워크 소유권

작성된 브라우저 소스는 페이지별 raw `fetch`를 소유하지 않는다. `packages/contracts/network-boundaries.json`은 공통 transport 또는 소비자 계약으로 검토된 16개 파일의 호출 수만 봉인하며, 신규 파일의 `fetch`·`XMLHttpRequest`·axios·`sendBeacon`, 기존 파일의 호출 증가와 은퇴한 항목을 구조 검사에서 거부한다. dot 호출뿐 아니라 일반적인 computed property·call/apply/bind·literal reflection도 계산한다. 등록은 면제가 아니므로 새 페이지를 목록에 추가하지 않고 기존 공통 소유자를 사용하거나 구체 응답·수명주기 계약을 갖는 단일 transport를 먼저 설계한다. 정적 호출 검사는 계산 문자열·eval, 서버 인가나 요청의 안전성을 증명하지 않으며 소비자별 단위·서버·브라우저 검사를 대체하지 않는다. 상세는 `packages/contracts/network-boundaries.md`다.

## 회사 계정 컨텍스트 적용 경계

공통 셸의 context GET은 `CompanyReadSession`과 `CompanyContextContract`를 모두 통과한 동일 객체만 적용한다. 전역 주기 조회와 프로필/프로젝트 아이콘 저장 후 확인 조회는 context revision을 공유하므로, 먼저 시작한 주기 응답이 확인된 새 사진·아이콘을 복원할 수 없다. 변경 요청의 확정 여부와 서버 인가는 이 읽기 경계에 포함하지 않는다. 상세는 `packages/contracts/workspace-context-reads.md`다.

## 서버 권한 기반 공통 사이드바 조회

Razor 서비스의 공통 사이드바는 서버가 반환한 등록 페이지만 표시한다. `navigation.js`는 생성 번들에서 먼저 로드된 `CompanyReadSession`을 사용해 서비스별 요청을 교체하며, 계정 범위 변경·로그아웃·문서 해제 때 진행 중 요청과 이전 권한 화면을 폐기한다. pages/badges 전체 구조와 최신 ticket을 확인하기 전에는 새 메뉴를 적용하지 않는다. 서버 인가와 본문 권한은 별도이며 상세 계약은 `packages/contracts/navigation-reads.md`다.

## 초안을 유지하는 비동기 창 닫기

공통 owned modal은 기존 동기 `canClose`와 별도로 `beforeCloseRequest`/`requestCloseAsync`를 제공한다. 확인 중 같은 DOM을 유지하고 승인 함수·최종 잠금·노드/층/범위를 대조한다. Schedule 버전 편집이 실제 소비하며 닫기 확인 상태와 저장 상태는 구분한다. 같은 편집기의 메뉴·뒤로/앞으로 이동은 `useWorkspaceNavigationRequest`가 승인 전 URL과 React 본문을 유지한다. API와 검증 경계는 `owned-modals.md`, `draft-transitions.md`를 따른다.

## 초안을 보호하는 비동기 상세 전환

공통 disclosure는 기존 동기 API와 별도로 `requestOpen`/`beforeRequest`를 제공한다. 취소 가능한 확인을 기다리는 동안 이전 패널을 유지하고 승인 후 실제 노드/키/상태와 최종 가드를 대조한다. CS는 같은 공통 확인창과 캡처한 업무 기준값으로 상세 키·서버·조회·원본 복원·키 추가/삭제 진입을 연결한다. API/서버 저장은 그대로이며 Schedule 버전 편집도 닫기와 라우팅에 같은 재검증 원칙을 사용한다. 상세 계약은 `packages/contracts/draft-transitions.md`다.

## 계정·알림 작업 버튼

Portal 개인 설정/알림/서비스 진입과 Leave 알림/Discord/정산/로그인의 native 버튼도 `cw-button`을 소비한다. `.cw-profile-actions`는 사진/프로젝트 아이콘 버튼의 배치만 소유하고 별도 skin을 제거했다. 기존 폼·SSO/OAuth·공통 알림/사진/정산 수명주기와 링크/file/checkbox의 별도 경계는 `packages/contracts/account-action-controls.md`를 따른다.

## Portal 계정·조직 checkbox

신규/기존 계정의 비공개 설정과 펼친 권한 카드는 `cw-check-control`/`cw-checkbox`를 소비한다. 조직 관리의 프로젝트 비공개·보관도 같은 primitive를 사용하며, 직원·프로젝트 복수 선택 목록은 `cw-choice-group`이 항목 테두리·선택 상태·두 테마를 소유한다. 기존 직원 표의 compact 권한은 `cw-switch-control`/`cw-switch`/`cw-switch-track`이 크기·track·선택·focus·성공 tone을 소유한다. Portal에는 카드 내부 문구와 grid/표 폭만 남긴다. 기존 hidden false fallback, 필드 이름, 권한 상속·저장과 충돌 비교는 유지하며 동적 프로젝트 항목 수명주기는 별도 경계다. 상세는 `packages/contracts/portal-controls.md`를 따른다.

## 정적인 업무 안내

`cw-callout`은 JavaScript 없이 업무 문구와 inline code를 유지하며 의미 토큰·제목/본문 대비·줄바꿈을 소유한다. CS 네 화면의 아홉 안내가 소비하고 앱에는 문구와 grid 배치만 남긴다. 정적인 note와 `CompanyState`의 요청 결과/권한 상태를 구분한다. 전체 계약과 literal 검사·native 테마 검증 경계는 `packages/contracts/static-guidance.md`다.

## 반응형 업무 표

공통 `cw-data-table`의 cards/key-value 변형이 PC 표와 모바일 레코드의 동일 DOM·테마·포커스·행 강조를 소유한다. 서버가 실제 header scope와 셀 레이블을 제공하고 값/폼은 단일 wrapper에 유지한다. Leave 신청·대기열·직원·사용 통계·보안 현황이 소비하며 업무 열 너비와 메모 기하는 앱 소유다. 계약과 달력/감사 표의 별도 경계는 `packages/contracts/responsive-tables.md`를 따른다.

## 연차 달력의 직원 프로필

월간/연간 요약·갱신·생일과 동적 날짜 상세는 같은 공통 entity 렌더러를 사용한다. Leave 레이아웃은 로컬→회사 ID를 모두 문자열로 직렬화하고 업무 ID와 사진 ID를 구분한다. 이름과 상태의 구분 문자 결합을 제거하며 갱신/외부 일정의 본인 보기도 기존 허용 직원 필터를 사용한다. 생일은 일반 직원 본인과 관리자에게만 표시하고 출생 연도는 렌더링하지 않는다. 생일연차는 귀속 생일 앞뒤 30일의 단일 근무일을 연차 차감 없이 신청하며 대시보드에 사용 가능 기간·상태를 안내한다. 본인·관리자에게는 실제 유형을, 다른 직원과 공용 채널에는 일반 연차로 표시하고 관리자 정책 예외는 별도 필드와 감사 로그에 남긴다. 모바일 보조 문구 스타일과 내부 사진을 분리한다. 계약·기존 정책/검증 경계는 `packages/contracts/leave-calendar-entities.md`와 `packages/contracts/leave-birthday.md`다.

## 연차 대시보드 입력과 작업 버튼

`Leave/Index`와 `_SelfActionForm`의 일반 native 필드·버튼은 공통 primitive를 소비한다. 동적 날짜 상세의 수정/삭제도 포함하며 입력의 색/포커스/비활성과 기본 기하는 공통 소유다. Leave에는 신청 3열/관리자 2열·전체 메모와 읽기 면적 등 업무 배치만 둔다. 기존 직원 검색·전송·확인/초안 및 별도 달력/링크/표 경계는 `packages/contracts/leave-dashboard-controls.md`에 명시한다.

Leave 달력의 역할별 표시 선호는 native checkbox/hidden GET 의미를 유지하면서 `cw-check-control`/`cw-checkbox`를 소비한다. 공통 계층이 선택·focus·disabled와 두 테마를 소유하고 앱은 달력 도구막대 배치만 소유한다. 자기것만/다른 사람 보기는 서버 GET 선호 저장 후 달력만 교체하고, 관리자 대신보기는 직원별 잔액·내역·권한까지 반영하도록 공통 본문 라우터로 대시보드만 교체한다. 서버 렌더링·저장 계약은 `packages/contracts/leave-calendar-preferences.md`, `leave-dashboard-reads.md`, `page-navigation.md`를 따른다.

Leave Discord 개인 DM 활성화와 수신 유형도 같은 checkbox primitive를 소비한다. 앱에는 옵션 제목·설명과 반응형 grid만 남기고 미연동 native disabled, hidden false fallback, 역할별 수신 카탈로그와 기존 저장·OAuth 경계를 보존한다. 계약은 `packages/contracts/leave-discord-controls.md`다.

## 연차 날짜 상세창

월간 달력의 날짜 상세도 `CompanyDialog.attach`/`.cw-modal`을 사용한다. 원래 Razor 폼은 calendarArea에 보관하며 날짜 버튼·내부 sticky 제목과 본문만 Leave가 소유한다. 취소/외부 일정/관리자 승인 후 숨김은 `LeaveDayDetail.close`로 모으고 scope/달력 교체/pagehide 때 공통 연결을 해제한다. 다른 입력·카드의 남은 전환 및 실제 업무 저장과의 경계는 `packages/contracts/leave-day-detail.md`를 따른다.

## 지속 편집창과 공통 팝업

`CompanyDialog.attach`와 `present`는 하나의 native 창 수명주기/중첩 스택을 공유한다. 전자는 앱/React의 노드·초안을 보관하고 후자는 일회 확인/비교 DOM을 정리한다. Schedule TaskPanel·이미지 확대·DatePicker·날짜 이동·버전 편집·주요 일정 관리는 generated `useWorkspaceModal`을 소비하며 앱별 열기/닫기 루프와 프레임 테마를 제거했다. scope retain/dismiss, 전송/초안 가드, portal 자식 해제와 포커스 정책은 `packages/contracts/owned-modals.md`를 따른다. 사용하지 않는 옛 일정 알림창은 제거했고 실제 통합 알림/서버 API는 유지한다. 다른 앱 미전환 프레임/전송은 별도다.

## 일정 업무 저장 서버 계약

`TaskWriteProtocol`은 기존 JSON 업무 생성·수정·상태 API에 선택적 공통 저장 envelope를 제공한다. 현재 계정·업무/본문 첨부 전체 기준값 및 기존 Version/인가를 대조하고 트랜잭션 안에서 실제 저장 결과를 고정한 뒤 커밋 성공 후 반환한다. TaskPanel은 `useTaskWrites`, 칸반 상태 선택·드래그는 `useTaskQuickStatus`에서 공통 확인/JSON 전송/문서 세션을 소비하며 `taskWrites`가 전체 제출 의도·ACK를 대조한다. 칸반도 상세 preflight와 화면 행 버전을 대조하고 확인된 ACK 뒤에만 행을 이동한다. 성공 후 GET 실패와 미확정 쓰기는 다르고 같은 문서의 편집기 재열기로 잠금을 초기화하지 않는다. 기존 호출 형식·업무 정책과 댓글/업로드 경계는 보존한다. 계약은 `packages/contracts/schedule-task-writes.md`다.

## 일정 이미지 업로드 계약

`ImageWriteProtocol`은 기존 multipart 이미지 API에 선택적 공통 envelope를 제공한다. `useImageUploads`는 본문·댓글 공통 Editor의 선택/붙여넣기/드롭을 한 경로로 묶고, 최신 회사 계정·첨부 목록과 파일 SHA-256을 확인한 뒤 공통 확인·문서 세션·multipart transport를 사용한다. 서버는 파일을 쓰면서 같은 SHA-256을 계산하고 DB 첨부 전체를 저장한 뒤 ACK한다. 첫 바이트 쓰기 뒤 미확정 결과는 자동 재전송하지 않으며 기존 단일 Attachment 응답과 임시 파일 정책은 유지한다. 계약은 `packages/contracts/schedule-image-uploads.md`다.

## 일정 업무 상세 작업 저장 계약

`useTaskActions`는 업무 보관·복원과 댓글 삭제를 현재 계정·상세 재조회, 공통 확인·JSON transport·문서 세션으로 묶는다. `TaskWriteProtocol`과 `CommentWriteProtocol`은 기존 권한·Version 규칙에 opaque 업무/댓글 기준값과 opt-in 전체 ACK를 더하고, 기준 읽기부터 감사·변경·ACK 캡처까지 트랜잭션 안에 둔다. 클라이언트는 정확한 `{version}`과 보관/복원의 전체 Task·본문 첨부 또는 삭제된 전체 Comment·첨부 해제를 검증한 뒤에만 성공으로 처리한다. 미전송 scope 변경만 원래 actor의 명시적 재확인으로 복구하고 sent/unknown은 같은 문서에서 재전송하지 않는다. 계약은 `packages/contracts/schedule-task-actions.md`다.

## 일정 주요 일정 저장 계약

`MilestoneWriteProtocol`은 기존 주요 일정 생성·수정·삭제 API에 선택적 공통 envelope를 제공한다. 일정 접근 권한이 있는 모든 활성 개인 계정은 생성·수정할 수 있고 삭제는 관리자·부서 책임자만 할 수 있다. `Settings`와 `useMilestoneWrites`는 현재 계정·생성 시 접근 가능한 전체 목록 또는 수정/삭제 대상 행의 기준을 다시 읽고 공통 확인·JSON transport·문서 세션을 사용한다. 서버는 기준 읽기부터 실제 저장 결과와 ACK 캡처까지 트랜잭션에 두고 커밋 뒤 반환한다. 신규·수정 행은 작성자·최근 수정자와 시각을 가지며 별도 변경 이력은 actor와 변경 전후 스냅샷을 보존한다. 클라이언트는 제출 JSON과 저장·삭제된 Milestone 전체를 확인한 뒤에만 초안과 목록을 갱신하고, 성공 뒤 GET 실패나 미확정 결과로 쓰기를 반복하지 않는다. 기존 배열 읽기·단일 Milestone/204 응답과 프로젝트 공개 범위·Version 정책은 유지한다. 계약은 `packages/contracts/schedule-milestone-writes.md`다.

Leave 월간·연간 달력은 Schedule의 별도 내부 읽기 API에서 실제 로그인 actor에게 보이는 주요 일정의 최소 발생 정보만 가져온다. 서비스 HMAC과 현재 회사 사용자 ID를 Schedule에서 다시 검증하고, 상세 설명·감사·업무는 공유하지 않는다. Leave는 이를 읽기 전용 칩과 날짜 상세로만 표시하며 연차 계산·쓰기와 분리한다. 조회 실패 시 기존 달력을 유지하는 경계는 `packages/contracts/leave-schedule-milestones.md`를 따른다.

Milestone의 공통 제목·내용·프로젝트는 하나의 행에 유지하고, 기본 타입·날짜와 선택적 추가 타입·기간을 같은 Version으로 관리한다. 기존 행은 추가 일정이 없는 단일 단계로 읽는다. 기간 조회는 어느 단계가 범위와 겹쳐도 게시글을 한 번 반환하며 주간·월간 달력은 단계별 표시를 만든다. 추가 일정과 종료일도 상태 토큰·전체 저장 확인에 포함한다.

## 일정 업무 상세의 공통 읽기

`useTaskDetail`은 실제 TaskPanel의 초기·30초 폴링, 업무·댓글 충돌 비교와 보관/복원/댓글 삭제 전후 조회를 generated `CompanyReadSession`에 연결한다. `scheduleReads`의 상세 계약은 업무 ID·전체 댓글/첨부/이력과 알려진 버전 후퇴를 검증한다. 읽기 실패·계정/해제/늦은 완료와 명시적 같은 소유자 재확인은 hook이 소유하고 업무/댓글 초안은 기존 편집기가 유지한다. 확인창이 열린 동안의 최신 상태 관찰과 보드의 영구 무효화 정책을 구분한다. 상세는 `packages/contracts/schedule-detail-reads.md`, 업무 쓰기는 `schedule-task-writes.md`, 댓글 쓰기는 `schedule-comment-writes.md`, 업로드는 `schedule-image-uploads.md`를 따른다.

## 공휴일 저장 계약과 업무 경계

Leave `Holidays.Protocol.cs`는 현재 관리자·전체 연도 공휴일 기준값 및 공통 저장 응답을 소유한다. 기존 파싱/날짜별 정규화·온라인 보정·저장/감사 정책은 업무 코드에 유지한다. 실제 네 폼은 `holiday-settings.js`의 공통 폼/확인/상태/문서 세션에 연결하며 `holiday-contract.js`는 전체 입력/목록·정확한 ID·반영 건수를 대조한다. 최초/후속 행은 같은 `_HolidayRow`를 사용하고 연도 조회/순차 저장으로 독립 초안과 JSON 원문을 지우지 않는다. 외부 조회 후 서버 대조·미확정 잠금·native 복구와 계정/해제/늦은 응답 차단을 유지한다. 계약은 `packages/contracts/leave-holidays.md`다.

## 채널 알림 설정의 공통 작업

Leave 채널 웹훅의 등록/삭제/테스트는 공통 폼·확인·상태·문서 세션을 사용한다. 서버는 관리자·전체 목록 기준값과 실제 수신처를 소유하고 클라이언트는 전체 확인 응답·동적 행/초안을 관리한다. 불확실한 발송/감사 실패를 롤백으로 처리하지 않으며 큰 ID와 토큰 비노출을 유지한다. 상세는 `packages/contracts/leave-webhooks.md`다. 공휴일 폼·나머지 서비스 및 운영 이관의 완료를 의미하지 않는다.

## 연차 관리자 설정 컨트롤

공휴일·디스코드 채널 설정은 공통 native 입력·버튼·표/내부 스크롤을 소비한다. 공휴일 가져오기의 두 덮어쓰기 옵션도 공통 checkbox를 사용한다. 앱은 가져오기 카드 배치·JSON 원문·조회 연도·기존 handler를 소유한다. 개별 다크 입력 색을 복제하지 않으며 실제 저장/외부 API·발송·감사는 서비스 책임이다. 컨트롤 검사와 실제 공통 저장/확인 수명주기는 `packages/contracts/leave-admin-controls.md` 및 각 도메인 계약에서 구분한다.

## 공통 읽기 관찰과 일정 보드

`CompanyReadSession`은 채널별 요청 교체·관찰 제한·취소 무시/늦은 완료·해제를 소유하며 React 연결은 생성한다. 일정의 `scheduleReads`가 GET 응답/페이지 구조를 검증하고 `useScheduleData`가 현재 계정·검색 조건·주별 캐시·정상값 보존과 공통 상태 UI를 연결한다. 새로운 조건에는 이전 결과를 표시하지 않고 계정 변경에는 보드/캐시를 제거한다. 기존 편집 초안과 같은 계정의 명시적 재확인을 보존하며 새 편집기를 이전 정보로 생성하지 않는다. 서버 인증·DB·업무 쓰기와 다른 서비스 읽기의 전체 전환은 별도다. 계약은 `read-session.md`, `schedule-reads.md`다.

## 팀 일정 탐색·필터

WeekBoard 일반 작업/행 전개/집중 보기/기간 읽기와 모바일 등록 버튼도 같은 primitive를 소비하며 색상 안내는 독립 disclosure 루트다. 행 전개는 visibleLanes와 직원별 반전 집합의 도메인 배치를 유지한다. 업무/주요 일정 카드는 공통 record/content, PC 셀 전체 등록은 quiet/overlay를 사용한다. 프로젝트/유형 식별 색과 단일 날짜 구간·실선 테두리는 앱 소유이며 강조·상태 색과 키보드 윤곽은 공통 소유다.

MonthCalendar는 42개 날짜의 셀 의미를 유지하면서 기간 업무를 주 단위 연속 리본으로 배치한다. 리본의 겹침 레인과 주 경계 연속성, 담당자·프로젝트·업무 상태 조합은 Schedule 도메인이 소유하고 공통 record/content 버튼과 entity 표시를 소비한다. 모바일은 문서가 아닌 달력 내부에서 가로로 탐색한다.

주간 일정/칸반 상단은 공통 native 컨트롤과 entity 선택기를 사용한다. 주말/선택 주와 상세 보기 설정은 공통 checkbox, 행 높이는 공통 range가 입력 크기·선택·focus·disabled와 두 테마를 소유한다. 보기 설정은 generated disclosure가 표시/ARIA를 소유하고 React는 필터·기간·행 높이와 페이지 왕복 선호만 유지한다. 모바일 필터/날짜 배치는 앱 기하이며 개인 TODO 완료와 보드 내부/읽기·쓰기의 남은 경계는 `packages/contracts/schedule-board-controls.md`를 따른다.

## 팀 일정 업무·댓글 컨트롤

일정 관리(`Settings`)도 동일 primitive와 공통 오류/충돌/빈 결과 상태를 사용한다. 주요 일정 카드의 날짜·프로젝트·유형·제목 배치는 앱 소유이며 선택·비활성·필드/버튼 테마는 공통 소유다. 주요 일정 저장은 별도 공통 저장 계약에 연결했고 보관함과 다른 raw 수명주기는 별도로 남는다.

업무 신규/수정/상세 작업과 본문·댓글 공통 Editor는 native primitive를 소비한다. `DatePicker`의 입력/열기 버튼·popup 내부 날짜/연월 선택과 날짜 이동창도 동일하며 프레임은 `owned-modals.md`의 공통 hook에 연결한다. 앱은 날짜/본문 기하·멘션 원문·첨부·업무 이벤트를 소유한다. 이미지 업로드와 댓글 생성·답글·수정은 각각 독립된 공통 저장 계약과 문서 세션에 연결하고 UI 기하·확인/충돌 표시는 `packages/contracts/schedule-task-controls.md`와 구분한다.

## 팀 일정 기록·개인 할 일 컨트롤

버전 기록과 개인 TODO의 일반 필드·버튼·버전 표는 공통 primitive를 소비한다. 앱은 버전/연결 상태·원문·순서·완료·행/카드 배치를 소유하고 공통 계층은 선택/비활성·테마·최소 크기를 소유한다. 기존 목록/편집 hook과 저장·충돌·계정 경계는 유지한다. 실제 전환 및 checkbox/편집 dialog·다른 일정 화면의 남은 범위는 `packages/contracts/schedule-record-controls.md`를 따른다.

## Portal 계정·조직 컨트롤

신규/기존 계정은 동일 필드 정의·Razor partial과 공통 native 입력/버튼/표를 사용한다. 부서·프로젝트의 이름/색상/검색도 같은 primitive를 소비한다. 일반 스타일과 달리 서버 역할/기준값·초안·일괄 저장·충돌 비교는 기존 도메인 계약이 소유한다. 상세 모바일 폭과 표 스크롤을 분리하고 실제 viewport도 확인한다. 남은 checkbox/링크/장식 및 다른 Portal 화면 범위는 `packages/contracts/portal-controls.md`를 따른다.

## CS 입력과 행 작업

CS 네 화면의 일반 입력·버튼·표 상태는 공통 primitive가 소유하고 앱은 업무 열 구조·데이터·검증·전송을 유지한다. 환경·거래·ID 검증·검색 작업·미리보기 상태도 공통 `cw-state-pill`의 neutral/success/warning/danger 의미 색을 사용하며 초기 상태와 응답 이후에 다른 class 체계로 바뀌지 않는다. 동적 행 버튼은 정적 공통 template에서 만들며 사용자 값을 HTML에 보간하지 않는다. 로그 모드 선택은 ARIA 상태를 사용한다. diff canvas의 투명 textarea/고정폭 기하, 동기 초안 폐기 확인과 clipboard fallback은 별도 경계다. 상세 범위는 `packages/contracts/cs-controls.md`를 따른다.

## 시트 조회와 계정 범위

`sheetReads.ts`는 설정/분석/한국어 비교/스냅샷 메타데이터를 렌더링 전에 검증하고 `useSheetData`는 생성된 `WorkspaceReadSession`의 `main`·`preview` 채널로 초기 묶음의 원자적 표시, 30초 관찰 제한·교체·취소·늦은 응답/해제를 소유한다. 일반 실패에는 마지막 정상값을 유지하고 계정/권한 변경에는 본문을 제거한다. 공통 `WorkspaceState`로 오류/권한을 표시하고 문서를 명시적으로 다시 연다. 기존 실행의 전체 응답 검증·후속 조회도 본문 경계에 연결하지만 `useSheetActions`의 쓰기 후 묶음 읽기는 아직 같은 세션을 공유하지 않는다. 서버 actor/revision 대조나 Google 작업 롤백을 추가한 것은 아니다. 상세한 응답 필드·150개 규칙 제한·남은 경계는 `packages/contracts/sheet-reads.md`에 명시한다.

## 시트 컨트롤과 기록 정보

시트의 작업 버튼·검색/상태 필터·표/상태 pill과 상단 Google/데모 연결 상태는 공통 primitive를 소비하고 앱은 분석 규칙·필터 값·열 구조와 연결 문구를 소유한다. 연결 상태의 success/warning 색과 점·크기는 공통 소유이며 실제 쓰기 허용 판단은 서버 설정을 계속 따른다. 스냅샷 기록 정보는 기존 목록의 메타데이터만 공통 React disclosure로 펼친다. 단일 열림·ARIA·키보드는 공통 소유이며 상세 셀 조회/복원 API를 추가한 것은 아니다. 기존 공통 실행 확인과 서버의 쓰기·충돌·스냅샷 정책은 유지한다. 계약과 남은 읽기 수명주기는 `packages/contracts/sheet-controls.md`를 따른다.

## 통계 본문 조회 수명주기

통계 본문은 React·TypeScript·Vite SPA와 `/api/v2/statistics` 페이지별 API로 구성한다. 대시보드·결과·빌드 목록/상세·보스 목록/상세는 독립 lazy chunk이며, 날짜·정확한 버전/버전 계열·게임 모드·최소 단계·중간보스 도달 필터를 URL에 보존한다. 필터가 바뀌면 직전 완료 결과를 유지한 채 해당 영역만 loading으로 표시하고 이전 요청을 AbortController로 취소한다. 서버의 publication revision ETag와 클라이언트 캐시는 같은 완료본의 중복 조회를 줄인다. HTML과 API는 기존 Company SSO를 검증하지만 해시 정적 자산은 인증 조회를 생략하고 1년 immutable로 제공한다.

`/users`와 `/api/v2/statistics/users`는 계정 연동 UID를 해시 처리한 뒤 기간 내 한 번만 세어 항목 사용률, 챕터/단계 도달과 이탈, 처음 관측된 Run 시간을 제공한다. 원본 UID와 개별 사용자 행은 API에 노출하지 않는다. 노드 관련 사실과 사용자 집계는 `110~119` 최종 노드가 있는 완성 트리만 포함하며, 툴팁은 document body portal과 viewport 좌표를 사용해 사이드바·스크롤 패널에 잘리지 않는다.

## 통계 분석 저장소와 보존 경계

Azure PlayFab Parquet는 수정·삭제하지 않는 영구 원본이다. `statistics-worker`가 최근 날짜 파티션만 증분 수집하고 출정·보스·구성요소 사실 테이블 및 날짜/버전/버전 계열/모드/단계/중간보스 조건별 일 집계를 ClickHouse에 기록한다. 화면 요청은 Azure·JSON·SQLite를 순회하지 않고 완료된 일 집계만 조회한다. 고유 플레이어는 `uniqCombined64` 근사 집계이며 나머지 건수와 비율은 정확 집계다.

ClickHouse 원본·구성요소·일 집계·수집 표식은 `STATISTICS_RETENTION_DAYS` 기본 90일 TTL을 공유한다. 최초 이관과 용량 사전 검사도 같은 기간만 계산한다. 기존 SQLite 볼륨은 첫 정상 발행과 검증 전까지 읽기 전용 백필/롤백 원본으로 보존한다. 집계는 새 revision에 변경 날짜를 만들고 원본 건수와 출정·조우·처치·계정 연동 사용자 합계를 검증한 뒤 publication을 한 번에 바꾼다. 실패한 실행에서 원본 적재만 끝났거나 예전 파이프라인의 일 집계와 원본이 달라진 날짜는 같은 일별 합계를 대조해 다음 실행의 재집계 대상에 포함한다. 출정·보스 합계가 다른 날짜는 전체 일 집계를 1일씩, 계정 연동 사용자만 다른 날짜는 플레이어 관련 집계만 최대 3일씩 다시 만든다. 배치는 월 경계를 넘지 않으며, 대용량 엔티티 집계는 단일 스레드와 쿼리 메모리 제한을 적용하고 외부 집계를 허용한다. 실행 중에도 이전 ready revision은 계속 조회할 수 있다.

## 통계 갱신의 워커 접수 경계

`statistics-web`과 `statistics-worker`는 별도 컨테이너다. 웹은 인증된 내부 `/state`·`/refresh` API로 실제 워커 가용성과 publication을 읽으며, POST는 워커가 요청 번호를 포함해 실제 요청을 접수한 뒤에만 202를 반환하고 완료를 뜻하지 않는다. 워커는 동시 실행을 거부하고 마지막 성공 후 1시간 제한을 적용하며, 서버가 확인한 `admin`·`master`의 명시적 강제 요청만 제한을 우회한다. 매일 KST 오전 6시 자동 실행과 수동 실행은 같은 단일 작업을 사용하고, 자동 실패는 15분 간격으로 최대 3회 재시도한다. running/error 행은 마지막 성공 revision·완료 시각·데이터 기준을 덮지 않으며, 다음 ready publication이 검증될 때만 화면 캐시가 새 revision으로 바뀐다. 대용량 ClickHouse 복사는 명시적인 장기 query timeout을 사용하는 Node HTTP 전송으로 실행해 기본 fetch의 응답 헤더 제한과 분리한다.

## 통계 필터·탐색 UI

대시보드는 핵심 지표와 추이만, 결과·빌드·보스는 서버 정렬·검색·페이지네이션 목록만 표시하며 항목은 별도 상세 경로로 이동한다. 목록은 기본 50개이고 정렬은 열 헤더의 `aria-sort`와 연결한다. 필터와 정렬·페이지는 URL로 복원하며 표의 도움말·아이콘·차트 tooltip과 로딩 overlay는 키보드와 좁은 화면에서도 본문 폭을 넘기지 않는다. 마지막 집계 시각과 데이터 기준 시각, 최근 90일 보존 범위는 모든 화면에서 확인할 수 있다.

React 통계 화면도 문서의 `data-company-workspace` 마운트, 권한 기반 `cw-sidebar`, `workspace cw-main` 본문을 그대로 소비한다. 회사 로고·계정·알림·서비스 전환·테마와 전역 사이드바 기하는 공통 셸 소유이며, 통계 앱은 상단 집계 정보와 필터·차트·노드 트리 등 업무 본문만 소유한다. 통계 CSS는 공통 팔레트 토큰을 사용하고 전역 `aside`·`nav`·`header`·`button` skin이나 별도 브랜드 셸을 만들지 않는다.

## 새 UI 추가의 공통 primitive 경계

`check:ui`는 셸/페이지별 계약 외에 등록된 전체 앱 소스의 native 버튼·일반 입력·표·dialog 및 literal DOM 생성/전역 확인 호출을 검사한다. `packages/contracts/ui-primitive-debt.json`은 부채 0에서 봉인되어 `sealed` 해제나 새 경로·규칙·서명·개수 예외를 거부한다. 생성 파일의 내용은 실제 소유자 출력과 대조하며 버전이 찍힌 HTML 본문은 계속 검사한다.

계약은 `packages/contracts/ui-primitives.md`다. 감소 전용 prune는 새 위반이 함께 있으면 쓰지 않는다. 이는 임의 동적 코드의 완전한 AST/데이터 흐름 검사나 일반 폼 전송·해제 계약의 강제를 대신하지 않는다. 53차의 남은 Leave 업무 목록은 우선 전환 대상이지 모든 앱의 전체 미전환 UI 목록이 아니다. 기존 공통 저장 계약 연결과 버튼/표 등의 시각 primitive 전환도 구분한다.

## 연차 보정·발생분 공통 편집기

보정·추가·삭제는 기존 업무 코어를 유지하고 `Adjustments.Protocol.cs`에서 현재 관리자/대상 직원/발생분 기준값과 공통 폼 응답을 연결한다. `LeaveGrantSnapshot`은 정산과 공유하며 정산은 조회일·가용량을 추가한다. 퇴사 직원 과거 보정·음수 일수·합산·삭제 제한·감사 경계는 유지한다. native 실패는 허용 원문만 인코딩하고 새 탭 조회로 복구한다.

실제 UI는 `leave-grants.js`의 공통 폼/확인/세션과 `leave-grants-contract.js`의 정밀 값/전체 응답 계약으로 분리한다. 같은 발생 슬롯의 이전 기준값은 세 작업이 공유하고 확인된 처리 이후 재사용하지 않는다. 직원별 조회/행 DOM을 보관하여 직원 목록 왕복이나 순차 저장이 다른 초안을 지우지 않는다. 읽기 실패는 기존 목록을 유지하고 미확정 쓰기는 재전송하지 않는다. 최초/후속 행은 동일 Razor partial, 입력/버튼은 공통 native 클래스, 표 제목/확인창 사진은 공통 entity 표시를 사용한다. 세부 입력·호환·한계는 `packages/contracts/leave-grants.md`다.

Leave의 가불은 현재 연차년도 순지급량과 승인·승인대기 사용량을 기준으로 재계산한다. 신청·관리자 강제 기록·취소, 자동 월차/연차 발생, 관리자 지급 증감, 소멸·이월·보상 뒤에 같은 조정기를 실행해 오래된 신청부터 지급분을 배정하고 실제 부족분만 월차/다음 연차 가불로 둔다. 같은 연차년도의 과거 중복 상환 정산은 신청 배정으로 정규화하고, 연차년도 경계를 넘긴 다음 연차 상환은 지급분 정산으로 보존한다.

## 정산 화면과 공통 native 필드

소멸·이월·보상은 공통 폼·확인창·상태·세션을 사용한다. 직원 초성 검색/프로필과 실제 발생분 ID는 분리하며 서버 현재 관리자·대상·발생분/배정/정산 기준값을 대조한다. 기존 차감·이월 트랜잭션·감사 정책은 유지한다. 확인된 저장은 폼을 보관하고 최신 내역 GET을 제공하며, 커밋 후 감사 오류를 포함한 결과 미확정은 자동 재전송하지 않는다. 상세 계약은 `packages/contracts/leave-settlements.md`다.

입력 필드의 기본 그리드·라벨·컨트롤·전체 열과 native 버튼 클래스는 공통 `primitives.css`가 소유한다. 앱 전체 입력을 덮어쓰지 않고 명시적으로 opt-in한다. 정산/보정은 현재 필드 소비자이며 공휴일/채널 설정 등 모든 필드의 전환 완료를 의미하지 않는다. `packages/contracts/native-fields.md`의 타입·테마·native 검증 규약을 따른다.

## 복수 편집기의 공통 작업 세션

공통 `CompanyForm.createSession()`은 한 문서의 확인/전송을 직렬화하고 확인된 저장과 결과 미확정을 구분한다. Leave의 신청·취소·외부 일정·관리자 추가/삭제는 같은 세션에서 실제 초안을 등록한다. 성공한 폼 때문에 다른 초안을 잠그지 않으며 처리한 신청/이전 버전은 다른 표시 경로에서도 재사용하지 않는다. 외부 일정은 검증된 생성 ID/새 버전으로 편집기를 갱신한다. GET은 작업 revision을 대조해 저장 전에 시작한 읽기가 늦게 DOM을 교체하거나 redirect하지 않도록 한다. 원래 서버 인가·DB·업무 정책·전체 응답 검증은 유지한다. 자세한 API와 한계는 `packages/contracts/form-session.md`를 따른다.

## 달력 강제 연차 작업 공통 연결

관리자 강제 추가/삭제는 기존 native handler에서 공통 저장 응답 계약을 제공한다. 관리자·전체 신청 기준값을 대조하고 실제 재직 직원 및 기존 삭제 권한·과거 기록/반차/가불 복구 정책을 유지한다. 신규 결과의 해시는 추적 객체가 아닌 실제 DB 재조회와 일치시킨다. 확실한 검증 오류와 저장/감사/알림 결과 미확정을 구분하고 native 실패 원문은 인코딩해 보관한다.

정상 달력 폼은 `leave-calendar-admin.js`가 공통 폼/확인/상태에 연결한다. 삭제 사유는 공통 입력 확인창을 사용하고 전체 사용일을 확인한다. 날짜 이동은 기존 추가 초안을 덮어쓰지 않으며 삭제 사유는 취소/이어쓰기·대상 전환 시 보존/폐기 의도를 구분한다. 다른 신청/취소/외부 일정과 진행 상태·실제 초안을 연결하고 처리 중 GET 교체/오류 redirect를 막는다.

확인된 저장 뒤 독립 초안은 공통 작업 세션을 통해 같은 문서에서 순차 재개한다. 기존 날짜 상세 프레임·나머지 보정/정산 등 업무 UI와 운영 전환까지 완료한 것은 아니다. 도메인 계약과 검증 범위는 `packages/contracts/leave-calendar-admin.md`를 따른다.

## 외부 일정의 공통 폼 연결

Leave 달력의 외부 일정 저장/삭제는 동일 handler에서 native 호환과 `workspace-form-v1` 응답을 제공한다. enhanced 요청은 현재 관리자·정확한 일정 번호·이전 fingerprint를 대조한다. 모드, 문자열 관리자/대상/일정 ID, 정규화 입력과 이전/이후 기준값을 반환한다. SQLite 시각 Kind 차이는 ticks 기반 해시로 정규화한다.

입력 오류·권한/충돌·결과 미확정을 구분하고 업무 저장 뒤 감사 실패를 롤백으로 안내하지 않는다. native 실패는 허용된 원문을 인코딩해 보관하고 외부 일정 쓰기 UI를 잠근다. 기존 DB·감사·인가·직원 정책은 유지한다.

실제 칩/편집 폼은 서버 fingerprint와 현재 관리자 ID를 전달하고 `leave-external-schedules.js`가 공통 폼/확인/상태에 연결한다. 날짜 선택은 초안을 덮어쓰지 않으며 대상 전환/초기화는 공통 확인을 사용한다. 초안/쓰기 중 달력 교체 및 오류 redirect를 막고 다른 신청/취소와 동시에 쓰지 않는다. 다른 POST 초안이나 삭제와 무관한 외부 일정 초안은 저장 확인 후에도 보존한다. 전송 중 입력 변경·계정 변경/timeout/해제 뒤 응답을 배제한다. 상세는 `packages/contracts/leave-external-schedules.md`다. 기존 달력 상세 프레임·관리자 강제 연차 작업 전환은 별도로 남는다.

## 직원 취소·철회의 공통 처리

목록과 달력 상세는 `_SelfActionForm`을 공유하며 `leave-self-actions.js`가 공통 폼/확인창/상태에 연결한다. 관리자 승인 해시를 `LeaveRequestSnapshot`으로 추출해 직원 취소와 같은 정의를 사용한다. 서버는 현재 직원의 소유 신청과 전체 날짜를 포함한 스냅샷을 대조한다. 승인 전 즉시 취소, 승인 후 취소 승인 대기, 철회 후 승인 상태라는 기존 도메인 차이를 보존한다.

신청/취소의 동시 쓰기와 전송 중 목록/달력 교체를 막고, 동적 폼은 연결/해제한다. 확인창은 사용 기간·사유·번호를 보여주며 Escape는 뒤쪽 상세창을 닫지 않는다. 전체 응답을 확인한 후에만 이동하고 다른 초안이 있으면 새 탭 내역 링크를 제공한다. commit 후 감사/알림 실패와 timeout/범위 변경은 롤백이나 자동 재전송으로 처리하지 않는다. 계약은 `packages/contracts/leave-self-actions.md`이며 원자적 DB CAS/영구 멱등성·달력 관리 폼 전환은 별도 미완료다.

## 직원 연차 신청의 공통 폼 연결

Leave Apply는 공통 폼·확인창·상태를 사용한다. 화면을 연 로컬 직원, 확인 당시 입력과 전체 저장 응답(문자열 신청 ID·Pending 상태·정규화 필드·근무일/차감 일수·로컬 내역 경로)을 대조한다. 기존 서버의 근무일·충돌·가불·배정과 알림 정책을 공통 UI로 옮기지 않는다.

확실한 사전 입력 오류만 수정 후 재신청할 수 있다. 저장 후 감사/알림 오류는 일부 반영됐을 수 있어 미확정으로 처리하고 반복 쓰기를 잠근다. 다른 POST 편집 초안이 있으면 성공 후 자동 문서 이동 대신 현재 내역 링크를 제공한다. 계정 변경·해제·timeout 뒤 이전 응답은 적용하지 않는다. 상세는 `packages/contracts/leave-application.md`이며 취소/철회·달력 관리 폼은 아직 별도 전환 대상이다.

## 연차 승인 화면의 공통 처리

Leave의 승인·반려·취소 승인/반려·강제 삭제는 `_ApprovalAction`과 `CompanyForm`/`CompanyDialog`/`CompanyState`를 사용한다. 현재 로컬 직원과 신청 스냅샷을 서버에서 대조하고 전체 처리 응답을 확인한 뒤에만 완료를 반영한다. 입력/확인/쓰기 중 폴링의 DOM 교체를 막고 다른 행의 삭제 사유를 보존한다. 확인된 처리와 후속 조회 실패를 구분하며 미확정 요청은 자동 재전송하지 않는다. 계정 변경·해제 뒤 늦은 응답/폴링을 배제한다.

연차 서비스의 기존 DB·상태 전환·가불/배정·감사/알림 정책은 유지한다. 스냅샷은 읽기 시점 대조이며 원자적 DB 경쟁 제어나 멱등성을 추가한 것은 아니다. 업무 변경 뒤 감사/알림 실패는 일부 반영 가능성이 있어 미확정으로 안내한다. 자세한 입력/응답과 호환·초안 한계는 `packages/contracts/leave-approvals.md`를 따른다. 다른 연차 폼/달력 모달 전환은 별도 작업이다.

## 조직 관리의 공통 폼 연결

Portal 부서·프로젝트의 실제 native POST를 `CompanyForm`/`CompanyState`/`CompanyDialog`에 연결한다. 확인 전 입력을 캡처하고 확인 중 또는 전송 중 변경된 초안·계정 범위를 검증한다. 서버는 antiforgery·AdminOnly·마스터 소속 보호와 별도로 `ExpectedUserId`를 현재 계정과 대조한다. 기존 트랜잭션·멤버십·부서 책임자·Leave outbox 및 버전 concurrency token은 유지한다.

커밋된 객체의 ID/버전, 제출 전 ID/버전, 관리 항목과 계정 ID를 문자열로 확인 응답에 담는다. 전체 응답이 제출값과 맞을 때만 저장한 수정 페이지를 GET하여 정규화된 값과 신규 조직의 추가 설정을 읽는다. HTML/손상 응답·권한·충돌·미확정 결과는 이동/자동 재전송하지 않고 기존 초안을 유지하며 반복 쓰기를 잠근다. 검증 가능한 422 입력 오류만 같은 폼에서 수정할 수 있다. HTML 실패는 원래 버전과 허용 목록의 입력 원문을 보관하며, 현재 선택기로 표현할 수 없는 직원 ID가 있으면 복사용 원문과 새 탭 확인만 제공한다. 원문은 Razor가 HTML 인코딩하며 인증 토큰/임의 POST 항목은 포함하지 않는다.

`OrganizationValidationException`은 알려진 업무 입력 오류이고 `DbUpdateConcurrencyException`은 충돌이다. 그 외 쓰기 오류는 로그에만 남기고 미확정 안내로 반환한다. 새 폼 필드가 없는 이전 HTML 문서는 계정 기준값 누락으로 저장을 거부하므로 새 문서를 열어야 한다. 이것은 영구 멱등성이나 새 탭 간 중복 생성 방지를 보장하지 않는다.

프로젝트 아이콘은 같은 화면의 별도 native multipart 폼으로 저장한다. 프로필과 공통 `CompanyImageEditor`를 사용하고 `CompanyProjectIcon`이 프로젝트 대상·관리자 권한·이미지 버전/확인 응답을 연결한다. 조직 저장 전에 아이콘 초안을 확인하고 조직 전송 중에는 아이콘 편집을 잠근다. 아이콘 변경은 조직 정보 초안을 유지하며 두 저장을 한 트랜잭션으로 합치지 않는다. 기존 raw API는 버전 없는 호환 경로로만 남는다. 상세는 `packages/contracts/project-icons.md`를 따른다. `checkOrganizationForm`/`checkProjectIcon`은 대표 우회 패턴 검사이며 실제 인가/화면 검증을 대신하지 않는다.

## 프로필 설정의 공통 폼 연결

`CompanyImageEditor`는 프로필과 프로젝트 아이콘의 사진 준비·계정/이미지 기준값·공통 폼/상태/확인창을 소유한다. `CompanyProfile`은 개인 사진의 대상/응답 어댑터다. 실제 설정 페이지의 multipart POST는 기존 raw 사진 API와 같은 PNG 검증과 `WorkspaceImageStore`/DB를 사용하지만 정확한 계정과 사진 버전을 대조한다. 버전 없는 raw API의 기존 동작은 호환용으로 유지한다. 입력 및 저장 확인, 쿠키/storage 갱신과 늦은 결과 배제 범위는 `packages/contracts/profile.md`를 따른다. 공통 자산은 primitive API와 이미지 엔진/어댑터를 먼저 정의하고 마지막에 셸을 시작하므로 이미 파싱된 문서에서도 연결 순서를 보장한다.

## 통합 알림 데이터 계약

통합 알림의 공통 요청 소유자는 `CompanyNotificationSession`이다. 셸과 Portal 본문의 읽음 요청을 직렬화하고 요청 당시 계정/권한 범위와 서버의 `expectedUserId` 대조를 함께 사용한다. 정확한 204 확인, 이후 GET 갱신, 미확정 결과의 읽기 전용 복구를 구분한다. 범위 변경/해제/관찰 timeout 뒤 늦은 결과는 적용하지 않으며, 본문은 최초 서버 계정의 문서이므로 범위 무효화 뒤 새 팝업 조회만으로 이전 본문 쓰기를 허용하지 않는다. 공통 상태·빈 결과·알림 카드 의미 색을 사용하되 원본 서비스 DB/읽음 소유권과 기존 인증 경계는 그대로다.

통합 알림의 공개 JSON `sourceId`는 십진 문자열이다. 내부 `long`, 기존 URL·HMAC·CSRF·서비스별 알림 소유권은 유지한다. 공통 셸/알림센터는 `CompanyNotificationContract`의 응답 정규화·대상 키·정확한 ID 비교를 사용한다. 자세한 타입·호환 범위와 한계는 `packages/contracts/notifications.md`에 명시한다. 공개 응답에 안전 범위 밖의 JSON 숫자가 오면 이미 반올림됐을 수 있으므로 거부하고 임의 ID로 요청하지 않는다.

## 공통 테마 이름과 소스 경계

`--cw-*` 정의와 light/dark 모드 팔레트 선택자의 소유자는 `packages/workspace-ui/src/company-workspace.css` 하나다. 공통 파일은 화면 기반색뿐 아니라 본문 단계, 선택/hover, 성공·경고·오류·정보, 주말·공휴일의 의미 토큰을 light/dark 쌍으로 정의하고 헤더/사이드바 크기 및 backdrop은 두 모드 공통값으로 유지한다. 다크 모드의 canvas/surface/raised/hover는 중성 검정·회색 축을 사용하며 파란색은 선택 윤곽과 업무 의미 색에만 남긴다. 두 모드 모두 canvas, surface, raised, hover, active가 서로 구분되고 일반 본문과 선택 본문은 WCAG AA 대비를 충족해야 한다.

앱은 구조와 데이터 의미만 소유한다. 기존 `--bg`, `--surface`, `--text`, `--primary` 등의 별칭이 필요하면 공통 `--cw-*` 토큰으로만 매핑하고, `data-theme`, `.theme-dark/.theme-light`, `prefers-color-scheme`를 사용한 모드별 CSS를 만들지 않는다. 프로젝트·부서·게임 개체처럼 데이터 자체를 구분하는 색은 앱에 둘 수 있지만 화면 배경·패널·입력·상태 팔레트 대용으로 사용하지 않는다. 공통 토큰을 CSS 선언·inline style·JS setProperty·React style 객체로 덮어쓰는 것도 금지한다.

`tooling/check-theme-contract.mjs`는 서비스 등록의 adapter/client 경계에서 Razor Pages/wwwroot, 정적 public, React client/document 및 공통 UI 소스를 재귀 수집한다. 새 페이지뿐 아니라 새 CSS·UI 스크립트도 검사한다. 복제된 Portal 생성 CSS는 생성기 바이트 검사로 검증하며, 기존 Leave의 Bootstrap/jQuery 계열 네 개 vendor 경로만 제외한다. 새 vendor 폴더를 자동 예외로 취급하지 않는다.

이 검사는 리터럴 토큰 이름, 앱별 모드 선택자, 기반 팔레트 별칭의 공통 토큰 매핑과 공통 팔레트의 명암 거리·본문/선택 대비를 정적으로 검사한다. 완전한 CSS/JS 파서나 보안 경계가 아니며 문자열 조립, 앱별 모든 데이터 의미 색상, 최종 레이아웃까지 증명하지 않는다. 기존 테마 전환 목록과 실제 브라우저/시각 검증은 계속 필요하다.

## 목표 구조

| 위치 | 책임 |
| --- | --- |
| apps/portal | 회사 인증·직원·프로젝트·권한 원본, 공통 API 제공 |
| apps/leave | 연차 신청·승인·잔여량·공휴일·연차 알림 |
| apps/schedule | 팀 일정·업무·개인 할 일·일정 알림 |
| apps/cs | Steam/PlayFab 운영 작업 및 로그 검색 |
| apps/statistics | 게임 통계 집계·조회 |
| apps/sheet | 게임 데이터 시트 관리 |
| packages/workspace-ui | 공통 셸·내비게이션·테마·선택기·상태 UI |
| packages/contracts | 서비스/페이지/공통 데이터 계약 |
| tooling | 생성기, 계약 검사, 이관·검증·배포 도구 |
| apps/mobile-android | 신뢰 도메인 WebView 셸, Chrome Custom Tab 로그인, FCM 수신과 세션별 기기 연결 |

모바일 계약은 `packages/contracts/mobile-app.json` 한 곳에서 패키지 ID, 시작 URL, 신뢰 출처, 릴리스 인증서 지문과 앱 버전을 관리한다. Portal은 기기·세션 연결과 푸시 수집/전송을 소유하고 Leave·Schedule은 `afterId` 증분 알림만 제공한다. 세부 보안·중복·오프라인 계약은 `packages/contracts/push-notifications.md`, 배포 순서는 `docs/MOBILE_ANDROID.md`를 따른다.

## 전환 원칙

기존 Razor, React, 정적 HTML을 전면 재작성하지 않는다. 플랫폼 중립적인 셸을 공통 패키지로 추출하고 각 앱의 얇은 연결 계층에서 소비한다. 페이지 본문과 도메인 기능은 앱에 남는다. 공통 패키지가 앱의 코드를 import하지 않도록 의존 방향을 지킨다.

공통 자산 원본은 packages에 있으며 Portal wwwroot는 호환 URL을 제공하는 생성 결과다. 앱의 자산 버전 URL도 내용 해시로 생성한다. CS 정적 페이지, 통계 SPA, 시트·일정·IAP React, Portal·Leave Razor는 공통 페이지 계약에서 메뉴와 서버 경로를 생성한다. 등록된 모든 앱의 페이지 어댑터 연결 이후에도 공통 폼·데이터 계약·전체 업무 화면 전환과 운영 이관은 별도로 남는다. 어댑터의 legacy 수가 0이라는 사실을 전체 목표 완료로 간주하지 않는다.

통계 SPA는 하나의 HTML에 여러 `data-page` 본문을 두고 `view` 값으로 연결한다. 상세 페이지는 `nav:false`와 `parent`로 상위 메뉴를 지정한다. 제목·경로·별칭·view는 계약에서만 정의하며, 동적 메뉴 링크는 앱 라우터가 처리하여 필터와 브라우저 이력을 보존한다. 공통 렌더러는 본문이나 통계 조회를 소유하지 않는다.

React 연결은 `packages/workspace-ui/react/workspace-navigation.tsx`가 소유한다. React는 빈 sidebar mount만 만들고 메뉴 자식은 공통 DOM 렌더러가 소유한다. `useWorkspacePage`는 계약으로부터 URL·현재 페이지·브라우저 이력을 연결한다. 새 페이지 컴포넌트는 생성한 additionalPages에 자동 연결되며 기존 앱의 `Record<View, ReactNode>`가 본문 누락을 타입 검사한다. 앱별 Docker context를 유지하기 위해 adapter와 계약을 앱의 generated 폴더에 복제 생성하되 수동 편집은 `build --check`에서 차단한다.

## 계정 등록·수정 필드 계약

`packages/contracts/account-fields.json`은 관리자가 편집하는 계정의 11개 필드와 표시 위치·길이 제한의 원본이다. 생성된 `AccountInput`을 등록·기존 단건 수정·일괄 수정이 함께 사용한다. Portal의 `_AccountField`는 동일 필드를 등록 양식과 권한 표/상세에서 렌더링한다. 기존 직원의 조회값 투영(`InputFor`), 서버 정규화(`Prepare`)와 반영(`Apply`)도 각각 한 곳에서 관리한다. 서비스 권한 선택지는 기존 `CompanySystemCatalog`를 사용하여 IAP 소비 서비스의 권한을 보존한다. 생일은 이 관리자 편집 경계에서 연도 없는 `MM-DD`로만 표시·입력하며 일반 회사 디렉터리에는 넣지 않는다.

표의 공개 범위 버튼은 상세의 실제 체크박스로 이동하는 바로가기이며 두 개의 편집값을 동기화하지 않는다. 등록과 수정의 계정 유형 변경도 같은 코드로 필드를 활성화한다. 공용 전환 중 숨긴 소속/입사일 초안은 직원으로 되돌리면 복원하지만 서버는 공용 계정의 소속을 기존 정책대로 제거하고 관리자 역할 위조를 거부한다. 신규 등록도 활성/비활성을 지정할 수 있으며 기본은 활성이다.

필드 추가 시 렌더러·기존값 투영·서버 정규화 누락을 구조 검사에서 차단한다. 이 검사는 정적 가드이지 업무 인가의 증명이 아니므로 실제 POST 왕복 및 부정 입력 검사를 병행한다. 기존 마스터 보호, 중복 이메일, 일괄 변경 버전 검사, 트랜잭션과 Leave outbox는 유지한다. 직원 일괄 편집은 공통 폼 수명주기에 연결하며, 나머지 폼/상태와 직원/프로젝트 선택기 전환은 별도 작업으로 남아 있다.

## 공통 저장 수명주기

`forms.js`의 `CompanyForm.createTransport`는 동일 출처 JSON 쓰기와 native FormData POST의 공통 관찰 소유자다. `attach`는 기존 native 검증/다중 값·checkbox/antiforgery/disabled·focus 어댑터이며 별도 fetch를 구현하지 않는다. JSON은 정확한 제출 복사본으로 전체 ACK를 대조한다. 상태/범위·해제/timeout/늦은 응답과 중복 전송 방지는 같은 코드를 사용한다. 요청은 자동 재전송하지 않으며 HTML/리디렉션/손상 응답/timeout/통신 오류는 성공이나 확실한 롤백으로 간주하지 않는다. 계약은 `packages/contracts/json-form-transport.md`와 `form-session.md`를 따른다.

직원 권한 일괄 저장은 수정한 행만 `updates.Index`로 전송한다. 서버는 기존 인가·버전 검사와 트랜잭션을 유지하고 커밋이 성공한 경우에만 `workspace-form-v1` 확인 응답을 보낸다. 같은 `AccountInput` 필드 계약으로 정규화된 저장값을 문자열 배열로 반환하며 long ID와 ticks는 숫자 정밀도 손실 없이 문자열로 전달한다. 클라이언트는 응답 전체를 검증한 뒤 해당 행의 값·버전·reset 기준·목록/검색 표시·현황 수를 갱신한다. 다른 폼의 초안은 그대로 둔다. 실패 응답으로 원래 버전을 갱신하거나 자동 덮어쓰지 않는다.

초안은 현재 화면과 전송한 요청에만 남으며 localStorage 등에 직원 정보를 저장하지 않는다. 탭을 닫거나 사용자가 새로고침하면 유지되지 않는다. 일반 HTML POST의 처리 가능한 실패도 전송한 계정 필드 원문을 no-store 응답으로 보존한다. 형식·권한·수정 전 기준값을 확인할 수 있는 일괄 입력은 기존 편집 양식에 복원하며, 확인할 수 없는 입력은 복사용 원문으로 남긴다. 레거시 단건 수정의 공통 저장 수명주기 연결과 다른 서비스 폼의 이관은 별도로 남는다.

`Baseline` hidden 입력은 같은 AccountFields/FormValues로 생성한 ID·버전 문자열·수정 전 필드값이다. HTML 실패 시 새로 읽은 서버 값을 원래 기준으로 오인하지 않도록, 전송한 ID/버전과 일치할 때만 기존 기준과 초안을 함께 복원한다. 클라이언트가 보낸 기준값은 표시·되돌리기용 비신뢰 데이터이며 서버 인가·현재 버전 검사·Prepare·트랜잭션을 대신하지 않는다. 서명된 저장 증거나 충돌 우회 토큰이 아니다. 성공 확인/명시적 비교 적용 뒤에는 hidden 값과 native reset 기본값도 함께 갱신한다.

원문 보관은 AccountFields에 있는 필드만 허용하고 antiforgery·임의 POST 필드·오류 내부 정보를 덤프하지 않는다. 잘못된 날짜/선택·기준값 누락·삭제되거나 수정할 수 없는 계정은 최신 목록의 값/버전을 초안으로 바꿔 재전송하지 않는다. 복원 가능한 일괄 행만 동일 `_AccountField`로 편집하고 원래 버전을 유지하며, 버전 충돌은 공통 3방향 비교로 명시적으로 검토한다. 기존 선택을 해제한 초안이라도 되돌리기에 필요한 보관 부서/프로젝트 선택지는 유지한다.

HTML 등록/일괄 저장의 미확정 실패는 해당 폼의 반복 쓰기를 잠그고 새 탭의 현재 목록 확인을 제공한다. 브라우저 저장소에 자동 복원하거나 재전송하지 않는다. 입력 형식 때문에 편집 양식에 안전하게 담을 수 없는 신규 등록은 복사용 원문만 남기며 새 화면에서 수정해야 한다. 레거시 단건 Update 실패는 원문 보관만 지원하고 자동 편집 복원/새 버전 재기준화를 하지 않는다. 프레임워크에서 handler 실행 전에 거부한 요청·네트워크 단절·다른 별도 폼의 미전송 초안은 HTML 응답으로 복구할 수 없다.

JavaScript 미지원 경로에서는 noscript 전용 CSS가 같은 native 상세 필드를 표시하고 전체 직원 제출 버튼을 제공한다. 정상 JS 화면의 공통 펼치기/변경 행 제출은 유지한다. 서버는 native 전체 제출에서도 동일 권한·중복 이메일·기존 버전 및 원자적 일괄 저장을 검증한다. 큰 목록의 요청 크기 등 기존 서버 제한을 자동으로 확대하지 않는다.

직원 일괄 편집의 되돌리기는 `CompanyDialog.confirm`으로 미저장 변경만 버리는 동작임을 설명하고 신규 등록 초안을 보존한다. 확인 시작의 전체 행 입력을 캡처하며 확인 중 입력이 달라지거나 로그인 범위/화면이 바뀌면 되돌리지 않는다. 계정 범위 변경 후에는 이전 화면에서의 일괄 저장·비교 재조회·되돌리기·권한 일괄 전환을 차단하고, 입력을 보존한 채 새 화면에서 계정과 저장 여부를 확인하도록 한다. 실제 API 인가는 그대로 유지한다.

저장 응답은 전송 때 캡처한 행 입력과도 대조한다. 전송 중 프로그램에 의해 바뀐 초안을 응답으로 덮어쓰지 않으며 원래 버전/reset 기준도 갱신하지 않는다. non-persisted pagehide에서는 공통 전송기·펼치기·신규 등록 연결을 해제하고 열려 있는 비교/확인 및 조회를 취소한다. bfcache 보관 시에는 살아 있는 연결을 유지한다. 클라이언트의 처리 중단은 서버 저장 취소 보장이 아니다.

공통 폼은 진행 중 요청의 객체를 식별자로 사용한다. `workspace-entity-scope-change`, timeout, `dispose()` 뒤의 응답은 fetch가 취소를 무시해도 적용하지 않는다. 응답 JSON 읽기와 소비자 확인 처리 이후에도 같은 요청인지 검사한다. 종료는 한 번만 수행하며 이전 요청의 finally가 새 요청의 잠금을 풀지 않는다. 해제 시 원래 disabled/aria-busy를 복원하고 리스너를 제거하며, 화면에서 제거된 폼에는 결과 콜백을 호출하지 않는다. 취소는 클라이언트 관찰 중단이지 서버 트랜잭션의 롤백 보장이 아니다.

`onSaved(data, submitted, {signal,isCurrent})`는 전체 응답 검증 후 동기적으로 기준값을 반영하는 것이 기본이다. 비동기 소비자는 자체 await 뒤, 값을 바꾸기 전에 `isCurrent()`를 확인해야 한다. 공통 계층이 소비자 내부의 비동기 부작용을 되돌릴 수는 없다. `onSettled(saved, outcome)`은 saved/invalid/conflict/denied/unknown/scope-changed를 구분하며 scope 변경 시 초안을 보존한다. dispose 후에는 호출하지 않는다. 새 계정 범위에서의 명시적 재검토·저장 가능 여부와 서버 인가는 소비자 책임이며, 이 연결은 자동 재시도나 전역 재인증 정책을 추가하지 않는다.

## 공통 변경 비교와 충돌 검토

`review.js`의 `CompanyReview`는 수정 전·내 초안·현재 서버 값의 3방향 비교를 표시한다. 값은 문자열 배열이며 ID와 큰 정수를 숫자로 변환하지 않는다. 순서 없는 프로젝트/권한은 집합 비교로 지정한다. 서로 다르게 수정한 필드는 사용자가 선택해야 하며, 한쪽만 변경한 필드는 해당 변경을 기본 선택한다. 현재 선택에 해당하는 열만 테마 토큰으로 강조한다. PC는 3열, 모바일은 세로 배치이고 직원/프로젝트 아이콘은 공통 entity 렌더러를 사용한다.

이 컴포넌트는 조회·저장·권한·버전 갱신을 수행하지 않고 선택한 필드만 반환한다. native dialog가 배경 입력과 키보드 포커스를 격리하며 Escape/취소/계정 범위 변경은 null을 반환한다. 업무별 필드 조합 검증은 소비자의 validate 콜백이 수행한다. 공용 계정의 부서/프로젝트와 관리자 역할 같은 조합은 임의 병합하지 않는다.

Portal 일괄 편집은 충돌 안내의 명시적 버튼으로만 현재 계정을 다시 읽는다. 서버는 AdminOnly와 대상 관리자/마스터 편집 권한을 재검사하고, 읽기 트랜잭션에서 같은 계정 필드·버전·선택 목록을 no-store로 반환한다. 읽기는 직원/버전/Leave outbox를 수정하지 않는다. 클라이언트는 전체 응답을 검증하고 조회·검토 중 초안이나 계정 범위가 바뀌면 적용을 거부한다. 확인된 최신 프로젝트/부서 선택지는 ID로 추가하고 이름으로 연결하지 않는다. 현재 화면이 표현할 수 없는 새 권한 정의는 초안을 유지한 채 재확인을 안내한다.

비교 결과 적용은 현재 서버 값을 reset 기준으로 삼고 선택한 값을 초안으로 올리는 동작이다. 자동 저장하지 않는다. 사용자가 별도로 저장할 때 비교한 버전을 보내며, 그 사이 또 변경되었다면 서버가 다시 409를 반환한다. 이 연결을 우회하는 Portal 일괄 편집은 구조 검사에서 거부한다. 다른 업무 화면의 변경 표시/확인창 전환까지 완료된 것은 아니다.

팀 일정의 업무 편집도 같은 비교창을 사용한다. `react/workspace-review.ts`는 타입과 호출만 연결하고 React가 별도 비교창을 렌더링하지 않는다. 소비자가 전달한 AbortSignal로 페이지 해제/계정 범위 변경 시 창을 닫는다. 업무의 편집 시작 값을 기준으로 최신 업무와 디렉터리를 다시 읽고, 조회 중 초안·사용자 범위가 바뀌거나 편집 권한이 사라지면 적용하지 않는다. 본문은 멘션 ID와 큰 정수를 포함한 원문 문자열로 유지한다. 현재 서버보다 더 최신인 폴링 응답도 버리지 않는다.

업무 필드 및 첨부 선택의 조합 검증은 일정의 `taskReview.ts`가 소유한다. 목표/실제 날짜 순서·담당자 자격·프로젝트 접근을 재확인하며, 서버에서 이미 제거된 기존 첨부를 선택만으로 복구하지 않는다. 새로 업로드한 초안 첨부와 현재 서버 첨부만 적용할 수 있고 저장 시 서버의 소유권/만료 검증도 유지한다. 비교 결과는 초안과 기준 버전만 바꾸며 명시적 업무 저장이 따로 필요하다. 업무의 버전만 교체하는 기존 재시도 UI는 제거하고 알려진 우회 패턴을 정적 검사한다.

댓글은 `CommentComposer`와 `commentReview.ts`에서 같은 비교/상태 UI를 소비하고 `useCommentWrites`가 생성·답글·수정의 공통 저장을 소유한다. 업무 편집 가능 여부와 댓글 작성자 권한은 다르므로 `detail.canEdit`를 댓글 권한으로 쓰지 않는다. 최신 업무·댓글·디렉터리의 작성자/활성/접근/공용 여부·삭제·보관 상태와 opaque 댓글 기준값을 확인하고 현재 값만으로 버전을 교체하지 않는다. 서버의 작성자 전용 PUT, 버전 검사, 첨부 소유권·멘션 알림은 유지하며 기준 읽기부터 전체 ACK 캡처까지 트랜잭션 안에 둔다. 폴링에서 댓글이 삭제된 것으로 바뀌어도 열린 편집 초안은 남기고 저장을 막는다. 성공 ACK 뒤 목록 GET 실패는 다시 쓰지 않고, sent/unknown 문서 세션은 재전송하지 않는다.

댓글 저장 중에는 입력·첨부 변경과 중복 제출을 잠근다. 기존 API의 확인 응답에서 댓글 ID/작성자/대상 업무/답글 대상/본문/버전을 검사한 후에만 초안을 정리한다. 성공한 쓰기와 뒤따르는 목록 조회는 분리하여, 목록 조회만 실패한 경우 다시 저장하라고 안내하지 않는다. 불완전 응답·통신 실패는 서버 반영 여부 미확정으로 알리며 자동 재전송하지 않는다. 이 연결 누락과 알려진 버전 교체 패턴을 검사하되 다른 폼·확인창·저장 수명주기 전체 이관의 완료로 보지 않는다.

## 공통 확인창과 시트 실행 경계

`dialogs.js`의 `CompanyDialog.present`가 공통 확인창과 기존 3방향 비교창의 단일 모달 수명주기를 소유한다. native dialog, Escape/취소/외부 close, AbortSignal, 계정 범위 변경, DOM 정리와 포커스 복원을 공유한다. 네이티브 창 열기 실패도 잠금/리스너를 해제한다. React가 취소한 실행 버튼의 disabled 상태를 해제한 뒤 포커스를 한 번 더 복원하되 새 창이나 사용자가 옮긴 포커스를 빼앗지 않는다.

`CompanyDialog.confirm`은 대상 설명·선택적 정확한 확인 문구·비활성 이유·동기 검증 콜백을 받고 의도만 반환한다. 비즈니스 읽기/쓰기나 권한 판단을 소유하지 않는다. React는 generated `confirmWorkspaceAction`을 호출한다. `useSheetActions`가 시트 수식 전환/한국어 갱신의 검토한 분석 ID·미리보기 ID, 대상, 설정, 화면, 로그인 범위를 캡처한다. 확인 중 값/권한/화면이 바뀌면 쓰기를 거부하고 중복 실행을 잠근다. 서버의 기존 인증·쓰기 허용 설정·정확한 확인 문구·fingerprint 재검증·스냅샷·실패 복구는 그대로 유지한다.

시트의 기존 독립 확인/결과 모달과 해당 CSS를 제거했다. 실행 응답의 대상·미리보기·건수·스냅샷을 확인한 뒤 공통 성공 상태를 표시하고 후속 조회 실패는 별도로 알린다. 통신 실패/불완전 응답은 미반영으로 단정하지 않고 현재 데이터와 스냅샷을 명시적으로 다시 읽게 한다. 읽기 재시도는 쓰기를 반복하지 않으며 계정 범위가 바뀐 뒤 도착한 이전 응답을 표시하지 않는다. 조회만으로 이전 요청의 정확한 실행 여부를 확정할 수 없는 한계도 표시한다. 다른 서비스 확인창과 동기식 이탈 방지까지 전환 완료된 것은 아니다.

## 일정 확인 작업과 초안 경계

일정의 업무 보관·관리자 복원·댓글 삭제는 `useTaskActions`에서 같은 확인창을 사용한다. 최신 업무/디렉터리를 읽어 대상·버전·본문·권한을 대조하고, 확인창이 열린 동안 폴링이나 계정/초안/페이지가 바뀌면 기존 의도로 실행하지 않는다. 비동기 사전 조회로 버튼이 잠기기 전에 포커스를 캡처해 공통 창에 넘긴다. 댓글 작성 중 또는 편집창이 열려 있으면 보관/복원/삭제를 막고, 초안을 실제 원본으로 되돌렸을 때는 변경 상태도 해제한다.

보관/복원 응답의 업무 ID·증가한 버전·보관 상태·변경하지 않은 필드를 검증하고 댓글 삭제는 기존 HTTP 204만 완료로 확인한다. 삭제는 댓글 본문/첨부 연결만 제거하고 답글·감사 기록을 유지하는 기존 서버 계약을 보존한다. 후속 업무/목록 조회 실패는 확인된 성공을 취소하지 않는다. 목록 갱신은 실패를 호출자에게 전달하는 경로를 사용하며, 명시적 재확인은 읽기만 수행한다. 불완전/통신 오류는 반영 여부 미확정으로 표시하고 자동 재전송하지 않는다. 다른 일정 상태 변경/폼·TODO 삭제까지 이관된 것은 아니다.

## 버전 기록의 비교·저장 경계

일정 `useReleaseEditor`는 버전 상세 폼을 공통 `WorkspaceState`·`openWorkspaceReview`와 라우터 이탈 보호에 연결한다. 기준 기록과 초안을 별도로 보존하고 저장·삭제 직전 최신 기록·디렉터리를 읽는다. 서버 기록이 바뀌면 이전 버전으로 덮어쓰거나 삭제하지 않고 3방향 비교 또는 최신 화면 재진입을 요구한다. 비교 결과는 초안과 기준 버전만 바꾸며 자동 저장하지 않는다. 신규 등록과 삭제의 불확실한 결과에는 요청을 반복하지 않고 목록에서 기록 존재 여부를 확인하도록 안내한다.

`releaseReview`는 프로젝트·기본/마이너 번호·작성자·이전 출처의 불변성과 응답 버전·정규화된 저장 내용을 검사한다. 날짜와 미기재 여부는 한 쌍으로 비교하며 수정된 날짜를 미기재로 되돌리지 않는다. 롤백/해결 대상은 해당 ID를 다시 읽어 프로젝트·버전 순서·안정 상태와 문제 내용의 조합을 검증한다. 삭제는 마이너가 남은 기본 버전과 다른 기록이 참조하는 버전을 거부하고, 해당 변경 이력과 기록을 한 트랜잭션에서 제거한 뒤 삭제 직전 전체 행을 ACK한다. 서버의 관리자/책임자·비공개 프로젝트·Version·감사 검사는 유지한다. 보관 프로젝트의 기존 기록 수정과 신규 등록 거부도 그대로다.

쓰기 응답 확인 이후에만 기준/초안을 정리한다. 성공 후 목록 조회 장애는 저장 성공과 분리하며 명시적 목록 재확인은 읽기만 수행한다. 401/403/409·불완전/HTML/통신 응답은 기존 초안을 유지하고 반복 저장을 막는다. 명확한 400 입력 거부는 입력을 고쳐 다시 제출할 수 있다. 계정 범위 변경·해제 뒤 늦은 응답은 적용하지 않는다. 참조 버전/이력 조회도 저장 버전·계정별 세대를 확인하고 잘못된 스냅샷은 렌더링 전에 거부한다. 목록의 다른 개별 상태·상세 펼치기, 다른 업무 폼의 전환까지 완료한 것은 아니다.

## 개인 TODO의 확인·저장·초안 경계

`usePersonalTodos`는 삭제의 공통 확인창과 추가·수정·완료·되돌리기·정렬의 공통 결과 상태를 연결한다. `personalTodoContract`가 목록의 소유자/중복/필드와 쓰기 응답의 대상·원문·버전을 검증한다. 삭제·정렬의 기존 HTTP 204와 JSON 저장 응답을 구분하며 응답 확인 전 값을 지우거나 성공한 것처럼 정렬하지 않는다. 삭제는 현재 목록을 먼저 읽어 내용·버전을 대조하고 명시적 확인 뒤 기존 서버의 소유자/버전 검사를 거쳐 실행한다.

완료/되돌리기의 native checkbox는 공통 `cw-check-control`/`cw-checkbox` 안에 있으며 공통 계층이 입력 크기·터치 영역과 선택·focus·disabled 테마를 소유한다. TODO 행은 완료 문구·보관 예정 시각과 드래그 배치만 소유하며 앱 CSS가 checkbox skin을 다시 정의하지 않는다.

자동 조회는 편집 중 보류하며 편집 시작의 항목/버전을 별도 보존한다. 명시적 재조회로 현재 항목이 바뀌거나 사라져도 초안은 남고 저장을 막는다. 이 화면은 아직 3방향 병합 UI가 아니라 현재 내용 안내와 수정 취소/재열기를 사용한다. 이탈 보호는 공통 라우터의 history와 navigation 양쪽에 연결하고 실제 문서 이탈은 beforeunload로 보호한다. 계정 범위 변경은 확인창을 닫고 이전 목록/늦은 응답을 적용하지 않으며, 실제 계정 ID가 바뀌면 개인 화면을 새로 생성해 다른 계정의 초안을 노출하지 않는다.

확인된 쓰기 성공과 후속 조회 실패를 분리하고 목록 재확인은 읽기만 수행한다. 충돌·권한 거부·불완전/통신 응답 뒤에는 명시적 최신 조회 전까지 재실행하지 않는다. 서버 소유자 전용 접근, 72시간 보관, 버전 및 정렬 목록 검증·DB 구조는 그대로다. 프런트엔드의 완료 확인은 서버의 원자적 비교/쓰기나 요청 멱등성 보장을 새로 제공하는 것이 아니며 기존 경쟁 구간은 유지된다. 다른 일정 폼과 상태 변경의 공통화는 별도로 남아 있다.

## 직원·프로젝트 표시와 선택 경계

`entity-display.js`의 `CompanyEntityDisplay`가 회사 ID 기반 사진/아이콘, 프로필 버전 갱신 및 이미지 오류 시 첫 글자 표시를 소유한다. 셸 계정 표시, Portal/Leave의 기존 ID 마커, 일정의 React `WorkspaceEntity`가 같은 렌더러를 사용한다. React는 빈 mount만 소유하며 별도 프로필 URL 조회·실패 상태를 복제하지 않는다. 이전 이미지의 지연 오류는 새 버전 이미지를 덮어쓰지 않는다.

이름은 표시 문자열이지 식별자가 아니다. Leave의 로컬 EmployeeId는 서버가 현재 조회자에게 허용한 `data-company-employee-map`으로만 CompanyUserId에 연결한다. 매핑이 없을 때 로컬 ID를 회사 ID로 추정하지 않는다. 선택창 사진의 회사 ID와 원래 폼에 저장할 option.value는 별개다.

검색형 단일 선택은 `data-company-picker`로 명시하며 필드명 추측에 의존하지 않는다. 공통 선택기는 기존 native option을 사용하고 초성 검색·키보드·선택 후 포커스 복원·이미지 갱신을 처리한다. 목록이 열려 있는 동안 옵션이 제거되거나 값/표시/회사 ID/비활성 상태가 바뀌면 오래된 항목 클릭을 거부한다. 계정·역할·서비스 범위 변경은 선택창을 닫으며 같은 계정의 사진 갱신은 검색어를 보존한다. native input/change와 form reset은 유지한다.

목록 조회·비공개 직원/프로젝트 인가·쓰기 검증은 각 서버의 책임이다. 공통 선택창은 새 API 목록을 조회하거나 오래된 업무 목록의 권한을 보증하지 않는다. 지급 내역처럼 값이 직원 ID가 아닌 선택창과 남은 직원/프로젝트 표시 위치는 추가 검토 대상이다.

Razor 다중 선택은 `entity-choices.js`의 명시적 checkbox group을 사용한다. 검색은 공통 초성 matcher를 쓰고 이미 선택한 행이 검색으로 숨겨져도 native 체크 상태·name/value·서버 보존용 hidden input을 바꾸지 않는다. 검색과 업무 수정 상태는 분리한다. 회사 계정 신규/수정의 참여 프로젝트와 조직 관리의 참여 직원/책임자가 같은 연결을 사용한다.

React의 `WorkspaceSuggestions`는 서버가 허용한 `{value,id,name,description,disabled}` 목록을 받아 초성 검색·프로필/아이콘·방향키·Enter·Escape·키보드 초점·빈 결과를 공통 처리한다. 한글 조합 중 Enter는 선택하지 않고, 후보를 8명으로 잘라 버리지 않는다. `value`는 선택 결과, `id`는 이미지 식별자이며 이름으로 서로 연결하지 않는다. 실제 업무 값의 저장과 후보 사용 자격은 소비자가 소유한다.

일정 멘션은 기존 `@[표시](직원ID)` 저장 형식을 유지한다. 편집 시 표시 이름 전체를 치환하지 않고 원래 토큰의 텍스트 위치를 추적한다. 멘션 안쪽을 직접 고치면 해당 토큰을 일반 텍스트로 풀며 다른 직원 토큰은 유지한다. 명시적으로 고른 직원만 새 ID 토큰을 만든다. 첨부 업로드와 댓글 전송은 각 공통 확인/전송 계약을 사용하되 알림 서버 처리와 인가는 변경하지 않는다.

## 페이지와 인증 경계

Portal Razor 연결은 `packages/workspace-ui/razor/WorkspacePages.cs`와 페이지 계약을 앱의 `Workspace/*.g.cs`로 생성한다. 기본 `_Layout`이 제목·현재 페이지·공통 메뉴 mount를 소유하고, 새 페이지는 본문만 정의한다. 등록마다 anonymous 또는 기존 서버 policy를 명시하며 메뉴 API도 같은 ASP.NET authorization policy로 허용된 페이지 ID만 반환한다. 클라이언트의 관리자 표시값으로 메뉴 권한을 추정하지 않는다. `/api/workspace/navigation`은 인증 필수·no-store이며 로그인 만료는 401로 응답한다. 조회 실패 시 허용 메뉴 링크를 제거하고 공통 오류 안내를 남긴다. 연결 오류·401·403·빈 결과를 구분하며 수동 재시도와 창 활성화/계정 컨텍스트 갱신 시 재조회한다. 실패를 이유로 본문을 지우거나 자동 로그인 이동을 하지 않는다.

## 공통 상태 UI

### 직원·프로젝트 연결의 추가 경계

공통 검색 선택창은 한글 IME 조합 중 Enter/방향키를 선택 명령으로 처리하지 않는다. composition 상태·`isComposing`·호환 keyCode 229를 확인하며, 조합 종료 후 일반 Enter로만 기존 select 값과 change 이벤트를 갱신한다. 이름 검색은 가능하지만 이름을 ID 연결의 근거로 사용하지 않는다.

일정 버전 기록의 `ReleaseIdentity`는 기존 Avatar/ProjectIcon을 소비한다. 변경자의 ID가 서버가 허용한 직원 목록에 있을 때만 사진 ID를 전달하며 비공개 표시는 해당 목록의 값을 따른다. 목록에 없는 과거 변경자는 사진 ID를 추정하지 않고 ‘이전 직원’으로 표시한다. 시트 이전 기록의 시스템 변경자(0)는 직원과 구분한다. 프로젝트 상세도 같은 아이콘 갱신 계약을 사용한다. 이는 표시 연결이며 버전 저장·충돌 처리·이력 공개 정책 자체의 변경은 아니다.

### 표 안의 상세 펼치기

`disclosure.js`의 `CompanyDisclosure.attach(root)`가 같은 불투명 키의 버튼과 패널을 연결한다. 패널의 native `hidden`, 여러 버튼의 `aria-expanded`/`aria-controls`, 선택적 열기/닫기 문구와 닫힌 본문 내부의 키보드 포커스를 공통 소유한다. 필드 DOM을 다시 만들거나 값·선택·버전·FormData를 지우지 않으며 데이터 조회/저장/인가를 수행하지 않는다. 상세 행은 표의 같은 form 안에 남고, `.cw-table-scroll`과 `.cw-table-detail`이 표 스크롤과 상세 폼의 표시 너비를 분리한다.

Portal 직원 일괄 편집이 첫 소비자다. 정보/공개 범위 버튼이 같은 패널을 제어하고 여러 직원을 함께 펼칠 수 있다. 검색으로 제외한 행은 공통 API로 닫아 버튼 상태도 갱신하되 작성 중인 변경사항은 유지한다. 비공개 직원의 노출 제한은 기존 서버 정책의 책임이며 상세를 접는 것은 접근 통제가 아니다.

옵션 `single:true`는 한 패널만 열리도록 한다. 동기 취소 이벤트/`beforeChange`가 전환 전체를 거부할 수 있으며 Promise를 승인으로 취급하지 않는다. DOM 교체 뒤에는 `refresh()`, 페이지 해제 시에는 `destroy()`를 호출한다. 키 중복/사라진 패널은 임의 연결하지 않는다.

React는 generated `useWorkspaceDisclosure`로 같은 컨트롤러를 소비한다. 본문은 React가 유지하고 초기 `hidden`만 지정하며, 이후 표시/ARIA/포커스는 공통 컨트롤러가 소유한다. hook은 커밋 후 바인딩을 갱신하고 루트 DOM 교체·StrictMode·해제 시 이전 리스너를 정리한다. 공통 렌더러가 없을 때 개별 구현으로 우회하지 않으며 `ready` 전에는 버튼을 비활성화한다. 읽기 조회에 필요한 열림 알림은 `onChange`로 전달한다.

일정 기본 버전의 마이너 목록, 버전 미기재 기록과 변경 이력 본문이 이 연결을 사용한다. 큰 표는 자체 스크롤을 유지하고 펼친 목록은 `.cw-table-detail`로 화면 폭 안에 표시한다. `useReleaseList`는 기본/마이너/미기재 목록의 전체 응답·프로젝트/버전·중복 ID를 검사하고 공통 상태로 로딩/오류/빈 결과를 구분한다. 일반 새로고침 실패에는 확인된 행을 유지하지만 인증/권한 거부와 계정 범위 변경은 이전 행을 제거한다. 명시적 재조회는 읽기만 수행하며 계정·프로젝트 변경/접기/해제 뒤의 오래된 응답은 적용하지 않는다. 저장 후 목록 실패는 편집기에 전달하여 저장을 반복시키지 않는다. 기존 읽기 API·페이지 크기·인가·DB는 유지한다.

CS 플레이어 데이터는 저장소·데이터 키를 결합한 불투명 키로 같은 컨트롤러를 사용한다. 각 행 아래에는 빈 패널만 두고 하나의 대용량 편집기 DOM을 열린 패널로 이동한다. 검색은 행을 다시 만들지 않으며 접기/검색 후 같은 키를 다시 열면 원문·초안·사유·확인 체크·커서·편집기 스크롤을 유지한다. 다른 키나 서버로 전환할 때는 기존 동기식 이탈 확인을 유지한다. 조회/저장 중에는 native fieldset으로 대상 변경과 편집을 잠그며 확인된 결과를 다시 연결할 때만 내부 복원 경로를 사용한다. 저장소별 편집 토큰·스냅샷, GZip 및 lossless JSON 처리는 앱의 기존 책임이다.

공통 표 스크롤 컨테이너는 내부 절대 위치 요소의 위치 기준도 소유한다. 접근성 레이블이 모바일 문서 바깥으로 빠져 전체 문서 너비를 늘리지 않게 하며, 큰 표 자체의 가로 스크롤은 유지한다.

### 회사 신규 계정 등록 수명주기

신규 등록도 기존 직원 편집과 같은 `AccountFields`/`AccountInput` 및 `_AccountField`를 사용한다. 빈 폼의 초기값과 서버 저장 응답은 동일한 `FormValues` 투영으로 생성한다. `account-create.js`는 업무별 정규화 확인만 소유하고 전송·잠금·오류 상태·요청 해제는 `CompanyForm`에 위임한다. 신규 계정 ID와 버전 ticks는 문자열로 전달한다.

Add handler는 계정·소속 프로젝트·연차 outbox를 기존 트랜잭션으로 저장한다. 정규화된 전체 필드와 프로젝트 관계를 같은 트랜잭션 안에서 캡처하고 commit 완료 후에만 `workspace-form-v1`의 saved를 반환한다. 클라이언트는 전체 필드, 정규화 규칙, 전송 당시 초안 및 현재 계정 범위를 확인한 다음 원자적으로 화면에 반영한다. 공용 계정의 소속 제외·기본 입사일, 마스터의 프로젝트 제외, 상품 배포 권한의 접근 권한 의존성을 검증한다. 메뉴/클라이언트 검사는 서버 인가와 antiforgery를 대체하지 않는다.

명확한 입력 거부(422 invalid)만 같은 화면에서 수정 후 재전송할 수 있다. 권한 변경·통신/서버 오류·불완전 성공 응답은 등록 여부 미확정으로 취급해 초안을 유지하고 중복 등록을 잠근다. 클라이언트 abort가 서버 롤백을 의미하지 않는다. 확인된 성공 이후에도 기존 직원 일괄 편집 초안을 보존하기 위해 페이지를 자동 새로고침하지 않는다. 새 계정이 반영되지 않은 목록/현황임을 명시하고 새 탭에서 확인하도록 한다. ‘다른 계정 등록’은 확인된 성공 이후 신규 폼만 공통 초기값으로 되돌린다. 이전 등록 안내도 함께 초기화하며 업무 입력을 localStorage에 저장하지 않는다.

기존 HTML POST의 redirect/error-page 호환은 유지한다. HTML 실패는 위의 원문 보관/복원 정책을 적용하며 레거시 단건 Update의 공통 전송·저장 확인 연결까지 완료된 것은 아니다.

### CS 플레이어 데이터 변경 수명주기

조회/설정/검색 빈 결과도 `CompanyState`를 사용한다. 마지막 토스트 소비자 전환 후 CS의 개별 토스트 구현과 스타일을 제거했다. 조회는 기존 세 저장소 전체 응답과 별도 설정 계약을 검증한 뒤 한 번에 반영하며, 조회 중 입력/초안 변경·계정 범위 변경·해제 뒤 응답은 적용하지 않는다. 일시적 실패와 권한 거부는 빈 결과가 아니고 기존 초안을 보존하지만 새 조회 성공 전에는 기존 토큰으로 쓰지 않는다. 명시적 재조회가 초안을 버릴 때는 기존 동기식 이탈 확인을 유지한다.

공통 상태의 재확인 액션은 읽기만 실행한다. 요청 관찰은 AbortSignal과 독립적인 Promise 경계로 종료하여 취소를 무시하는 fetch/JSON도 UI를 계속 잠그지 않는다. 늦은 JSON의 401 안내도 현재 범위 검증 후에만 처리하며, 이전 요청의 종료가 새로운 조회의 잠금을 풀지 않는다. non-persisted pagehide는 요청·확인창·관찰자를 해제한다. 편집기 canvas 수정 강조도 의미별 색상 토큰을 읽고 테마 변경 시 다시 그린다. 이는 기존 GZip·정수 원문·저장소별 토큰·서버 감사/인가 정책을 바꾸지 않는다.

플레이어 데이터 저장은 `CompanyDialog.confirm`, 추가/삭제의 도메인 입력 양식은 `CompanyDialog.present`와 `.cw-dialog-form`을 사용한다. 입력 양식의 키·값·사유·검증은 CS가 소유하고 모달 프레임·테마·키보드·포커스는 공통 소유한다. `canCancel`은 이미 전송 중인 양식에서 사용자 Escape만 잠글 수 있으며 계정 범위 변경·AbortSignal·외부 close는 항상 창을 해제한다. 창 닫힘을 서버 요청 취소나 롤백으로 간주하지 않는다.

세 작업의 명시적 확인 checkbox도 `cw-check-control`/`cw-checkbox`를 사용한다. 공통 계층이 선택·hover·focus와 입력 크기를 소유하고 앱은 긴 대상 문구의 줄바꿈만 소유한다. 실제 checked 값이 버튼 활성화와 `confirmed` 요청 필드에 연결되는 업무 검증은 그대로다.

상품 명령의 Dry Run과 병합 승인도 같은 공통 checkbox를 소비한다. CS 공통 레거시 `.confirm-check` skin은 제거하고 상품·플레이어 화면에는 긴 문구 정렬과 간격만 남긴다. 읽기 전용 환경의 Dry Run 강제와 미리보기 이후 값/DataVersion 변경 시 병합 승인 무효화는 상품 도메인 수명주기가 계속 소유한다.

로그 검색의 장기 범위 실행 확인도 같은 공통 checkbox를 소비한다. 앱은 장기 검색 안내의 제목·본문 배치만 소유하고 선택/비선택·focus·두 테마 색은 공통 계층을 따른다. 24시간 초과 판정, 확인 전 요청 차단과 `confirmLongRange` 서버 검증은 로그 검색 수명주기를 변경하지 않는다.

CS 플레이어 데이터의 회사/PlayFab 설정과 세 저장소 전체 조회는 `CompanyReadSession`의 고정 채널을 사용하고, save/add/delete는 별도 변경 허용 목록을 사용한다. 두 경계는 하나의 checked JSON transport를 공유하되 조회 취소를 서버 변경 취소로 해석하지 않는다. `runMutation`은 확인 시 대상·토큰·초안·환경·계정 범위를 고정하고 명시적 쓰기를 한 번 실행한다. 기존 API 응답의 서버/UID/저장소/키/버전/바이트 수와 저장 원문·새 토큰을 `player-data-contract.js`에서 검증한 뒤 편집 기준을 바꾼다. JSON 원문을 숫자 객체로 변환하지 않는다. 401/403/409와 불완전 응답·HTML·통신 실패를 구분하며 미확정 결과를 성공 또는 롤백으로 단정하지 않는다. 미확정/충돌 뒤에는 새 조회 전까지 기존 토큰으로 반복 저장하지 못하게 한다. 상세 경계는 `cs-player-data-reads.md`를 따른다.

추가/삭제의 확인된 성공과 목록 읽기는 분리한다. 읽기만 실패하면 공통 성공 상태에 목록 재확인 버튼을 제공하며 이 버튼은 조회만 수행한다. 그 사이 다른 초안을 작성했다면 조회 적용 전에 폐기 확인을 받는다. 계정 변경 뒤의 이전 응답은 적용하지 않고, 기존 초안을 보존한 채 새 조회를 요구한다. 이 화면에서 확인한 클라이언트 계정 범위는 서버 인가를 대체하지 않으며 기존 PlayFab 쓰기 설정·편집 토큰·재조회/경쟁 구간·감사 정책은 그대로다. 다른 CS 작업 및 모든 서비스 폼 수명주기 전환의 완료를 뜻하지 않는다.

`states.js`의 `CompanyState`가 loading/empty/error/denied/success 상태의 텍스트·아이콘·접근성·액션을 렌더링한다. Razor/정적 HTML은 선언형 data 속성 또는 명시적 render를 사용하고 React는 generated `WorkspaceState` 연결을 사용한다. 셸의 재로그인 안내도 같은 렌더러를 사용한다. 스타일은 의미별 토큰을 소비하는 `primitives.css`가 소유한다.

같은 원본의 `CompanyToast`는 입력 오류·조회 완료·복사 완료 같은 일시적 결과를 우측 상단 공통 스택으로 표시한다. 안정된 ID의 중복 알림은 최신 내용으로 교체하고 성공은 기본 5초 뒤 닫으며 오류·권한 문제는 직접 닫는다. 로딩, 실제 쓰기 결과, 일부 실패, 처리 여부 미확정과 복구 동작은 토스트로 축약하지 않고 인라인 `CompanyState`가 소유한다. 필드 오류의 위치·연결·포커스는 각 업무 화면이 소유하되 공통 오류 스타일과 토스트를 소비한다.

상태 컴포넌트는 데이터 조회·업무 저장·권한 판정을 소유하지 않는다. 재시도 콜백은 소비자가 제공하며 쓰기 요청을 자동 재실행하지 않는다. 서버 메뉴 재조회는 계정/역할/서비스 변경 시 캐시를 폐기하고 이전 요청의 늦은 응답을 무시한다. 모바일 상태 버튼 동작은 drawer를 닫지 않으며 메뉴 상태 전환 동안 키보드 포커스를 보존한다. 계정 폼 본문은 메뉴 렌더러의 소유가 아니다.

새 페이지 생성기는 공통 empty 상태를 기본 본문으로 포함한다. 이것은 준비 중인 화면임을 명시하는 기본값이며 실제 기능이나 데이터 연결의 완료를 뜻하지 않는다. 시트의 초기화·조회 오류·비교 대기·빈 스냅샷·쓰기 오류에 공통 컴포넌트를 적용했다. 나머지 앱의 개별 업무 상태와 확인/결과 대화상자 전환은 계속 남아 있다.

부서/프로젝트는 기존 `/Admin/Organization?tab=projects` 및 편집 `id` 쿼리를 유지한다. 동일 Razor 페이지의 query variant는 서버 policy를 달리할 수 없다. Google 로그인·로그아웃·SSO 전달은 일반 본문 페이지가 아닌 기존 기술 엔드포인트로 사유를 명시한 목록에 남는다. 이 예외를 새 업무 페이지 생성의 우회로로 사용하지 않는다. 별도 `@page` 경로·제목·페이지 인증 선언, 독립 레이아웃, 미등록 페이지는 검사에서 거부한다. 기존 handler의 업무 데이터 인가와 antiforgery는 유지한다.

Leave도 같은 C# adapter를 소비하며 실제 EmployeeId와 로컬 Admin/Master 정책을 사용한다. 회사 admin/master가 Leave Master로 투영되는 기존 SSO 규칙은 바꾸지 않는다. 루트·신청·달력 호환 리디렉션과 Discord/SSO 기술 엔드포인트는 기존 동작을 보존한다. 메뉴 API도 기존 중앙 세션 검사 뒤에 실행되며 활성 계정·서비스 권한·세션 폐기·인증 서버 장애 검증을 우회하지 않는다. 내부 세션 HTTP 연결은 named HttpClient로 주입하되 기존 5초 제한, 리디렉션 금지, HMAC 및 Host를 유지한다.

공통 메뉴 배지는 페이지의 `badge:true`와 `IWorkspaceNavigationBadges`로 연결한다. Leave 공급자는 승인 메뉴에 접근할 수 있는 사용자에게만 승인/취소 승인 대기 합계를 반환한다. 본문의 기존 대기열 폴링은 `CompanyNavigation.setBadge(service, pageId, count)`로 갱신하며 HTML을 직접 복제하지 않는다. 0건 숨김, 99+ 표시, 실제 건수 접근성 이름과 메뉴 포커스 보존을 공통 렌더러가 관리한다.

일정 React는 주간/칸반/개인 TODO/버전 기록/관리/업무 상세를 계약에 등록한다. `/tasks/:id`는 기존 상세·댓글 URL을 유지하고 서버에는 양수 long 경로로 생성한다. 일정에 진입한 활성 개인 계정은 관리 메뉴의 `schedule.manage` capability를 받아 주요 일정을 생성·수정할 수 있다. 보관함과 주요 일정 삭제는 서버가 관리자·책임자 권한을 별도로 확인한다. capability는 메뉴 정책이지 API 인가 수단이 아니다.

공통 React 라우터의 `useWorkspaceNavigationGuard`는 페이지 상태를 바꾸기 전에 취소 가능한 전환 이벤트를 확인한다. 일정 관리·업무 편집의 초안 보호는 window popstate 리스너의 실행 순서에 의존하지 않는다. 취소하면 마지막 승인 URL(쿼리·fragment 포함)과 본문 상태를 유지한다. 브라우저 문서 이동은 기존 beforeunload 보호를 병행한다.

Portal이 계정·권한·프로필의 원본이다. 서비스 진입 권한은 각 백엔드가 현재 세션을 검증한다. 셸의 메뉴 필터는 접근 통제가 아니다. 비공개 직원/프로젝트는 API가 조회자 기준으로 필터링하며 공용 UI는 그 결과만 표시한다. Leave 데이터와 회사 사용자 ID 연결, DB 볼륨, SSO issuer/audience, 기존 URL은 보존한다.

IAP 상품 관리는 `apps/iap`의 정식 워크스페이스 서비스다. 원본 `product-upload` Git 이력을 보존하고 공용 페이지·권한·내비게이션 계약, 7개 서비스 CI 이미지 matrix 및 GHCR 게시 후보에 포함한다. PostgreSQL의 기존 `product-upload_iap-db` 볼륨, App Store 심사 이미지용 `product-upload_iap-review-assets` 볼륨과 모노레포 밖 connector 비밀 디렉터리는 Compose에서 이름과 경로를 명시해 소스 디렉터리 이동과 분리한다. 심사 이미지 파일은 서버 발급 ID로만 참조하고 파일 메타데이터는 PostgreSQL에 불변 기록으로 보관한다.

## 검증과 배포 경계

CS 상품 지급·회수의 실행·실패 UID 재시도·대기 명령 삭제는 `CompanyDialog.confirm`을 사용한다. 기존 미리보기 토큰·UID별 요청 ID·병합 승인·DataVersion 스냅샷은 앱의 도메인 계약이며 공통 UI가 재발급하거나 변경하지 않는다. 설정·미리보기·명령 조회는 `CompanyReadSession`의 고정 채널, 실행·삭제는 별도 변경 허용 목록을 사용하고 하나의 checked JSON transport를 공유한다. 모든 응답을 `product-command-contract.js`로 검증한 뒤 표시하며, 확인 중 입력과 계정 범위가 바뀌면 기존 의도로 쓰지 않는다. 실패 UID 재시도는 최초 토큰/요청 ID 및 직전 실행 모드를 사용하며 현재 Dry Run 체크 변경으로 모드가 바뀌지 않는다. 상세 경계는 `cs-product-command-reads.md`를 따른다.

상품 실행/조회 결과는 `CompanyState`, 표/결과 상태는 공통 프레임·의미 토큰을 사용한다. 실제 쓰기 응답이 미확정이면 초안을 유지하고 현재 문서의 추가 쓰기·새 요청 ID 발급을 잠그며 명령 조회만 허용한다. 확인된 삭제와 이후 조회 장애는 분리하고 후속 버튼은 조회만 재시도한다. 명령 등록 성공은 게임 내 지급·회수 완료가 아니다. 브라우저 관찰 중단은 서버 롤백이 아니며 기존 서버의 재조회/프로세스 잠금/PlayFab 재시도 정책·인가·감사 기록은 변경하지 않았다. 서버 읽기-쓰기 사이의 기존 경쟁 구간이나 재시작 이후 영구 멱등성을 새로 보장하는 전환은 아니다.

CS Steam 환불은 `CompanyDialog.confirm`과 `CompanyState`를 사용하며 `steam-transaction-contract.js`가 64비트 문자열 ID·설정·조회·환불 응답을 검증한다. 페이지는 확인 전 설정/거래를 다시 읽고 주문·Steam ID·사유·환경을 캡처한 뒤 확인 직후에도 입력과 계정 범위를 검증한다. 기존 JSON API의 비즈니스 흐름을 native POST 공통 폼으로 대체하지 않는다. `steam-transaction-api.js`는 기존 서버 핸들러를 추출한 도메인 경계로, 서버의 SSO·CSRF·Origin·속도 제한과 별개로 거래 재검증·프로세스 내 주문 잠금·시도/결과 감사 기록을 유지한다.

환불 응답 확인과 후속 거래 조회는 별도 결과다. 완료 응답을 확인한 뒤 조회가 실패해도 환불을 실패로 표시하거나 재전송하지 않는다. 불완전/통신 오류는 미확정으로 유지하고 사유를 보존하며 같은 문서·환경·주문의 반복 환불을 잠근다. 상태 재확인은 읽기만 수행하고 잠금을 해제하지 않는다. 이 메모리 기록은 영구 멱등성·새 탭/재시작 중복 방지 보장이 아니며 서버/Steam/감사 기록 확인이 필요하다. 계정 변경은 개인정보를 제거하고, 관찰 timeout·페이지 해제·늦은 응답을 서버 환불 롤백으로 설명하지 않는다. 다른 주문으로 이동할 때 기존 환불 초안을 지우려면 공통 확인이 필요하다.

CS 로그 검색도 `CompanyState`와 `CompanyDisclosure`를 소비한다. 앱의 `log-search-contract.js`가 현재 작업 ID·라이브 Title·결과/진행 구조 및 알고 있는 검색 조건을 검사하고, 확인된 응답만 화면·CSV에 반영한다. 검색 실행 자체는 기존 비동기 job API의 책임이며 공통 폼 전송기로 위장하지 않는다. 회사 사용자별 탭 저장소에는 작업 ID만 남기고 상태 조회 오류 뒤의 명시적 재확인은 읽기만 수행한다. 401/403·계정 범위 변경은 기존 결과를 제거하며, 페이지 해제와 늦은 취소/조회 응답은 현재 작업 식별자로 배제한다. 시작 결과 미확정은 반복 실행을 잠그고 자동 POST 재시도를 하지 않는다. 상세의 lossless JSON·검색 비용/취소/부분 결과 의미는 CS가 소유하며 서버 인가·큐·기간 정책은 그대로다.

`tooling/verification-policy.json`이 필수 CI job·명령·서비스 matrix를 정의하고 `tooling/verification-gate.mjs`가 워크플로와 실행 결과를 대조한다. 집계는 웹·서버 검증 일곱 영역과 Android 검증을 합친 정확한 여덟 dependency의 `success`만 받아들이며 비어 있거나 빠진 결과를 통과시키지 않는다. 제한된 워크플로 형식 검사와 변이 테스트는 실수 방지 장치이며 임의 정책 변경이나 모든 우회를 막는 보안 경계가 아니다.

성공 artifact는 commit/tree, run/attempt, workflow와 정책 해시를 묶은 CI 기록이다. images matrix는 별도 artifact에 서비스, 같은 commit/tree/run, 검증 태그, content-addressed 로컬 image ID, 플랫폼과 존재하는 registry digest를 기록한다. 두 기록 모두 운영 승인·이미지 출처 서명은 아니며 PR merge commit 검사를 main 배포에 재사용하지 않는다. 아직 이미지를 registry에 게시하지 않으므로 이 로컬 image ID 기록만으로 운영 이미지 게시/승격이 연결됐다고 보지 않는다. 원격 필수 check 설정과 배포 실행 권한도 별도로 확정해야 한다. 구체적인 데이터 mount 보존·백업·롤백 및 미완료 사항은 `docs/DEPLOYMENT.md`를 따른다.

`tooling/deployment-preflight.mjs`는 등록된 모든 서비스의 실제 Docker 식별자와 독립 Compose 후보의 mount/포트/네트워크·이미지 고정을 읽기 전용으로 대조한다. UI 서비스 ID와 Compose 서비스명은 다른 계약이며 두 목록의 누락은 테스트로 검출한다. 동적 기본 프로젝트명이나 새 checkout의 상대 bind를 운영에 자동 적용하지 않는다. 전체 환경/health 로그를 출력하지 않으며 사전 검사 성공도 배포 승인으로 반환하지 않는다. 게시 이미지/신뢰된 CI/백업·권한 검증 및 실제 전환/롤백은 별도로 남는다.

`tooling/deployment-candidate.mjs`는 완료된 `workspace-image-publication-set-v1`의 저장소·commit/tree·실행 ID와 등록된 모든 GHCR repository digest를 다시 검증하고 서비스별 digest-only Compose override를 새 디렉터리에 생성한다. 기존 Compose가 데이터 mount·포트·network·환경·command를 계속 소유하며 후보 생성기는 Docker·registry·운영 설정을 조회하거나 실행하지 않는다. 후보 manifest는 입력 원문과 각 override의 SHA-256을 기록하지만 `deploymentApproved:false`를 유지한다. 기본 Compose의 build 정의가 함께 해석되므로 실제 전환에는 게시 digest 선행 pull과 build 금지를 강제하는 별도 승인 실행 경계가 필요하다. 상세는 `packages/contracts/deployment-candidate.md`다.

### Leave 알림 센터의 공통 폼 경계

알림 센터의 native POST는 `CompanyForm`을 사용하며 `CompanyState`가 빈 목록·저장 중·완료·실패·권한 변경 상태를 소유한다. 알림 저장소와 소유권 검증은 Leave에 남는다. enhanced 응답은 `workspace-form-v1`의 작업명·문자열 직원/알림 ID·로컬 이동 경로를 전체 검증한 뒤 동기적으로 반영한다. 새 폼은 화면의 `expectedEmployeeId`를 제출하고 서버 현재 직원과 대조한다. 이 값은 인가가 아니며 기존 중앙 세션/현재 직원의 알림 소유권을 별도로 확인한다. 값 없는 기존 native POST와 GET Open URL은 호환 경로로 유지한다.

미확정 응답은 임의의 읽음 표시나 자동 쓰기 재시도로 바꾸지 않는다. 계정 변경은 이전 목록을 제거하며 timeout/해제 뒤 늦은 응답을 배제한다. 읽음 완료 이후 상단 알림 갱신 실패는 저장 실패와 구분한다. 목록 재확인은 GET이며, 최근 120개와 전체 미읽음 수는 서로 다른 값이다. 원본 DB·내부 알림 수집/읽음 API·Discord·연차 승인 업무는 변경하지 않는다.

### Leave Discord 개인 알림 설정

Discord 수신 설정 저장·연동 해제·테스트 DM은 native 양식과 CSRF를 유지하며 `CompanyForm`/`CompanyState`를 사용한다. 연동 해제와 초안을 버리는 OAuth 이동은 `CompanyDialog.confirm`으로 의도를 확인한다. OAuth Link만 외부 redirect와 correlation cookie가 필요한 native POST로 남기며 일반 저장 성공 응답으로 위장하지 않는다. OAuth callback·토큰 교환·봇 전송·카탈로그/역할별 수신 허용 정책은 기존 서버의 책임이다.

화면은 문자열 직원/Discord ID 및 설정 fingerprint를 보내고 서버 현재 값과 대조한다. 이 fingerprint는 연동 ID·표시명·연동일·수신 설정·역할의 스냅샷이며 인증 토큰이나 DB의 원자적 경쟁 제어가 아니다. 기존 값 없는 native POST는 호환되지만 enhanced 요청은 화면 계정/설정 값이 필수다. 서버의 현재 직원·세션·CSRF 검증과 별도로 적용하며 기존 읽기-쓰기 사이의 경쟁 구간이나 영구 멱등성을 새로 해결했다고 주장하지 않는다.

전체 응답의 작업·현재 계정·설정·문자열 ID를 확인한 후 저장/해제 결과를 반영한다. 테스트 DM은 편집 중인 수신 설정을 저장하거나 지우지 않는다. Discord 요청 수락과 사용자의 실제 수신은 구분한다. 실패/미확정은 초안을 보존하고 자동 재전송 없이 현재 설정과 수신 여부를 확인하게 한다. 계정 범위 변경은 이전 연결 정보를 지우고 확인창을 닫으며, timeout/해제 뒤 늦은 JSON은 적용하지 않는다. 일반 문서 이탈은 기존 브라우저 beforeunload 의미를 유지한다.

## 연차 감사 조회의 공통 UI

감사 화면의 일반 입력·표·한 행 상세는 공통 primitive와 `CompanyDisclosure`를 사용한다. `audit-logs.js`는 기존 GET의 요청별 관찰/취소·현재 직원/검색 조건 대조와 공통 오류·권한 상태를 연결한다. 일시 실패에는 정상 목록을 유지하되 계정 변경에는 이전 본문을 지우고 늦은 응답을 배제한다. 서버 관리자 인가·감사 데이터/필터 정책과 인코딩된 원문은 유지한다. 상세 계약과 native fallback은 `packages/contracts/leave-audit.md`를 따른다.

## 시트 실행 경계

시트의 조회는 `api.ts`와 `WorkspaceReadSession`, 실제 마이그레이션/한국어 갱신 POST는 `useSheetActions`와 generated `CompanyForm` transport가 각각 소유한다. 설정의 actor와 분석/미리보기 기준은 쓰기 헤더로 보내고 서버 세션·본문과 대조한다. 서버는 `workspace-form-v1` 영수증을 반환하고 `sheetWrites.ts`가 전송 본문·분석/미리보기·문서·전체 결과를 대조한다. 성공 후 데이터 재확인은 POST와 분리된 `after-write` read 채널을 사용하며 자세한 한계는 `packages/contracts/sheet-writes.md`를 따른다.

## Portal 직원 충돌 비교 조회

직원 일괄 저장 충돌 뒤 최신 계정·선택지·지표를 읽는 GET은 `CompanyReadSession`의 `account-review` 채널이 관찰한다. Portal은 요청 계정과 전체 응답·64비트 버전·현재 초안을 검증한 뒤 공통 3-way 비교에 전달한다. 계정 변경과 페이지 이탈은 읽기를 취소하며 늦은 응답은 직원 기준값이나 동적 프로젝트 선택지를 갱신할 수 없다. 저장 POST와 HTML/native 복구는 기존 독립 경계를 유지한다.
## Schedule 목표와 상세 계획

Schedule는 업무의 상위 묶음인 `WorkGoals`, 업무 내부의 날짜별 `TaskScheduleItems`, 공동 체크리스트인 `SharedTaskTodos`를 자체 SQLite에 소유한다. Portal 디렉터리와 프로젝트 접근 범위를 매 요청 확인하며 목표·상세 계획 데이터는 다른 서비스 DB에 복제하지 않는다. 일반 보드 GET은 계획 목록을 생략하고 `내 일정`과 업무 상세만 명시적으로 함께 읽는다. 모든 쓰기는 공통 폼 envelope와 actor/CSRF/행 버전을 확인하고 기존 `ChangeLog` 및 버전 이력에 작업자를 남긴다. 상세 계약은 `packages/contracts/schedule-work-planning.md`다.
