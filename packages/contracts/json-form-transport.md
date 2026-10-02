# 공통 JSON·native 저장 전송

`CompanyForm.createTransport(options)`가 native 폼과 JSON 요청의 관찰 수명주기를 소유한다. `attach(form, options)`는 native reportValidity·FormData·submitter·컨트롤 잠금·포커스 복원 어댑터다. React는 generated `workspace-form.ts`를 사용하며 앱별 복제 fetch/타이머를 만들지 않는다.

## API

- `send({url, method, json, headers, signal})`은 동일 출처 POST/PUT/PATCH/DELETE만 허용한다. URL 인증 정보·다른 출처·GET·직렬화 불가능한 JSON은 보내지 않는다. JSON과 formData를 동시에 제공할 수 없다.
- `send({url, formData})`는 POST만 허용하며 Content-Type은 브라우저가 multipart 경계를 만들도록 비운다. 기존 native 이름·복수 값·토큰은 그대로 전송한다.
- credentials는 same-origin, redirect는 manual이며 Accept는 공통 media type으로 고정한다. 소비자가 CSRF·현재 actor·기준값을 연결한다. 이 헤더는 인증/인가를 대신하지 않는다.
- `onSaved(data, submitted, context)`는 필수다. JSON submitted는 실제 직렬화된 본문의 복사본이다. 도메인은 전체 ACK를 검증하고, 비동기 처리에서는 자신의 await 뒤에도 context.isCurrent()를 확인해야 한다. 공통 도구가 소비자 내부 부작용을 롤백할 수는 없다.
- `onState`는 공통 상태 명세를 전달한다. React는 WorkspaceState, native는 CompanyState에 연결한다. `onSettled(saved, outcome)`은 선택적 알림이며 send Promise도 동일 결과로 종료한다.
- `busy`, `dispose()`를 제공한다. 소비자 해제 시 dispose를 호출한다. isConnected가 false이거나 해제되면 늦은 UI 콜백을 실행하지 않는다. native 잠금은 원래 상태로 복원한다.

## 결과와 관찰

media type/protocol·응답 상태/outcome을 검증한다. 409/conflict와 422/invalid를 서로 바꿔 해석하지 않는다. 401/403은 denied이며 그 밖의 잘못된 응답·전송 오류는 unknown이다. 저장 요청 전 준비 오류와 이미 진행 중인 요청은 not-sent다. 정확한 업무 성공 조건은 도메인의 전체 ACK 검증 책임이다.

기본 관찰 제한은 30초다. fetch, response.json, 소비자 Promise가 abort를 무시해도 send Promise는 취소/제한 시점에 종료하며 늦은 응답이 새 요청의 잠금을 풀지 못한다. 계정 범위 이벤트/외부 AbortSignal/실제 pagehide/해제를 관찰한다. bfcache persisted pagehide는 연결을 유지한다. 중단은 서버 롤백이 아니다.

전송기 자체는 한 번의 요청을 관찰하며 영구 unknown 잠금이나 충돌 병합을 결정하지 않는다. 관련 폼은 `form-session.md`의 lease/resource/문서 세션을 연결한다. 업무 전체 ACK가 확인된 뒤의 조회는 공통 읽기 세션으로 분리하고 쓰기를 반복하지 않는다.

## 검증

`forms.test.mjs`는 기존 native 입력/disabled/폼 해제 계약, `json-forms.test.mjs`는 메서드·정확한 JSON 복사본·URL/응답 분류·비협조적 비동기 종료·문서 세션 복구 경계를 검사한다. 실제 React 소비자는 `useTaskWrites.test.ts`와 브라우저 시나리오로 검증한다. 이 런타임 변경은 모든 여섯 서비스의 회귀 대상이며 서버 멱등성/실운영 성공을 단위 검사로 주장하지 않는다.
