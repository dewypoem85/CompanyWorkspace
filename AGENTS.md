# Company Workspace 작업 규칙

## 먼저 읽기

- 변경 전 `docs/ARCHITECTURE.md`, `docs/MIGRATION.md`와 대상 앱의 추가 지침을 읽는다.
- `apps/leave` 작업은 해당 앱 `AGENTS.md`와 `docs/PROJECT_CONTEXT.md`도 먼저 읽는다.
- 여섯 앱은 하나의 제품이지만 DB, 인증 검증, 업무 처리, 실행 및 배포 경계는 분리한다.

## 공통 UI 소유권

- 새 페이지·업무 컴포넌트에 raw `fetch`를 추가하지 않는다. `network-boundaries.md`의 공통 읽기/쓰기 또는 검토된 단일 앱 transport를 사용한다. `network-boundaries.json`은 dot/computed/indirect 호출을 포함한 현재 소유 파일·개수를 봉인하므로 새 페이지를 예외로 등록하거나 표기만 바꿔 우회하거나 기존 파일에 호출을 늘리지 않는다.
- 새 페이지에 native `<form method="post">`를 바로 추가하지 않는다. `native-post-boundaries.md`와 해당 소비자 쓰기 계약을 먼저 연결한다. `native-post-boundaries.json` v2의 각 폼 identity는 범용 목록 문서가 아닌 구체 계약을 가리켜야 하며, 페이지를 예외처럼 등록하거나 같은 수 안에서 handler/action/id를 바꿔 우회하지 않는다. GET 필터는 `automatic-navigation.md`를 따른다.

- 값 변경 즉시 목록을 다시 여는 GET 필터는 inline `onchange`/`form.submit()`을 만들지 않고 `automatic-navigation.md`의 `data-cw-auto-submit`을 사용한다. 쓰기 폼이나 초안 확인이 필요한 이동에는 적용하지 않는다.

- 읽기 전용 상태·분류·환경 표시는 의미에 맞는 `cw-state-pill`과 `data-tone`을 사용한다. 앱은 판정·문구·조건부 노출만 소유하고 padding·글자 크기·모서리·라이트/다크 팔레트를 복제하지 않는다.

- 비동기 owned modal 닫기는 `owned-modals.md`의 `beforeCloseRequest`/`requestCloseAsync`를 사용한다. hook은 적용 직전 초안 재검증 함수를 반환하고 `canClose`는 동기 잠금을 유지한다. 승인 전 DOM을 제거하지 않으며 scope/해제·외부 close·중첩 창·포커스를 검증한다. 닫기 확인 중 상태를 저장 중으로 표시하지 않는다. 라우팅 초안 보호는 `useWorkspaceNavigationRequest`를 사용한다.

- 초안 폐기 확인과 상세 키 전환은 `draft-transitions.md`를 따른다. `beforeChange`에 Promise를 반환하지 않고 공통 `beforeRequest`/`requestOpen`을 사용한다. 승인 후에도 실제 초안/대상과 노드를 대조하며 직접 동기 전환은 초안 보호를 우회하지 않아야 한다. CS 원문·서버 선택·추가/삭제 창의 원래 포커스와 native beforeunload를 보존한다. 일정 버전 편집의 닫기·메뉴·뒤로/앞으로 이동은 같은 현재성 검증을 사용한다.

- 개인 TODO 완료 checkbox도 `schedule-record-controls.md`의 `cw-check-control`/`cw-checkbox`를 사용한다. 완료 API와 행 상태는 일정 앱이 소유하지만 입력 크기·클릭 영역·선택·focus·disabled 테마를 앱 CSS에서 복제하지 않는다.

- Portal 신규/기존 직원의 비공개·일반 권한 카드와 조직의 비공개/보관은 `portal-controls.md`의 공통 checkbox를 사용한다. 검색형 프로젝트·직원 다중 선택은 정적 `cw-choice-group`을 사용하며 앱의 `organization-check`/`option-card`가 크기·색·focus를 다시 소유하지 않는다. 기존 직원 표의 compact 권한은 `cw-switch-control`/`cw-switch`/`cw-switch-track`을 사용하고 Portal은 표 정렬과 업무 문구만 소유한다. 읽기 전용 계정 유형·활성/비활성·기본/전체 권한과 공용 계정의 연차 제외 결과는 의미에 맞는 `cw-state-pill` tone을 사용하며 앱별 pill 크기·팔레트를 만들지 않는다.

- 정적인 업무 제약/저장 형식 안내는 `static-guidance.md`의 `cw-callout`을 사용한다. 의미 tone·제목/본문·inline code를 보존하고 개별 밝은 글자색을 복제하지 않는다. 정적 note를 live 성공/실패 상태로 초기화하지 않으며 실제 요청 수명주기와 구분한다. 두 테마 대비·긴 문자열·모바일/native 렌더링을 검증한다.

