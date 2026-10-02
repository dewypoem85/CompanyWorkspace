# Schedule 댓글 저장 계약

## 범위와 호환성

새 댓글·답글·댓글 수정은 `CommentComposer`와 `useCommentWrites`의 한 저장 경로를 사용한다. 기존 `POST /api/tasks/{id}/comments`, `PUT /api/comments/{id}` 요청 본문과 작성자·보관·버전·첨부 소유권·멘션 알림 정책은 유지한다.

서버 `CommentWriteProtocol`은 `Accept: application/vnd.company.workspace-form+json`을 보낸 새 클라이언트에만 공통 envelope를 반환한다. 이전 클라이언트는 기존 단일 `Comment` JSON을 그대로 받는다. 댓글 삭제는 기존 공통 업무 작업 경로가 소유하며 이 계약의 범위가 아니다.

## 기준값과 확인

- 업무 상세 응답은 현재 actor ID, 새 댓글 기준 토큰과 댓글별 기준 토큰을 `commentEditing`으로 제공한다.
- 새 댓글 토큰은 업무와 전체 댓글·댓글 첨부를 포함한다. 루트 댓글 토큰은 해당 댓글·답글·첨부를 포함하므로 댓글이나 답글이 추가된 뒤 같은 문서에서 새 작업을 정상적으로 시작하면서 오래된 기준은 거부한다.
- 브라우저는 본문 원문, parent ID, version과 첨부 ID 순서를 고정하고 최신 회사 계정과 업무 상세를 다시 읽는다. 기준 토큰이 다르면 요청을 보내지 않고 댓글 비교로 유도한다.
- 공통 확인창 승인 직전에도 계정·대상·초안·첨부와 기준 토큰을 다시 대조한다. 전송 직전에만 lease를 `sent`로 전환한다.
- 요청은 CSRF, `X-Workspace-Actor`, `X-Workspace-Target-State`와 공통 media type을 보낸다.

## 전체 저장 응답

```text
protocol: workspace-form-v1
outcome: saved
data:
  operation: create | reply | update
  actorId: 저장한 회사 사용자 ID 문자열
  previousStateToken: 요청의 정확한 기준 토큰
  stateToken: 저장된 댓글 기준 토큰
  comment: 저장된 Comment 전체
  attachments: 해당 댓글에 연결된 Attachment 전체
```

소비자는 전송 본문 전체, operation·actor·이전/새 토큰, 댓글 ID·업무·작성자·부모·본문·삭제·버전·생성/수정 시각과 첨부 ID·소유자·업무/댓글 연결·이름·MIME·크기·생성 시각을 모두 확인한 뒤에만 초안을 비운다. JSON 문자열의 큰 정수 모양과 멘션 ID 원문은 일반 객체 재직렬화로 바꾸지 않는다.

## 실패와 복구

입력 오류와 첫 쓰기 전 충돌·권한 거부는 교정·비교할 수 있다. 첫 DB 쓰기 뒤 예외, 연결 중단, timeout, malformed ACK는 `unknown`이며 같은 문서 세션에서 자동 또는 수동 재전송하지 않는다. 서버 트랜잭션은 기준 읽기부터 ACK 캡처까지 감싸고 커밋 뒤 응답하지만 클라이언트 abort를 롤백 증거로 취급하지 않는다.

성공 ACK 뒤 목록 GET만 실패하면 저장 성공과 초안을 유지하고 읽기만 다시 수행한다. 계정 범위 변경 중 보내지 않은 작업은 원래 actor의 검증된 상세 조회 후에만 복구한다. 이미 전송했거나 결과가 불명확한 작업은 복구하지 않는다.

## 검증

`CommentWriteProtocolTests`는 실제 TestServer·SQLite에서 생성/답글/수정 envelope, 레거시 응답, actor·버전·댓글/답글/첨부 기준, 쓰기 전 거부와 쓰기 후 불명확 결과를 검사한다. `commentWrites.test.ts`와 `useCommentWrites.test.ts`는 원문 캡처·전체 ACK·확인 취소·scope·중복 전송·후속 읽기 실패를 검사한다.

구조 변이는 raw 댓글 writer 복원과 계정·기준값·확인·markSent·전체 ACK·문서 세션 누락을 거부한다. `schedule-shell.spec.mjs`의 모바일/PC·두 테마 시나리오는 생성·답글·수정, 사전 충돌, 비교 복구, 확인 중 잠금, malformed ACK와 성공 후 GET 실패에서 초안 보존과 요청 횟수를 검사한다. 합성 HTTP는 운영 DB·SSO·배포 성공 증거가 아니다.
