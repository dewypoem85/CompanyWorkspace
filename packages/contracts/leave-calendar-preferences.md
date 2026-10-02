# Leave 달력 표시 선호 계약

`calendarMoveForm`은 `SaveCalendarPreference=true`와 역할별 toggle/fallback 값을 Razor에서 완전하게 렌더링한다. 관리자에게는 `SelfOnly`, 일반 직원에게는 `ShowOthers`만 제공하며 checkbox 뒤의 같은 이름 hidden `false` 값으로 해제 상태도 전송한다. 관리자 미리보기에는 어느 toggle도 노출하지 않는다.

표시되는 label은 `cw-check-control`, 실제 native checkbox는 `cw-checkbox`를 사용한다. 공통 primitive가 라이트·다크 배경, 선택·hover·focus·disabled 상태와 checkbox 크기를 소유하고 Leave는 달력 도구막대의 위치와 모바일 열 배치만 소유한다. 같은 기능에 앱별 배경·선택·포커스 색을 다시 추가하지 않는다.

공통 Leave 레이아웃은 `data-calendar-preference-toggle`의 변경 이벤트를 먼저 받아 완전한 native GET 값으로 URL을 만든다. 대시보드가 살아 있으면 같은 값의 단일 `SelfOnly`/`ShowOthers` 쿼리로 공통 부분 조회를 실행해 달력만 교체하고, 서버의 `SaveCalendarPreference` 저장 분기를 그대로 거친다. 확인 중인 저장·미확정 결과·관리자/외부 일정 초안이 이동을 막으면 선택 표시를 원복한다. 부분 조회가 불가능하거나 실패하면 기존 전체 GET이 복구 경로다. 페이지 전용 input·label, 별도 저장 POST나 자동 재시도는 만들지 않는다.

`checkLeaveCalendarPreferences`는 완전한 서버 markup, 공통 checkbox primitive, 레이아웃 바인딩과 기존 저장 분기를 검사한다. `leave-shell.spec.mjs`는 관리자·직원 각각의 정확한 native 다중 값 순서와 공통 계산 스타일을, `leave-view-filters.spec.mjs`는 실제 Razor 응답을 사용해 두 역할의 달력만 교체되는 흐름을 검사한다.