- 모바일 카드형 업무 표는 `responsive-tables.md`의 명시적 cards/key-value 변형을 사용한다. 실제 header scope·서버 레이블·값 wrapper를 함께 연결하며 긴 제목/값·native 폼·테마를 검증한다. 앱별 모바일 레이블 주입·표 skin을 복제하지 않는다. 달력/상세 표에 일괄 적용하지 않는다.

- 연차 달력/날짜 상세의 직원 표시는 `leave-calendar-entities.md`를 따른다. 로컬→회사 ID 매핑의 양쪽을 문자열로 직렬화하고 기존 공통 프로필 렌더러를 소비한다. 이름과 상태를 구분 문자로 합치지 않으며 갱신·외부 일정 본인 보기도 실제 허용 직원 필터를 통과해야 한다.

- 연차 신청/날짜 상세·목록 취소·조회 필드는 `leave-dashboard-controls.md`의 공통 native primitive를 사용한다. 동적 버튼까지 실제 variant/disabled를 연결하고 기존 필드 이름·원문·CSRF·직원 검색/저장 수명주기를 보존한다. 개별 입력 skin과 disabled 색을 복원하지 않는다.
- 연차 달력의 `SelfOnly`/`ShowOthers`는 `leave-calendar-preferences.md`의 서버 렌더링/hidden fallback과 `cw-check-control`/`cw-checkbox`를 함께 유지한다. Leave 전용 선택·hover·focus·다크 색을 다시 만들지 않는다.

- 연차 날짜 상세는 `leave-day-detail.md`의 native 공통 팝업과 같은 Razor 폼 노드를 유지한다. 세 저장 어댑터의 승인 후 숨김은 `LeaveDayDetail.close`로만 연결하며 직접 class/aria-hidden을 복원하지 않는다. 날짜 키보드 진입·복귀·중첩 확인·scope/노드 교체 해제·기존 초안을 검증한다.

- 지속 편집/선택 dialog는 `owned-modals.md`의 `CompanyDialog.attach`/generated `useWorkspaceModal` 및 `.cw-modal`을 사용한다. React DOM을 재부모화/삭제하거나 JSX open·개별 showModal/close/onCancel 수명주기를 중복하지 않는다. retain/dismiss 범위 정책·동기 초안/전송 가드·portal 부모 해제·포커스를 유지한다. 클래스만 추가한 것으로 공통 연결 완료를 주장하지 않는다. 프레임/런타임 변경은 여섯 앱 회귀 대상이다.

- 일정 업무 신규/수정·상태 JSON 저장은 `schedule-task-writes.md`의 공통 envelope·현재 계정·전체 본문/첨부 기준값을 사용한다. TaskPanel은 `useTaskWrites`와 generated 공통 JSON 전송/확인/문서 세션을 소비하며 private fetch를 복원하지 않는다. 전체 ACK 전 초안을 비우지 않고 저장 후 조회 실패는 GET만 재시도한다. 전송 직전 markSent, unknown의 SPA 재열기 잠금, 확인 중 최신 상세 관찰과 원래 계정의 미전송 범위 복구를 보존한다. 서버는 트랜잭션 안에서 실제 ACK를 고정하고 커밋 후 반환하며 첫 쓰기 뒤 오류를 롤백으로 단정하지 않는다. 댓글·업로드의 독립 계약과 세션을 합치지 않는다.

- 일정 새 댓글·답글·수정은 `schedule-comment-writes.md`의 actor·업무/댓글/답글/첨부 기준값, 공통 확인·JSON transport·문서 lease와 전체 댓글/첨부 ACK를 사용한다. `CommentComposer`나 `TaskPanel`에 raw POST/PUT를 복원하지 않는다. 연속 댓글/답글을 허용하되 오래된 thread 기준은 거부하고, 미전송 scope 변경만 같은 actor의 검증된 조회로 복구한다. ACK 전 초안을 비우거나 성공 뒤 GET 실패로 재전송하지 않으며 sent/unknown은 같은 문서에서 다시 보내지 않는다. 레거시 단일 Comment 응답과 서버 작성자·버전·멘션 정책을 유지한다.

- 일정 주요 일정 생성·수정·삭제는 `schedule-milestone-writes.md`의 actor·전체 생성 목록/대상 행 기준값, 공통 확인·JSON transport·문서 lease와 전체 Milestone ACK를 사용한다. `Settings`에 raw POST/PUT/DELETE를 복원하지 않는다. 서버는 기준 읽기부터 ACK 캡처까지 트랜잭션에 두고 커밋 뒤 반환한다. 확인 전·사전 충돌은 쓰지 않고, ACK 전 초안을 버리거나 저장 뒤 GET 실패로 재전송하지 않으며 sent/unknown은 같은 문서에서 다시 보내지 않는다. 일반 직원 배열 조회와 레거시 단일 Milestone/204 응답을 유지한다.

