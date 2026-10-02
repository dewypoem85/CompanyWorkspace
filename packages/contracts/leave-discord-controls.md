# 연차 Discord 개인 알림 컨트롤

`/Settings/Discord`의 개인 DM 활성화와 수신 유형은 native checkbox 의미를 유지하면서 공통 `cw-check-control`/`cw-checkbox`를 사용한다. 공통 primitive가 라이트·다크 배경, 선택·hover·focus·disabled 상태와 실제 입력 크기를 소유한다.

## 화면과 저장 경계

- `discordDmEnabled`는 같은 이름의 hidden `false` fallback과 함께 전송한다. `selectedTypes`는 서버가 렌더링한 카탈로그의 여러 값을 그대로 전송한다.
- 옵션의 제목·설명과 2열/모바일 1열 배치는 Leave가 소유한다. 앱 CSS는 공통 배경·테두리·선택·focus 색 또는 checkbox 크기와 accent를 복제하지 않는다.
- Discord 미연동이면 활성화·수신 유형과 저장 버튼이 실제 native disabled다. 공통 disabled 상태는 이를 시각화할 뿐 서버 인가를 대신하지 않는다.
- Save/Unlink/Test의 `CompanyForm`·`CompanyState`·`CompanyDialog`, 현재 직원/설정 fingerprint, OAuth native 이동과 수신 카탈로그 정규화는 기존 계약을 유지한다. 스타일 전환을 저장·전송 성공으로 취급하지 않는다.

## 검증

`checkLeaveDiscord`는 두 템플릿의 공통 class, 공통 primitive 원본과 앱별 checkbox skin 재도입을 검사한다. `leave-discord.spec.mjs`는 실제 Razor에서 320/1440px·라이트/다크의 선택/비선택 계산 색, 18px 입력, 문서 폭, 미연동 disabled와 기존 저장·초안·확인·늦은 응답 경계를 함께 검증한다. 운영 Discord/DB는 사용하지 않는다.
