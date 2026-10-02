# Native POST 폼 경계

Razor/HTML의 literal `<form method="post">`는 raw 브라우저 변경 경로다. `native-post-boundaries.json` v2는 현재 검토된 소유 파일뿐 아니라 각 폼의 `asp-page`, `asp-page-handler`, `action`, `id`와 안정적인 `data-*-form`/`data-*-action` 표기를 조합한 identity를 봉인한다. 새 페이지의 POST 폼, 같은 개수 안에서 handler/action을 바꾼 폼, 퇴역한 identity와 정책 항목을 거부한다. 표기가 없는 폼과 submitter `formmethod="post"`, JavaScript `.method`/`.formMethod = 'post'`, `setAttribute('method'|'formmethod', 'post')`는 정규화한 표기의 SHA-256 identity로 계산하므로 동적 폼으로 우회할 수 없다.

- 등록은 안전 면제가 아니다. 각 identity는 범용 목록 문서가 아니라 구체 소비자 계약 하나를 가리켜야 한다. 계약은 CSRF/Origin, 현재 회사 계정·역할·대상, 제출 초안과 기준 버전, 중복 실행, 확정/미확정 결과, 전체 영수증, 범위 변경·해제 정책을 다룬다.
- 새 업무 저장은 먼저 공통 `CompanyForm` 또는 generated write transport와 소비자 계약에 연결한다. 페이지를 정책에 바로 추가해 검사를 통과시키지 않는다.
- `Auth/Launch`는 사용자가 시작한 회사 SSO를 외부 callback으로 전달하는 의도적인 native `form_post`다. 업무 데이터 저장과 구분하며 `sso-launch.md`의 검증된 action·단기 토큰 계약을 따른다.
- GET 필터는 POST 목록에 넣지 않고 `automatic-navigation.md`를 따른다. React/JavaScript transport와 서버 내부 호출은 각각 네트워크/쓰기 계약의 별도 경계다.
- 정적 identity 검사는 계산 문자열·프레임워크 런타임 반사, 서버 인가·트랜잭션·영수증 의미를 증명하지 않는다. 구조 변이, 서버 통합과 실제 브라우저 검사를 유지한다.