- 일정 업무 보관·복원·댓글 삭제는 `schedule-task-actions.md`의 actor·업무/대상 댓글·첨부 기준값, 공통 확인·JSON transport·문서 lease와 전체 Task/삭제 Comment ACK를 사용한다. TaskPanel/useTaskActions에 raw POST/DELETE를 복원하지 않는다. 서버는 기준 읽기부터 감사·변경·ACK 캡처까지 트랜잭션에 두고 커밋 뒤 반환한다. 확인 전·사전 충돌은 쓰지 않고, 성공 뒤 GET 실패는 읽기만 재시도하며 sent/unknown은 같은 문서에서 다시 보내지 않는다. 레거시 Task/204 응답과 답글·감사 보존 정책을 유지한다.

- 일정 본문·댓글 이미지 업로드는 `schedule-image-uploads.md`의 공통 multipart 전송·계정 재확인·파일 SHA-256·전체 첨부 ACK와 문서 세션을 사용한다. 선택/붙여넣기/드롭을 raw `api('/api/images')`로 복원하지 않는다. 확인 중 첨부/계정 변경과 동시 선택을 차단하고 전송 중 편집기·바깥 저장을 잠근다. 첫 파일 쓰기 뒤 오류와 abort를 롤백으로 안내하거나 같은 파일을 자동 재전송하지 않는다. 기존 단일 Attachment 응답과 임시 파일 정리/최종 연결 정책은 유지한다.

- 일정 업무 상세의 초기/폴링·업무/댓글 충돌 비교·보관/복원/댓글 삭제 전후 GET은 `useTaskDetail`과 `schedule-detail-reads.md`를 사용한다. 전체 대상·댓글/첨부/이력 및 버전 후퇴를 검증하고 오류를 자동 폴링으로 숨기지 않는다. 초안과 마지막 정상값은 유지하며 계정/권한 재확인은 원래 소유자만 복구한다. 확인창 중 최신 상태 관찰을 멈추거나 GET을 쓰기 재실행으로 바꾸지 않는다. 이미지·업무·댓글·주요 일정의 독립 저장 세션과 다른 남은 raw 경계를 이 조회 전환과 구분한다.

- 연차 공휴일은 `leave-holidays.md`의 공통 폼·확인·상태·문서 세션과 전체 연도 기준값을 사용한다. JSON 원문과 독립 초안은 저장/연도 조회로 지우지 않는다. 같은 목록 hash의 정상 건너뜀과 미확정을 구분하며 전체 목록·ID/건수·입력 digest를 검증한다. 외부 조회 후 첫 쓰기 전 서버 대조, native 복구와 계정/해제/늦은 응답 차단을 유지한다.

- 연차 채널 설정은 `leave-webhooks.md`의 공통 폼·확인·상태·작업 세션과 전체 목록/계정 기준값을 사용한다. 테스트는 서버가 확인한 정확한 수신처 목록에만 보내고 부분 발송/감사 실패를 롤백으로 안내하지 않는다. 웹훅 토큰은 확인창/목록/오류에 노출하지 않으며 큰 ID·초안·unknown 잠금·동적 행 해제를 유지한다.

- 연차 공휴일·채널 설정의 일반 필드/버튼/표는 `leave-admin-controls.md`와 공통 primitive를 사용한다. 공휴일 덮어쓰기는 `cw-check-control`/`cw-checkbox`를 유지한다. 가져오기 양식의 전송 이름과 고유 DOM ID를 구분하며 JSON 원문·native 검증·웹훅 마스킹을 유지한다. 스타일 전환을 공통 저장/확인 수명주기 완료로 보고하지 않는다.
- 연차 Discord 개인 DM의 활성화·수신 유형은 `leave-discord-controls.md`의 공통 checkbox를 사용한다. 앱은 옵션 제목·설명과 grid만 소유하며 선택·hover·focus·disabled 색과 입력 크기를 복제하지 않는다. hidden false fallback, 역할별 카탈로그, 미연동 disabled와 저장/확인 수명주기를 유지한다.

- 팀 일정 bootstrap/보드 GET은 `schedule-reads.md`의 응답 검증과 generated 공통 읽기 세션을 사용한다. 초기 실패를 빈 목록으로 숨기지 않고 같은 조건의 정상값은 일시 오류에 유지한다. 계정 변경 후 보드 재노출과 새 편집기 생성을 막되 기존 초안·동일 계정의 명시적 비교는 보존한다. 폴링으로 진행 중 요청/오류 안내를 덮지 않는다. 공통 읽기 관찰은 서버 인가·쓰기 ACK/롤백을 대신하지 않는다.

