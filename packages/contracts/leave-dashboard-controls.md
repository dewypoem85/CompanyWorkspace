# 연차 신청·날짜 상세의 공통 컨트롤

`Leave/Index`의 일반 입력·버튼은 `native-fields.md`의 명시적 primitive를 사용한다. `_SelfActionForm`의 목록 취소·철회와 날짜 상세의 동적 수정/삭제 버튼도 같은 소유자에 연결한다. 페이지별 기본 색·포커스·disabled·모서리·최소 높이를 복제하지 않는다.

## 유지하는 경계

- `cw-form-fields`와 `cw-form-field`가 일반 폼의 배치·라벨·축소를 제공한다. 신청은 PC 3열/모바일 1열, 관리자 추가와 외부 일정은 공통 2열/모바일 1열을 사용한다. 사유/인수인계·메모는 전체 열이며 원문을 읽을 수 있는 textarea 높이만 Leave가 정한다.
- 필드의 기존 이름/ID·유형·required/min/max/maxlength·hidden 기준값·CSRF와 선택값을 보존한다. 입력 클래스는 서버 검증이나 저장 수명주기를 대신하지 않는다.
- 대신보기·관리자/외부 일정의 직원 select는 기존 `data-company-picker="employee" data-company-local="true"`를 유지한다. native select의 값과 회사 프로필 ID를 혼동하지 않으며 초성 검색은 공통 선택창이 소유한다.
- 목록의 취소·철회와 동적 상세의 수정/삭제는 compact 버튼이다. 강제 삭제/외부 일정 삭제는 danger, 신청/추가는 primary이며 실제 disabled가 공통 표시를 결정한다. 문자열 조립 시 기존 HTML 인코딩 및 ID/snapshot/날짜 원문 전달을 유지한다.
- 닫기/초기화/공통 확인창·초안·복수 폼 전송은 `leave-day-detail.md`, `leave-application.md`, `leave-self-actions.md`, `leave-calendar-admin.md`, `leave-external-schedules.md`와 `form-session.md`를 따른다.
- 조회용 연도/월·표시 개수/페이지 필드도 공통 입력을 사용하되 기존 GET·기간/페이지 이동과 native min/max 검증은 유지한다. native checkbox, 이동 링크, 달력의 7열 구조·업무 카드 및 신청 내역 표까지 모두 공통화한 것으로 확대하지 않는다.

## 검증

실제 TestServer/Razor/격리 DB로 생성한 화면에 합성 HTTP를 연결한다. `support/leave-controls.mjs`가 실제 입력/동적 버튼의 공통 클래스·라벨·계산 색·모서리·높이·disabled 및 컨테이너 폭을 검사한다. 신청/취소·관리자/외부 일정의 PC/모바일·두 테마 검사와 전체 Leave 브라우저 회귀를 실행한다. 공통 자산을 수정하면 다른 다섯 소비 앱도 검사하며, 이번 앱 전환 결과를 운영 SSO/배포 완료로 보고하지 않는다.

실제 감소분만 `ui:debt:prune`으로 정리한다. 정적 primitive 검사에 새 예외를 추가하지 않는다.
