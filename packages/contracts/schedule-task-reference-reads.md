# 팀 일정 업무 참조 링크 조회

업무·댓글 본문에 포함된 다른 업무 링크의 제목은 `TaskLinkProvider` 범위에서만 조회한다. 같은 ID는 한 번만 읽되 로그인 계정, 권한 또는 업무 상세의 확인 상태를 넘어 캐시하지 않는다.

- 논리 채널은 업무별 `task-reference:${id}`다. 전송은 generated `WorkspaceReadSession`과 `scheduleGet`을 사용하며 JSON Accept, same-origin credential, no-store, HTTP·리디렉션·content-type 검사를 유지한다.
- `taskReferenceResponse`는 요청한 안전한 ID와 제목, nullable projectId, archived boolean 전체를 확인한다. 일반 JSON 파싱 결과를 검증 없이 표시하지 않는다.
- `workspace-entity-scope-change`, 상세 identity 무효화, provider 해제는 진행 중인 모든 참조 요청을 취소하고 캐시를 비운다. 해제 시 세션도 dispose한다.
- 완료 결과는 요청 generation과 현재 ticket을 다시 확인한 뒤에만 표시한다. 취소됐거나 늦은 결과, 권한·응답 검증 실패는 이전 계정의 제목을 유지하지 않고 기존 “확인할 수 없는 일정” 링크로 남긴다.
- 제목 조회 실패는 링크 클릭 자체를 숨기지 않는다. 클릭 후 초안 폐기 확인과 실제 상세 이동은 기존 `schedule-task-controls.md`의 별도 경계를 따른다.

구조 검사는 `WorkspaceReadSession`, `scheduleGet`, `taskReferenceResponse`, `workspace-entity-scope-change` 연결과 raw GET 재도입을 확인한다. 브라우저 검사는 제목 조회의 `application/json`, scope 변경 뒤 제목 폐기, 초안·현재 URL 보존 및 승인 뒤 실제 대상 상세 이동을 합성 HTTP로 검증한다. 이는 운영 권한이나 운영 업무 조회 성공의 증거가 아니다.