- 업무/주요 일정 카드는 공통 record/content 변형, 셀 전체 등록은 quiet/overlay를 사용한다. 프로젝트/유형 색은 --record-accent로 전달하고 강조·hover·선택·disabled 우선순위를 앱 CSS로 복제하지 않는다. schedule-board-controls.md의 목표/실현 선 구분·상세/드래그 ID·셀 전체 클릭과 실제 Tab 진입을 보존한다. 공통 CSS 변경은 여섯 앱 회귀 대상이다.

- 일정 보드의 일반 작업/행 펼침/모바일 등록 버튼도 schedule-board-controls.md를 따른다. 범례는 독립 common disclosure 루트를 사용한다. visibleLanes/직원별 반전 집합의 도메인 배치를 단순 hidden으로 바꾸지 않으며, 이름/부서와 32px 접기 버튼이 겹치지 않도록 실제 화면을 검증한다. 업무/주요 일정 카드와 셀 overlay의 별도 동작 검사를 유지한다.

- 일정 상단 분류·필터·주 이동은 schedule-board-controls.md의 공통 필드/버튼을 사용한다. 주말/선택 주와 목표·실현·상세 보기는 `cw-check-control`/`cw-checkbox`, 행 높이는 `cw-range`를 사용한다. 보기 설정의 hidden/ARIA는 generated disclosure가 소유하고 필터·기간·날짜 기준·행 높이·페이지 왕복 선호를 보존한다. 모바일 select 폭 제한/날짜 잘림이나 독자적인 checkbox 선택·입력 크기를 다시 만들지 않는다. WeekBoard 내부·raw 읽기/쓰기의 남은 경계는 별도로 검증한다.
- 일정의 예시 데이터와 오늘 문구는 `schedule-board-controls.md`의 `cw-state-pill`을 사용한다. 앱은 warning/info 의미와 모바일 예시 숨김·밀집 보드의 오늘 문구 숨김만 소유하고 색·크기·라이트/다크 보정을 복제하지 않는다. 오늘 열 테두리와 주말·공휴일 의미 색은 별도 달력 상태로 유지한다.

- 일정 날짜 이동/달력 내부도 공통 필드·버튼·상태와 `owned-modals.md`의 공통 팝업을 사용한다. 선택/비활성 색을 개별 복제하지 않고 주말·공휴일 색은 숫자와 범례에만 적용한다. `schedule-task-controls.md`의 7열/6주·연도 확정·윤일·하한·중첩 Escape/포커스 검증을 유지하며 공휴일 읽기 전체 계약과 프레임 연결을 구분한다.

- 일정 관리의 주요 일정 신규/수정·삭제·보관함은 공통 필드/버튼/상태를 사용한다. content 목록의 기하만 `settings.css`에 두고 선택은 실제 `aria-pressed`로 연결한다. 저장은 `schedule-milestone-writes.md`, 원문·ID·권한/초안 UI는 `schedule-task-controls.md`를 따르며 보관함 등 별도 경계와 구분한다.

- 팀 일정 업무·댓글의 일반 필드/작업 버튼과 날짜 입력 진입부는 `schedule-task-controls.md`를 따른다. 편집 높이·날짜 기하는 유지하되 색/상태를 앱에서 복제하지 않는다. 업무/버전/주요 일정·달력·이미지 프레임은 공통 modal hook을 사용한다. 이미지 업로드 전송은 별도 계약으로 연결했지만 댓글 저장 전송까지 완료한 것으로 확대하지 않는다.

- 팀 일정 버전 기록/개인 TODO의 일반 필드·버튼·버전 표는 `schedule-record-controls.md`의 공통 primitive를 사용한다. actual aria-selected/disabled·위험 상태를 연결하고 기존 저장/충돌/이탈 계약은 보존한다. 미전환 앱 hover를 공통 버튼에서 제외할 때 선택자 우선순위를 늘려 공통 상태 UI까지 덮어쓰지 않는다.

- 연차 감사 조회는 `leave-audit.md`의 공통 필드/표/단일 disclosure/상태를 유지한다. 실패에는 마지막 정상 목록을 보존하고 계정·권한 변경에는 이전 본문을 제거한다. 늦은 HTML 응답·오류 redirect로 이전 계정 내용을 복원하지 않으며 감사 원문의 큰 정수를 JSON 재직렬화하지 않는다.

- Portal 신규/기존 계정 필드는 같은 `_AccountField`와 `portal-controls.md`의 공통 입력/버튼/표를 유지한다. 공개 범위·프로젝트를 한쪽 양식에만 추가하지 않으며 checkbox/링크/엔티티 선택기와 일반 필드를 구분한다. 일괄 저장·초안/충돌·native fallback은 스타일 전환과 별도로 보존한다.
- Portal 직원 일괄 저장의 충돌 비교 GET은 `portal-account-reads.md`의 `account-review` 공통 읽기 채널을 사용한다. 계정 변경·페이지 이탈 취소와 전체 응답/64비트 버전·초안 대조를 유지하고, 화면 전용 AbortController나 timeout을 복원하지 않는다.

