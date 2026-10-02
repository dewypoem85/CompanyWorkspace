# 회사 SSO 시작 form_post 계약

`/Auth/{system}`은 로그인한 회사 계정이 허용된 서비스로 이동할 때만 서버에서 단기 HMAC 토큰을 만들고, 검증된 서비스의 고정 callback에 native `form_post`로 전달한다. 이 폼은 업무 데이터 저장 경계가 아니며 공통 비동기 저장 transport로 바꾸지 않는다.

- 서비스 키는 `CompanySystemCatalog`에 존재해야 하고 현재 계정에 해당 접근 권한이 있어야 한다. callback base URL은 설정된 절대 HTTPS URL만 허용하며 로컬 개발의 `localhost`/`127.0.0.1`만 HTTP 예외다.
- 토큰은 issuer, audience, 문자열 계정·세션 ID, 표시 정보, 계정 유형·비공개·역할·실효 권한, 발급/1분 만료 시각과 매번 새 UUID를 포함해 32자 이상 공유 키로 HMAC-SHA256 서명한다.
- return URL은 2048자 이하의 단일 슬래시 로컬 경로만 포함한다. `//` 또는 외부 URL은 버린다. 토큰과 callback을 URL query나 로그에 넣지 않고 `no-store` 응답의 hidden `token` 한 개로 전송한다.
- 자동 submit이 실패해도 같은 검증된 폼의 직접 이동 버튼을 제공한다. 대상 서비스가 서명·audience·만료·세션을 다시 검증하며, 브라우저의 form 전송 성공을 대상 로그인 성공으로 간주하지 않는다.

서비스 추가는 카탈로그·권한·환경 설정과 대상 callback 검증을 먼저 추가해야 한다. 임의 action 또는 페이지별 SSO 폼을 native POST 정책에 예외로 등록하지 않는다.
