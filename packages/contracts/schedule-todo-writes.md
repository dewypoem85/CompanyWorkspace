# Schedule 개인 TODO 저장 계약

## 범위와 호환성

개인 TODO의 추가·수정·완료/되돌리기·순서 변경·삭제는 `usePersonalTodos`의 한 저장 경로를 사용한다. 기존 `POST /api/personal-todos`, `PUT /api/personal-todos/{id}`, `PATCH /api/personal-todos/{id}/completion`, `PUT /api/personal-todos/order`, `DELETE /api/personal-todos/{id}`의 입력과 본인 소유권·Version 정책은 유지한다.

새 클라이언트가 `Accept: application/vnd.company.workspace-form+json`을 보내면 `PersonalTodoWriteProtocol`이 공통 `workspace-form-v1` envelope를 반환한다. 기존 호출자는 추가·수정·완료에서 단일 TODO JSON, 순서 변경·삭제에서 204 응답을 그대로 받는다.

## 편집 기준과 요청

- 저장 직전 `/api/personal-todos/editing?archived=...&id=...`에서 현재 actor ID, 정확한 행 또는 현재 탭 전체 목록과 상태 토큰을 읽는다. 추가·순서 변경은 `id` 없이 전체 목록을, 행 작업은 해당 ID 한 건을 사용한다.
- 상태 토큰은 계정 역할·활성·공용 여부·접근 범위와 TODO의 ID·ownerId·제목·순서·Version·생성/수정/완료 시각을 포함한다.
- 브라우저는 표시한 전체 원본과 보낼 전체 JSON을 고정한다. 같은 요청에서 회사 계정을 다시 확인하고 actor·권한·탭·대상·Version·목록 순서·초안 중 하나라도 달라지면 쓰지 않는다.
- 삭제 확인창 승인 직전에도 대상과 기준을 다시 대조한다. 다른 작업은 즉시 실행하되 전송 직전에만 공통 문서 lease를 `sent`로 전환한다.
- 요청에는 CSRF, `X-Workspace-Actor`, `X-Workspace-Todo-State`와 공통 media type을 보낸다. 삭제도 고정한 `{version}` 전체 JSON을 전송하고, 호환성을 위해 같은 값을 query에도 둔다.

## 전체 JSON 응답

```text
protocol: workspace-form-v1
outcome: saved
data:
  operation: add | save | complete | order | delete
  actorId: 저장한 회사 사용자 ID 문자열
  previousStateToken: 요청의 정확한 기준 토큰
  stateToken: 저장 뒤 대상 또는 목록 상태 토큰
  todo: 추가·수정·완료 행 또는 삭제 직전 행 전체
  todos: 순서 변경·삭제 뒤 현재 탭 목록 전체
  deleted: 삭제일 때만 true
```

클라이언트는 보낸 전체 JSON, operation·actor·이전/새 토큰과 반환 행의 모든 필드를 확인한 뒤에만 성공으로 처리한다. 수정·완료는 Version이 정확히 1 증가해야 한다. 순서 응답은 모든 ID와 1부터 시작하는 저장 순서가 요청과 같아야 하며, 삭제 응답은 삭제 직전 행과 남은 목록 전체가 원본 기준과 일치해야 한다.

## 트랜잭션·실패·복구

서버는 최신 기준 읽기부터 DB 쓰기, 저장 결과 재조회와 ACK 캡처를 하나의 트랜잭션에 두고 커밋 뒤 응답한다. 첫 쓰기 전 입력 오류·actor/상태·Version 충돌은 교정할 수 있다. 첫 쓰기 뒤 예외, timeout, 연결 중단, malformed ACK는 `unknown`이며 같은 문서 세션에서 자동 또는 수동으로 재전송하지 않는다.

유효한 ACK 뒤 목록 GET만 실패하면 저장은 성공이다. 사용자는 쓰기를 반복하지 않고 목록만 다시 확인한다. 전송하지 않은 사전 충돌은 초안을 유지할 수 있지만, 계정 범위 변경이나 미확정 전송은 해당 문서 저장을 잠그고 새 화면에서 다시 확인한다.

## 검증

`PersonalTodoTests`는 TestServer·SQLite에서 다섯 쓰기의 envelope, actor·상태·Version·목록 충돌, 전체 ACK와 레거시 응답을 검사한다. `personalTodoWrites.test.ts`는 편집 기준, 원본·본문 캡처, 행/목록/삭제 ACK와 문서 resource 식별을 검사한다.

구조 변이는 raw TODO writer 복원과 actor·상태 토큰·트랜잭션·문서 lease·`markSent`·전체 ACK 누락을 거부한다. `schedule-shell.spec.mjs`는 모바일/PC·두 테마에서 CRUD·완료·정렬·삭제 확인, 요청 헤더·본문, 충돌·오류·계정 변경과 성공 뒤 목록 실패를 검사한다. 합성 HTTP는 운영 DB·SSO·배포 성공 증거가 아니다.