- CS 일반 입력·동적 행 작업·표, 플레이어 저장·추가·삭제 확인, 상품 명령 Dry Run·병합 승인과 로그 장기 검색 확인은 `cs-controls.md`의 공통 primitive를 사용한다. 환경·거래·작업·미리보기 상태는 `cw-state-pill`과 명시적인 `data-tone`을 사용하며 앱 전용 `badge-*` 팔레트를 만들지 않는다. 로그 선택 상태는 실제 ARIA로 연결하고 diff canvas의 투명 편집기/고정폭 기하와 확인 문구 배치만 앱이 소유한다. 동기 초안 폐기 확인을 스타일 변경에 섞어 비동기로 치환하지 않는다.

- 시트 조회는 `sheet-reads.md`의 전체 응답·대상 검증과 `useSheetData`의 원자적 초기 표시/요청별 관찰/공통 오류·권한 상태를 사용한다. 150개 규칙 표시 제한을 전체 총계와 혼동하거나 실패를 빈 목록으로 숨기지 않는다. 계정 변경 뒤 이전 본문을 재조회로 되살리지 않으며 분석/비교 POST 취소를 서버 작업 롤백으로 안내하지 않는다.

- 시트의 검색/작업 버튼·표·기록 정보와 Google/데모 연결 상태는 `sheet-controls.md`의 공통 primitive와 generated disclosure를 사용한다. 연결 상태는 `cw-state-pill`의 success/warning tone을 사용하고 앱 전용 mode class·팔레트를 만들지 않는다. 읽기 전용 실행 설명과 실제 쓰기 허용을 구분하며 스냅샷 메타데이터 펼치기를 셀 원문 조회/복원으로 안내하지 않는다. 모바일에서 버튼 문구를 font-size:0으로 숨기지 않는다.

- 통계 갱신은 `statistics-refresh.md`와 `refresh.js`의 공통 확인·상태·작업 세션 및 실제 worker/요청 ID/전체 접수 응답을 유지한다. IPC send를 202 성공으로 대체하거나 강제 갱신으로 진행 중 작업을 중복 접수하지 않는다. 접수 timeout은 집계 롤백이 아니다. 계정/대상/이전 revision을 서버에서 대조하고 미확정 쓰기는 GET으로 잠금을 풀지 않는다. job JSON API를 native 저장 폼으로 위장하거나 개별 confirm/poll 루프를 다시 만들지 않는다.
- 통계 상단의 데모·확인 중·집계 중·완료·오류 표시는 `statistics-controls.md`의 `cw-state-pill` tone 계약을 사용한다. 앱은 상태 문구와 최소 폭만 소유하고 전용 live class나 색·크기 skin을 만들지 않는다.

- 통계의 필터/정렬/동적 상세 버튼·표는 `statistics-controls.md`의 공통 primitive를 유지한다. 진행도·완성 조합·보스 연계 옵션은 `cw-check-control`/`cw-checkbox`를 사용하고 모바일 필터 폭 보정에서 checkbox를 일반 입력처럼 늘리거나 줄이지 않는다. compact/quiet/content 변형은 공통 소유자로 확장하고 개별 hover/선택/비활성 색상을 다시 덧씌우지 않는다. 분석 종류의 pressed 상태·옵션 hidden·정렬 aria-sort와 native 입력 검증을 보존한다. 갱신과 일반 필터 조회의 검증 범위는 구분한다.

- 새 페이지뿐 아니라 기존 파일에 추가하는 native 버튼·일반 입력·표·창도 `packages/contracts/ui-primitives.md`와 공통 소유자를 따른다. `check:ui`가 전체 앱 소스를 검사한다. `ui-primitive-debt.json`은 부채 0 상태로 봉인되어 있으므로 `sealed`를 해제하거나 파일·서명·개수 예외를 다시 추가하지 않는다. 동적 UI·checkbox/file·폼 수명주기는 정적 primitive 검사만으로 완료를 주장하지 않는다.

- 연차 보정·발생분 관리는 `leave-grants.js`의 공통 폼/확인/상태/작업 세션과 `packages/contracts/leave-grants.md`의 전체 응답을 유지한다. 퇴사 직원 과거 보정·음수 발생분을 정산 정책으로 제한하지 않는다. 같은 직원·유형·기준일의 세 작업은 이전 hash를 공유하고 임의 갱신하지 않는다. 직원별 행은 동일 `_GrantRow`와 DOM 보관을 사용하며 목록 이동/저장으로 다른 초안을 지우지 않는다. 서버 계약만 연결한 것을 실제 UI 전환 완료로 보고하지 않는다.

