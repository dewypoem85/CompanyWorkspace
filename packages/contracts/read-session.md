# 공통 읽기 관찰 세션

`CompanyReadSession.create()`는 읽기 작업의 채널별 교체·취소·관찰 제한·해제를 소유한다. React는 생성된 `createWorkspaceReadSession` 어댑터를 사용한다. 원본은 `packages/workspace-ui/src/read-session.js`이며 앱으로 복사해 수정하지 않는다.

- `run(channel, work, timeoutMs = 30000)`은 work에 AbortSignal을 전달한다. 동일 채널은 이전 작업을 대체하고 다른 채널은 유지한다.
- 반환값은 `success`(value), `error`(error), `cancelled` 중 하나다. success/error의 `isCurrent()`는 반환 이후에도 후속 작업·cancel·dispose를 감지한다. 별도 await 후 적용할 때 다시 확인한다.
- AbortSignal을 무시하는 fetch/JSON도 관찰은 종료한다. 늦은 완료는 성공으로 발행하지 않는다. 한 묶음이 실패하면 signal을 취소하여 남은 병렬 읽기도 중단 요청한다.
- `cancel(channel)`은 ticket을 먼저 무효화한다. `dispose()`는 모든 채널을 취소하고 이후 run은 cancelled를 반환한다.
- 전송 URL·HTTP/JSON 검증·현재 계정·검색 조건·캐시·목록 교체와 재시도 UI는 소비자 책임이다. work 내부에서 응답을 화면이나 로그인 상태에 먼저 반영하지 않는다.
- 취소는 서버 롤백이 아니다. 이 세션으로 쓰기 확인·멱등성·트랜잭션을 대신하지 않는다. 채널은 요청별 임의 ID 대신 고정된 논리 영역 이름을 사용한다.

현재 실제 소비자는 회사 계정 context와 공통 사이드바 권한, Portal 직원 충돌 비교, 일정 bootstrap/보드, 업무 상세, 업무 본문 참조 제목, 버전 기록 목록·참조·이력, 개인 TODO 목록, 날짜 선택기 공휴일, 읽기 전용 업무 열기 도구와 일정 관리 목록·보관함 조회, 연차 승인·감사·발생분·메인 부분 조회, CS 로그 설정·상태, Steam 설정·거래 조회, 상품 명령 설정·미리보기·조회, 플레이어 데이터 설정·조회, 시트 설정·분석·스냅샷·한국어 비교와 통계 설정·overview·갱신 context/status 조회다. 시트 쓰기 후 묶음 읽기, 통계 갱신 POST, CS의 다른 화면과 연차의 다른 기존 읽기 구현까지 이 세션으로 이관했다고 해석하지 않는다. 공통 단위 검사는 같은/다른 채널, 취소 무시, timeout, 동기 throw, 전달 후 ticket 무효화를 검증한다. 실제 앱 계약은 `workspace-context-reads.md`, `navigation-reads.md`, `portal-account-reads.md`, `schedule-reads.md`, `schedule-detail-reads.md`, `schedule-task-reference-reads.md`, `schedule-release-reads.md`, `schedule-todo-reads.md`, `schedule-date-picker-reads.md`, `schedule-tool-reads.md`, `schedule-settings-reads.md`, `leave-approvals.md`, `leave-audit.md`, `leave-grants.md`, `leave-dashboard-reads.md`, `cs-log-search-reads.md`, `cs-steam-refund-reads.md`, `cs-product-command-reads.md`, `cs-player-data-reads.md`, `sheet-reads.md`, `statistics-reads.md`, `statistics-refresh.md`를 따른다.
