# 팀 일정 관리 목록 조회

`Settings`의 주요 일정, 주요 일정 변경 이력과 보관 업무 목록은 `WorkspaceReadSession`과 `scheduleGet`을 사용한다. 주요 일정은 `settings-milestones`, 선택한 일정의 변경 이력은 `settings-history`, 보관함과 더 보기는 `settings-archive` 채널을 사용하며 탭·조회 시작일·선택 일정·계정이 바뀌거나 화면이 닫히면 이전 조회를 취소한다. `workspace-entity-scope-change`는 세 채널과 표시 중이던 목록을 모두 무효화한다.

모든 일정 사용자의 주요 일정은 `milestonePageResponse`로 편집 기준까지 검증하고, 선택한 일정의 actor·작업·변경 전후 스냅샷은 `milestoneRevisionResponse`로 검증한다. 보관함은 `archivedTaskPageResponse`로 모든 행이 실제 보관 상태인지 확인한다. 더 보기는 `mergeTaskListPages`로 total이 같은지, 빈 다음 페이지나 중복 업무가 없는지, 합친 행·편집 ID·댓글/첨부 집계가 서로 일치하는지 확인한 뒤 한 번에 교체한다.

취소됐거나 현재 generation/ticket이 아닌 늦은 결과는 목록·오류를 바꾸지 않는다. 첫 조회와 더 보기의 HTTP 오류, JSON이 아닌 응답, 리디렉션과 잘못된 페이지는 성공으로 적용하지 않는다. 주요 일정 쓰기의 사전/사후 조회는 `schedule-milestone-writes.md`의 독립 수명주기를 계속 따른다.

이 계약은 GET 목록 관찰만 다룬다. 주요 일정 생성·수정·삭제, 업무 복원, 서버 API·DB·인가를 변경하지 않는다.
