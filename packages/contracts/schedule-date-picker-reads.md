# 팀 일정 날짜 선택기 공휴일 조회

`DatePicker`는 열린 달력의 6주 범위 공휴일을 `WorkspaceReadSession`의 `date-picker-holidays` 채널에서 `scheduleGet`으로 조회한다. 첫 날짜와 42번째 날짜를 `from`·`to`로 보내며 지원 범위 바깥은 `0001-01-01`과 `9998-12-31`로 제한한다.

응답은 `absencesResponse`로 전체 구조를 확인한 뒤 공휴일만 표시한다. HTTP 오류, JSON이 아닌 응답, 리디렉션, 잘못된 날짜·휴일 구조는 정상 결과로 적용하지 않는다. 조회 실패 또는 `holidaysAvailable`이 참이 아니면 주말 표시는 유지하고 명시적인 다시 시도를 제공한다.

달력 닫기, 월 변경, 다시 시도, `workspace-entity-scope-change`, 컴포넌트 해제 시 기존 `date-picker-holidays` 조회를 취소한다. 취소됐거나 현재 ticket이 아닌 늦은 결과는 공휴일·오류·로딩 상태를 바꾸지 않는다. 범위 변경은 열린 공통 모달도 닫고 이전 계정의 공휴일을 지운다.

이 계약은 GET 관찰 수명주기만 다룬다. 날짜 선택·삭제와 업무 저장, 서버 API·DB·권한 계약은 변경하지 않는다.
