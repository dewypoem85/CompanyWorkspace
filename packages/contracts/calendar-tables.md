# 공통 달력 표 계약

달력은 일반 업무 데이터 표의 모바일 카드 변형을 사용하지 않는다. 날짜의 행·요일 열 관계를 유지하면서 공통 구조만 강제하기 위해 `cw-calendar-table`을 사용한다.

## 연간 미니 달력

- `<table class="cw-calendar-table …" data-calendar-layout="year-mini" role="table">`로 렌더링한다.
- 각 달력은 `aria-label` 또는 `aria-labelledby`로 연도·월·용도를 구분한다.
- 모든 요일 머리글은 `<th scope="col">`이다.
- 공통 CSS가 폭, 고정 열 배치, 테두리 병합과 기본 글자색을 소유한다.
- 서비스는 날짜 셀 높이, 공휴일·주말·상태 색, 링크와 업무 미리보기를 소유한다.
- 달력 안에 다른 표를 중첩하지 않는다.

`npm run check`는 클래스만 추가하고 위 의미 구조를 누락한 표를 `native-table` 위반으로 처리한다. 실제 12개월 렌더링, 모바일 폭, 두 테마와 프로필 표시는 Chromium 검사로 확인한다.

## 월간 선택 달력

- `<table class="cw-calendar-table …" data-calendar-layout="month" role="table">`로 렌더링한다.
- 연간 달력과 동일한 접근 가능한 이름과 요일 `scope="col"` 규칙을 사용한다.
- 실제 날짜 셀은 `data-date`와 사람이 읽는 `data-date-label`을 함께 제공한다.
- 날짜 상세 진입은 셀 안의 공통 버튼 `data-day-detail-trigger`로 제공한다. 키보드 Enter 진입과 상세 모달 포커스는 기존 도메인 동작으로 유지한다.
- 공통 CSS는 전체 폭·고정 7열 배치·기본 글자색을, 서비스는 스크롤·셀 높이·선택 범위·공휴일·주말·상태 표시를 소유한다.

실제 Chromium 검사는 320/1440px·라이트/다크에서 구조와 계산 스타일, 프로필, 상세 진입·닫기, 문서 가로 폭을 확인한다.