- native 작업 버튼은 명시적 `cw-button`과 `data-variant`를 사용하고 disabled/fieldset-disabled 색을 개별 복제하지 않는다. 공통 확인창의 직원/프로젝트 details.entity는 `CompanyEntityDisplay`를 재사용하며 로컬 직원 ID는 회사 ID로 매핑한 뒤 전달한다.

- 일반 native 입력 필드는 `cw-form-fields`/`cw-form-field`/`cw-form-control`/`cw-form-wide`를 재사용한다. 앱별 input/select 색·포커스·크기 CSS를 복제하지 않는다. 기존 미전환 필드와 checkbox/file는 구분하고 `packages/contracts/native-fields.md`를 따른다.
- 연차 소멸·이월·보상은 `leave-settlements.js`의 공통 폼·확인·상태와 발생분별 서버 스냅샷을 사용한다. 선택한 직원과 실제 발생분 ID를 혼동하지 않고 이월 생성/정산/감사 전체 응답을 검증한다. 커밋 뒤 감사 실패를 롤백으로 안내하지 않는다. 계약은 `packages/contracts/leave-settlements.md`다.

- 전역 메뉴, 회사 로고/홈 링크, 로그인/프로필, 알림 종, 테마, 사이드바 프레임은 공통 셸의 책임이다. 페이지에서 복제하지 않는다.
- 새 페이지는 공통 페이지 등록과 생성기를 사용한다. 제목, 경로, 서비스, 권한, 본문만 앱이 소유한다.
- 직원/프로젝트 선택은 공통 선택기와 서버가 필터링한 목록을 사용한다. 이름으로 ID를 추정하지 않는다.
- 신규/기존 계정 폼은 같은 필드 계약을 사용한다. 화면 숨김은 서버 권한 검사를 대체하지 않는다.
- 통합 알림 ID는 `packages/contracts/notifications.md`와 공통 `CompanyNotificationContract`를 따른다. `sourceId`를 Number/parseInt로 바꾸지 않는다. 큰 ID·잘못된 응답·실제 읽음 경로 회귀를 유지한다.
- 통합 알림 요청은 `CompanyNotificationSession`과 공통 상태 UI를 사용한다. 요청 당시 `expectedUserId`를 서버에서 대조하고 정확한 204 확인과 후속 조회를 구분한다. 계정/권한 변경·해제·timeout 뒤 이전 응답을 반영하거나 미확정 쓰기를 자동 재전송하지 않는다. 별도 알림 fetch/쓰기 루프를 복제하지 않는다.
- 프로필 사진 편집은 `CompanyProfile`과 공통 폼/상태/확인창을 사용한다. `packages/contracts/profile.md`의 계정·사진 버전·전체 저장 응답 검증을 유지한다. 기존 raw 이미지 API를 새 화면의 저장 경로로 다시 연결하지 않는다. 갱신 신호는 저장 확인 후에만 보낸다.
- 프로필·프로젝트 아이콘의 이미지 준비와 저장 수명주기는 `CompanyImageEditor` 한 곳에서 관리한다. `CompanyProfile`/`CompanyProjectIcon`은 대상·권한·응답 계약만 연결한다. 프로젝트 아이콘은 `packages/contracts/project-icons.md`의 계정·프로젝트·기존 이미지 버전을 대조하는 native 폼을 사용하며 조직 정보와 별도로 저장한다. 개별 Canvas/이미지 fetch/확인창을 다시 복제하지 않는다.
- 색상은 의미별 토큰을 사용한다. 다크 모드를 filter: invert로 구현하지 않는다.
- `--cw-*` 이름과 light/dark 팔레트 선택자는 공통 테마 전용이다. 새 토큰은 `packages/workspace-ui/src/company-workspace.css`의 light/dark 정의에 함께 등록하고 페이지에서 재정의하지 않는다. 앱 CSS는 `data-theme`, `.theme-dark/.theme-light`, `prefers-color-scheme`로 별도 모드 팔레트를 만들지 않으며, 기존 `--bg`, `--surface`, `--text`, `--primary` 같은 기반 별칭은 반드시 `--cw-*`에만 매핑한다. 프로젝트·부서·게임 분류처럼 데이터 의미를 구분하는 색은 앱이 소유할 수 있지만 화면 기반 팔레트와 섞지 않는다. `check:ui`는 서비스 등록에서 UI 소스 경계를 찾아 새 파일도 검사한다. 토큰 이름을 동적으로 조립하지 않는다.
- 신규 실행 확인은 공통 `CompanyDialog.confirm`/generated `confirmWorkspaceAction`을 사용한다. 개별 확인 모달·테마 CSS를 복제하지 않는다. 확인 전 대상/버전/로그인 범위를 캡처하고 확인 후 다시 검증하며 실제 서버 인가도 유지한다.
- 도메인 입력이 포함된 확인 양식은 `CompanyDialog.present`와 공통 `.cw-dialog-form` 프레임을 사용한다. 전송 중 Escape를 보류해도 계정 변경/abort는 항상 해제하며 늦은 응답을 적용하지 않는다. 성공한 쓰기 뒤의 읽기 재시도는 쓰기를 반복하지 않아야 한다.
- 확인은 실행 의도이지 저장 성공이 아니다. 응답 확인과 후속 읽기를 분리하고 통신 오류를 자동 재전송하지 않는다. 기존 동기식 이탈 확인을 Promise 확인창으로 단순 치환하지 않는다.
- native POST 폼은 공통 `CompanyForm`에 연결하고 해제 시 `dispose()`를 호출한다. `formmethod`, `.method`/`.formMethod` 할당이나 `setAttribute`로 `check:post`를 우회하지 않는다. 저장 응답은 전체 검증 후 동기적으로 반영하며, 비동기 `onSaved`는 자체 await 뒤 `context.isCurrent()`를 다시 확인한다. 계정 범위 변경/timeout/해제 뒤 늦은 응답과 이전 요청의 잠금 해제를 회귀 테스트로 검증한다. 클라이언트 abort를 서버 롤백으로 안내하지 않는다.
- 한 문서의 복수 폼은 공통 `CompanyForm.createSession()`으로 확인/쓰기를 조정한다. 확인된 저장은 다른 초안의 저장을 풀되 처리한 대상/이전 기준값은 재사용하지 않는다. 미확정 쓰기는 문서를 잠그고 GET 결과 확인만 제공한다. GET 성공/실패는 작업 revision을 대조해 저장 후 늦은 읽기도 배제한다. `packages/contracts/form-session.md`의 owner·lease·초안·전체 ACK·서버 경계를 유지하며 `blocked` 표시 검사만으로 begin을 대체하지 않는다.
- 조직 등록/수정은 공통 확인·폼과 서버 계정/수정 버전 대조를 유지한다. 전체 커밋 응답 검증 전에 새 페이지로 이동하거나 초안을 비우지 않는다. HTML 실패의 원문 보관은 허용된 업무 필드만 포함하고 인증 토큰·내부 예외는 노출하지 않는다. 아직 별도 저장인 프로젝트 아이콘을 조직 트랜잭션에 포함된 것으로 안내하지 않는다.
- 연차 승인/취소 승인/강제 삭제는 동일 `_ApprovalAction`과 공통 폼·확인창·상태를 사용한다. 자동 목록 갱신으로 확인 중인 대상이나 삭제 사유 초안을 교체하지 않는다. `packages/contracts/leave-approvals.md`의 정확한 직원/신청/스냅샷/처리 응답과 후속 조회 구분을 유지한다. 업무 저장 뒤 감사/알림 오류도 미확정일 수 있으므로 예외를 무조건 입력 거부/롤백으로 설명하지 않는다.
- 직원 연차 신청은 `packages/contracts/leave-application.md`에 따라 공통 폼/확인창/상태와 정확한 현재 직원·입력·근무일·이동 경로 응답을 검증한다. GET 필터 기본값을 업무 초안으로 혼동하지 않으며 다른 POST 편집 초안은 자동 이동으로 지우지 않는다. 신청 결과 미확정은 재전송하지 않고 내역 확인을 요구한다.
- 직원 취소/철회는 목록과 달력의 동일 `_SelfActionForm`과 `LeaveRequestSnapshot`을 사용한다. 전체 신청 날짜를 포함한 기준값, 현재 직원 소유권, 승인 전 즉시 취소/승인 후 취소 승인 대기/철회 후 승인 상태를 유지한다. 진행 중 신청·취소와 목록 교체를 겹치지 않게 하고 공통 확인창의 Escape를 뒤쪽 달력 창으로 전달하지 않는다. 계약은 `packages/contracts/leave-self-actions.md`를 따른다.
- 외부 일정은 `leave-external-schedules.js`와 공통 폼/확인창/상태를 사용한다. 현재 관리자·정확한 일정 ID·기존 fingerprint 및 전체 응답을 대조한다. 날짜 재선택·달력 교체·다른 일정 삭제로 초안을 지우지 않고 대상 전환/초기화는 공통 확인을 받는다. 잘못된 수정 ID를 신규 생성으로 바꾸거나 감사 실패를 롤백으로 안내하지 않는다. 폼의 이름 있는 `id` 입력이 속성을 가릴 수 있으므로 폼 식별자는 `getAttribute('id')`로 읽는다. 계약은 `packages/contracts/leave-external-schedules.md`다.
- 달력 관리자 강제 연차 작업은 `leave-calendar-admin.js`와 공통 폼/확인/상태를 사용한다. 사유 입력은 `CompanyDialog.present`의 공통 확인창 프레임에 연결하고 native prompt/confirm을 복제하지 않는다. 추가 날짜·삭제 전체 신청 기준값·사유와 전체 저장 응답을 대조하며 날짜 선택/GET 교체/다른 연차 초안·계정 변경/해제를 함께 처리한다. 실제 재직 직원·과거 날짜/반차/미차감·마스터 삭제 정책과 DB 재조회 기준값, native 오류의 허용 원문 인코딩을 유지한다. 도메인 계약은 `packages/contracts/leave-calendar-admin.md`, 독립 초안 순차 저장은 `form-session.md`를 따른다.
- 신규 접기/펼치기는 공통 `CompanyDisclosure`의 버튼·패널 키 규약을 사용한다. 본문 값/폼은 그대로 두고 표시 상태와 ARIA만 공통 소유한다. 필터로 상세를 닫을 때도 공통 API를 사용하며, 모바일 표 가로 스크롤과 펼친 폼 너비를 분리한다. CS처럼 큰 편집기는 DOM을 복제하지 않고 공통 패널 사이에서 재사용하며 접기/검색으로 초안을 지우지 않는다. 미전환 소비자는 이관 기록으로 구분한다.
- React 펼치기는 generated `useWorkspaceDisclosure`로 연결한다. 초기 `hidden` 패널을 유지하고 이후 표시/ARIA를 React 상태로 중복 제어하지 않는다. 실제 공통 컨트롤러와 함께 루트 교체·해제·키보드·초안 보존을 검사한다. 목록의 조회 실패를 빈 결과로 표시하지 않으며 계정/프로젝트 범위가 바뀐 뒤 늦은 응답을 적용하지 않는다.
- 기존 예외는 이관 목록에 근거와 제거 조건을 기록한다. 검사 통과를 위해 새 파일을 예외 처리하지 않는다.

