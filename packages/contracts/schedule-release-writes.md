# Schedule 버전 기록 저장 계약

## 범위와 호환성

버전 기록 생성·수정·삭제는 `useReleaseEditor`의 한 저장 경로를 사용한다. 기존 `POST /api/releases`와 `PUT /api/releases/{id}`의 본문, 관리자·부서 책임자 권한, 프로젝트 범위, Version 규칙은 유지한다. 삭제는 `DELETE /api/releases/{id}`에 현재 Version을 보내며 기존 호출은 성공 시 204를 반환한다.

새 클라이언트가 `Accept: application/vnd.company.workspace-form+json`을 보내면 `ReleaseWriteProtocol`이 공통 `workspace-form-v1` 응답을 반환한다. 기존 클라이언트는 단일 `ReleaseRecord` JSON을 그대로 받는다.

## 편집 기준과 명시적 확인

- 저장 직전 `/api/releases/editing?projectId=...&id=...`에서 현재 actor ID, 대상 전체 행과 상태 토큰을 읽는다. 신규 등록에는 `id`를 보내지 않으며 `record`가 `null`이어야 한다.
- 수정 토큰은 계정 권한과 대상 행의 영구 식별자, 프로젝트, 버전 번호, 출시일, 본문, 상태, 연결 버전, 작성자, Version, 수정 시각을 포함한다. 생성 토큰은 계정 권한과 해당 프로젝트의 기존 버전 행 전체를 포함한다.
- 브라우저는 편집 원본과 제출할 전체 JSON을 별도로 고정하고, 최신 회사 계정과 편집 기준을 공통 read session으로 다시 읽는다. actor·권한·대상·Version·토큰·초안 중 하나라도 달라지면 요청하지 않는다.
- 공통 확인창 승인 직전에도 같은 초안과 계정 범위를 대조한다. 전송 직전에만 문서 lease를 `sent`로 바꾼다.
- 요청에는 CSRF, `X-Workspace-Actor`, `X-Workspace-Release-State`와 공통 media type이 들어간다.

## 전체 저장 응답

```text
protocol: workspace-form-v1
outcome: saved
data:
  operation: create | update | delete
  actorId: 저장한 회사 사용자 ID 문자열
  previousStateToken: 요청에 사용한 상태 토큰
  stateToken: 저장 뒤 대상 행의 상태 토큰
  release: 생성·수정되었거나 삭제 직전의 ReleaseRecord 전체
  deleted: 삭제 여부
```

클라이언트는 전송 JSON 전체와 operation, actor, 이전·새 토큰, 삭제 여부, 반환된 행의 대상·Version·정규화된 내용을 모두 검증한 뒤에만 편집 기준을 교체한다. 생성 결과는 Version 1이어야 하고 수정 결과는 전송한 Version보다 정확히 1 커야 한다. 삭제 결과는 삭제 직전의 전체 행과 전송한 Version이 일치해야 하며 확인된 목록 갱신 뒤 편집창을 닫는다.

## 트랜잭션과 실패 처리

서버는 최신 기준 읽기, 권한·Version 검사, 저장, 감사 기록, 실제 ACK 캡처를 하나의 DB 트랜잭션에 둔다. 커밋한 뒤에만 응답한다. 첫 DB 쓰기 전 입력 오류·권한 거부·충돌은 `invalid`, `denied`, `conflict`로 분류한다. 첫 쓰기 뒤 예외나 timeout, 연결 중단, 불완전한 ACK는 `unknown`이며 같은 문서에서 자동 또는 수동으로 재전송하지 않는다.

기본 버전은 같은 기본 번호의 마이너 기록을 모두 삭제한 뒤에만 삭제할 수 있다. 다른 기록의 복귀 버전이나 문제 해결 마이너로 연결된 기록도 연결을 먼저 수정해야 한다. 삭제 시 해당 기록의 변경 이력은 함께 제거하지만 전역 감사 로그에는 삭제 직전 기록을 남긴다.

확인 취소나 사전 충돌은 요청하지 않고 초안을 유지한다. 유효한 ACK 뒤 버전 목록 갱신만 실패하면 저장은 성공이다. 이때 다시 저장하지 않고 목록 읽기만 재시도한다. 계정·권한·화면 범위가 바뀌면 진행 중 응답을 적용하지 않는다.

## 검증

`ReleaseWriteProtocolTests`는 TestServer와 SQLite에서 생성·수정·삭제 전체 ACK, actor·상태·권한·입력 오류, 오래된 Version, 레거시 응답을 검사한다. `releaseWrites.test.ts`와 `useReleaseEditor.test.ts`는 편집 기준, 정확한 전송 본문, 확인 취소, 중복 방지, 전체 ACK, 사전 충돌, 미확정 응답, 계정 변경, 후속 목록 실패를 검사한다.

구조 검사는 raw 생성·수정 writer와 actor·상태·트랜잭션·공통 확인·`markSent`·전체 ACK·문서 세션 누락을 거부한다. 브라우저 검증은 실제 화면에서 확인창, 요청 헤더·본문, 성공 후 목록 갱신과 초안 보존을 확인한다. 합성 HTTP 검증은 운영 DB·SSO·배포 성공의 증거가 아니다.
