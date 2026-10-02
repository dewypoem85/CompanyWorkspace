# 계정·알림·개인 설정 작업 버튼

로그인/서비스 진입, Portal 개인 설정·통합 알림, Leave 알림·Discord 설정·정산의 native 작업 버튼은 `cw-button`을 사용한다. 신규 버튼뿐 아니라 이전 화면의 별도 `button`/`btn` 스타일을 다시 추가하지 않는다.

## 실제 연결

- Portal 사진 저장은 primary, 기본 사진으로 변경은 danger, 브라우저 알림 요청은 기본 변형이다. 프로젝트 아이콘과 함께 `.cw-profile-actions`는 배치만 소유하며 별도 버튼 배경·모서리·disabled opacity를 정의하지 않는다.
- 통합 알림과 Leave 알림의 모두 읽음은 기본 변형, 각 항목은 compact를 사용한다. Leave 확인은 primary다. `data-center-*`, `data-notification-action`, 전체 문자열 식별자·native POST/CSRF·읽음 ACK 및 재조회 수명주기는 그대로 유지한다.
- Discord 연동/설정 저장은 primary, DM 테스트는 기본, 연동 해제는 danger다. OAuth/Bot/연동 여부에 따른 실제 disabled와 전송 중 fieldset disabled가 공통 비활성 색에 우선한다. OAuth native 이동, 공통 해제 확인, DM 테스트와 설정 초안의 구분은 바꾸지 않는다.
- Leave 정산은 조회가 아니라 기존 정산 POST 작업이다. primary 버튼과 기존 발생분·입력·확인/ACK/미확정 계약을 유지한다. 버튼 스타일 전환을 업무 처리 방식 변경으로 확대하지 않는다.
- Portal SSO 진입의 직접 이동 POST와 Leave 로그인 GET의 기존 form/action/hidden 값은 유지한다. Leave 로그인 handler는 정상 흐름에서 Portal로 redirect하므로 해당 Razor fallback 버튼이 실제 정상 로그인 화면에 표시된다고 주장하지 않는다.
- 일반 `<a>` 이동 링크, 사진 file 입력, 체크박스와 달력/초안 이탈 확인은 별도 경계다. 링크를 button으로 바꿔 키보드·새 탭/주소 복사 의미를 잃게 하지 않는다.

## 검증

`support/native-buttons.mjs`는 실제 소비자의 공통 클래스, 계산된 색·8px 모서리·기본 44px/compact 32px·부모 폭·disabled opacity를 검증한다. 일반 상태뿐 아니라 사진 저장/삭제 전후, Discord 전송 및 Leave 읽음 처리의 fieldset disabled 중에도 확인한다. 정적 class 대조만으로 완료하지 않는다.

`profile-form`, `portal-notification-ids`, `leave-notifications`, `leave-discord`, `leave-settlements` 브라우저 검사는 기존 저장/확인·초안·정확한 ID·키보드·후속 조회/실패 회귀를 유지한다. 실제 Razor/격리 HTTP/DB fixture를 재생성하고 두 테마·모바일/PC 캡처를 직접 확인한다. 사진 프레임 CSS는 공통 자산이므로 여섯 앱 전체 회귀 대상이다. 운영 OAuth/DM/사진·알림·정산 데이터를 테스트에 사용하지 않는다.

기존 primitive 부채는 실제 전환한 15회만 감소 전용 prune으로 제거한다. 남은 항목을 같은 버튼 전환이나 전체 목표 완료로 처리하지 않는다.
