# 자동 필터 이동 계약

값 변경 즉시 목록을 다시 조회하는 GET 필터는 inline `onchange`나 `form.submit()`을 직접 사용하지 않고 `data-cw-auto-submit`을 선언한다. 공통 navigation 런타임이 bubbling `change`를 받아 native `requestSubmit()`으로 제출하므로 숨김 query와 브라우저 제약 검사를 그대로 유지한다.

- GET 폼에만 사용할 수 있다. 쓰기 POST/PUT/PATCH/DELETE를 자동 실행하지 않는다.
- control이 disabled이거나 이벤트가 취소됐거나 폼이 `aria-busy="true"`이면 제출하지 않는다.
- 명시적인 조회 버튼은 JavaScript 실패와 키보드 사용을 위한 fallback으로 유지할 수 있다.
- 직원 picker는 원래 local 직원 ID 값을 선택한 뒤 같은 change 이벤트를 발생시킨다. 표시용 회사 ID나 이름으로 query를 다시 만들지 않는다.
- 자동 이동은 저장 성공, 쓰기 재시도 또는 계정 범위 갱신을 뜻하지 않는다. 초안이 있는 업무 화면에서는 해당 화면의 명시적 이동 확인 계약을 먼저 적용한다.
