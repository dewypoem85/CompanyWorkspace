# 팀 일정 외부 도구의 업무 열기 조회

`open_schedule_task`는 양의 안전한 정수 업무 ID만 받으며 내용을 수정하지 않는다. 화면 이동 전에 `WorkspaceReadSession`의 `webmcp-task-open` 채널에서 `/api/tasks/{id}`를 `scheduleGet`으로 조회하고 `taskDetailResponse`로 대상 ID와 업무·댓글·첨부·변경 기록 전체를 검증한다.

새 도구 실행은 앞선 같은 채널 요청을 취소한다. `workspace-entity-scope-change`, 도구 등록 해제와 앱 수명 종료도 진행 중 조회를 취소하거나 세션을 폐기하며, 취소됐거나 현재 ticket이 아닌 결과는 화면을 이동하지 않는다. 조회·권한·검증 실패와 사용자에게 거부된 화면 이동은 `opened: true`로 보고하지 않는다.

검증된 조회 뒤 기존 `useWorkspacePage` 경로로 이동하므로 저장하지 않은 초안의 공통 탐색 확인을 우회하지 않는다. 이 계약은 읽기 전용 사전 확인만 다루며 TaskPanel의 자체 상세 관찰, 서버 API·DB·인가와 쓰기 동작을 변경하지 않는다.