## 검증 및 안전

- 공통 코드 변경은 모든 소비 앱의 검사 대상이다. 테스트가 통과했다는 사실과 실제 화면을 확인했다는 사실을 구분해 보고한다.
- PC/모바일 및 light/dark, 권한별 표시, 키보드 동작과 문서 가로 넘침을 확인한다.
- .env, 실제 계정 데이터, 인증 키, DB, 운영 백업은 커밋하지 않는다.
- 운영 폴더/원격/볼륨은 이관 계획 없이 삭제·교체하지 않는다. reset --hard, clean -fd, compose down -v를 배포 단계에 넣지 않는다.
- 커밋 제목은 반드시 `type(scope): 구체적인 한국어 변경 요약` 형식을 사용한다. `type`과 선택적 `scope`만 영어 Conventional Commits 표기(`feat`, `fix`, `refactor`, `test`, `docs`, `chore` 등)를 사용하고, 콜론 뒤 제목은 고유명사·코드 식별자를 제외하고 한국어로 작성한다. `fix(schedule): prevent period select clipping`처럼 제목 전체를 영어로 작성하지 않는다.
- 커밋 메시지는 변경 의도와 영향이 추적될 만큼 가능한 한 자세히 작성한다. 사소한 단일 변경이 아니라면 제목 다음 빈 줄에 한국어 본문을 추가하고, 문제·배경, 핵심 구현, 호환성·데이터·운영상 주의점, 실제 수행한 테스트·빌드·배포 결과와 수행하지 않은 범위를 구체적으로 기록한다. `수정`, `작업 완료`, `update`처럼 범위를 알 수 없는 제목·본문은 사용하지 않으며, 실행하지 않은 검증이나 배포를 완료했다고 적지 않는다.
- CI, 배포 차단, 시각 검증, 운영 적용은 각각 증거를 남긴다. 계획 또는 미실행 테스트를 완료로 표시하지 않는다.
- CI 변경 시 `npm run check:ci`와 verification-gate 변이 테스트를 실행한다. 필수 job/명령/matrix를 검사 회피 목적으로 축소하지 않는다. 검사 정책 변경은 검증 범위 변경으로 검토한다.
- npm 의존성 변경은 잠금 파일·실제 설치 트리·온라인 audit와 영향 앱의 테스트/빌드를 함께 확인한다. 개발 의존성을 빼거나 오프라인 설치 메시지를 최신 보안 증거로 사용하지 않는다. 호환 override는 근거와 제거 조건을 기록하며 생성 서버가 바뀌면 격리 runtime 검사도 수행한다.
- 배포 전 `docs/DEPLOYMENT.md`를 따른다. 로컬 생성 JSON이나 PR 검사 기록을 운영 승인으로 사용하지 않는다. 정확한 원격·커밋·이미지·Compose 프로젝트·데이터 경로 및 롤백 대상을 확정하기 전 운영 checkout을 전환하지 않는다.
