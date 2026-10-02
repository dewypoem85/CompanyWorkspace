# Schedule 주요 일정 저장 계약

## 범위와 호환성

일정 관리의 주요 일정 생성·수정·삭제는 `Settings`와 `useMilestoneWrites`의 한 저장 경로를 사용한다. 일정 접근 권한이 있는 활성 개인 계정은 주요 일정을 생성·수정할 수 있고, 삭제는 관리자·부서 책임자만 할 수 있다. 기존 `POST /api/milestones`, `PUT /api/milestones/{id}`, `DELETE /api/milestones/{id}`의 본문, 프로젝트 공개 범위와 Version 정책은 유지한다.

서버 `MilestoneWriteProtocol`은 `Accept: application/vnd.company.workspace-form+json`을 보낸 새 클라이언트에만 공통 envelope를 반환한다. 이전 클라이언트는 생성·수정에서 기존 단일 `Milestone` JSON, 삭제에서 204를 그대로 받는다. 일반 직원의 기간별 주요 일정 읽기도 기존 배열 응답을 유지한다.

하나의 Milestone은 공통 제목·상세 내용·프로젝트와 기본 타입·시작일을 가진다. 선택적 종료일과 최대 20개의 `additionalSchedules`(각각 타입·시작일·선택적 종료일)를 같은 행·Version으로 저장한다. 기존 행은 추가 일정 `[]`, 종료일 `null`로 이관되며, 이전 클라이언트가 추가 일정 필드를 생략한 수정 요청을 보내면 이미 저장된 추가 일정과 종료일을 보존한다. 기간 조회는 기본 및 추가 일정 중 하나라도 요청 기간과 겹치면 게시글 하나를 반환한다.

## 편집 기준과 확인

- 일정 접근 권한이 있는 클라이언트는 `/api/milestones?...&editing=true`에서 현재 기간의 `items`와 actor ID, 생성 기준 토큰, 접근 가능한 주요 일정별 기준 토큰을 함께 받는다.
- 생성 토큰은 현재 계정 권한과 접근 가능한 주요 일정 전체를 포함한다. 수정·삭제 토큰은 현재 계정 권한과 정확한 대상 행의 ID·타입·제목·설명·기본/추가 일정·프로젝트·Version·작성/수정 감사 정보를 포함한다.
- 브라우저는 편집을 시작한 원본 행과 제출할 전체 본문을 별도로 고정한다. 전송 전에 최신 회사 계정과 편집 기준을 다시 읽고 계정·권한·대상·Version·기준 토큰 중 하나라도 바뀌면 쓰지 않는다.
- 공통 확인창 승인 직전에도 대상·초안·프로젝트·날짜와 기준 토큰을 다시 대조한다. 전송 직전에만 문서 lease를 `sent`로 전환한다.
- 요청은 CSRF, `X-Workspace-Actor`, `X-Workspace-Milestone-State`와 공통 media type을 보낸다. 삭제 본문은 고정한 `{version}`만 보낸다.

## 전체 저장 응답

```text
protocol: workspace-form-v1
outcome: saved
data:
  operation: create | update | delete
  actorId: 저장한 회사 사용자 ID 문자열
  previousStateToken: 요청의 정확한 기준 토큰
  stateToken: 저장 뒤의 대상 또는 생성 기준 토큰
  milestone: 생성·수정된 행 또는 삭제 직전 행 전체
  deleted: 삭제일 때만 true
```

소비자는 전송 JSON 전체, operation·actor·이전/새 토큰, 주요 일정 ID·타입·제목·설명·기본/추가 일정·프로젝트·Version과 삭제 여부를 모두 확인한 뒤에만 초안과 목록을 갱신한다. 생성은 서버 Version 1, 수정은 정확히 1 증가한 Version, 삭제는 원본 행 전체와 일치해야 한다. 서버는 신규 행에 생성자·생성 시각·최근 수정자·수정 시각을 기록하고, 생성·수정마다 actor와 변경 전후 전체 스냅샷을 별도 이력으로 남긴다. 기존 행은 작성자를 추정하지 않고 감사 필드를 비워 둔다. `/api/milestones/{id}/history`는 현재 계정에 보이는 일정의 최근 변경 이력을 제공한다.

## 트랜잭션·실패·복구

서버는 기준 읽기부터 DB 쓰기와 실제 ACK 캡처까지 하나의 트랜잭션에 두고 커밋 성공 뒤 응답한다. 입력 오류와 첫 쓰기 전 충돌·권한 거부는 교정·비교할 수 있다. 첫 DB 쓰기 뒤 예외, 연결 중단, timeout, malformed ACK는 `unknown`이며 같은 문서 세션에서 자동 또는 수동 재전송하지 않는다. 클라이언트 abort는 롤백 증거가 아니다.

확인 취소 전에는 요청하지 않는다. 사전 충돌은 최신 목록을 읽되 작성 중인 초안을 유지한다. 성공 ACK 뒤 목록 GET만 실패하면 저장 성공과 초안을 유지하고 읽기만 다시 수행한다. 계정이나 편집 범위가 바뀌면 보내지 않은 요청도 기존 문서에서는 잠그고 새 화면에서 다시 확인한다.

## 검증

`MilestoneWriteProtocolTests`와 `MilestoneTests`는 실제 TestServer·SQLite에서 일반 직원 생성·수정, 관리자 삭제, 작성자·최근 수정자, 변경 전후 이력, 생성·수정·삭제 envelope, 레거시 응답, actor·Version·기준 충돌과 오류 분류를 검사한다. `milestoneWrites.test.ts`, `useMilestoneWrites.test.ts`, `scheduleReads.test.ts`는 원본/본문 캡처, 편집 응답, 전체 ACK, 확인 취소, 사전 충돌, malformed ACK, 삭제 본문과 후속 읽기 실패를 검사한다.

구조 변이는 raw 주요 일정 writer 복원과 actor·기준값·트랜잭션·확인·markSent·전체 ACK·문서 세션 누락을 거부한다. `schedule-shell.spec.mjs`는 모바일/PC·두 테마에서 생성·수정·삭제, 충돌 비교, 확인 취소, 포커스 복귀와 정확한 요청 헤더·본문을 검사한다. 합성 HTTP는 운영 DB·SSO·배포 성공 증거가 아니다.
