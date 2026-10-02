# 연차 대시보드 부분 조회 계약

`/Leave`와 `/Leave/Index`의 달력 이동·보기 설정과 내 신청 목록의 표시 개수·페이지 이동은 native GET을 유지하면서 JavaScript 활성 시 두 결과 영역만 교체한다. `자기것만 보기`/`다른 사람 연차도 같이 보기`도 이 달력 채널을 쓰며, 서버가 저장한 선호를 포함한 응답의 달력만 교체한다. 신청·취소·관리자 강제 처리·외부 일정 쓰기와 날짜 상세 UI의 계약은 변경하지 않는다.

- `CompanyReadSession`의 `leave-calendar`와 `leave-request-list` 채널이 각 영역의 15초 관찰 제한, 새 요청 취소와 최신 ticket 판정을 소유한다. 계정 범위 변경과 pagehide는 두 채널을 모두 취소하며 비지속 해제에서는 세션을 dispose한다.
- 페이지는 raw 네트워크를 소유하지 않고 `leave-dashboard-read.js`의 단일 checked transport를 호출한다. transport는 현재 출처의 `/Leave` 또는 `/Leave/Index` GET과 알려진 필터별 단일 query 값만 허용하고 fragment와 다른 경로·키·중복값을 거부한다. JSON이 아닌 `text/html`, same-origin credential, no-store와 redirect 거부를 사용하며 취소를 무시하는 늦은 body도 현재 ticket과 폼 revision을 통과하지 못한다.
- 응답은 요청한 ID가 정확히 하나이고 script를 포함하지 않으며 서버가 렌더링한 현재 로컬 직원 ID가 화면의 직원 ID와 일치해야 한다. 달력과 신청 목록은 각자 전체 영역을 검증한 뒤 한 번에 교체한다.
- 공통 Leave 폼이 확인·전송·미확정·무효 상태이거나 관리자/외부 일정 초안이 이동을 막으면 조회를 시작하거나 결과를 적용하지 않는다. 확인된 쓰기 뒤 시작된 이전 GET도 폼 revision이 달라지면 적용하거나 fallback 이동하지 않는다.
- 일시 오류는 기존 native GET 이동으로 복구한다. 이는 자동 POST 재실행이 아니며, JavaScript가 없을 때도 기존 링크와 GET 폼이 동작한다. 부분 조회 성공만으로 운영 데이터나 모든 연차 화면의 완료를 주장하지 않는다.
- 달력 교체 뒤에는 현재 `Year`/`Month`/`CalendarView`/`SelfOnly`/`ShowOthers` 값을 다른 업무 폼의 hidden 경로 필드에도 맞춘다. 단, 달력 GET 폼의 checkbox 뒤 `false` fallback은 변경하지 않는다. 관리자 대신보기는 직원별 잔액·신청 목록·쓰기 권한까지 달라지므로 달력 채널이 아니라 같은 서비스 공통 본문 라우터로 대시보드 본문 전체를 교체한다. 기존 초안 확인·계정/역할 검증·본문 스크립트 재초기화를 거치며, 서버 렌더링과 native GET fallback을 유지한다.

구조 검사는 두 공통 채널·계정/응답·폼 revision·해제 판정과 단일 checked fetch를 고정한다. 실제 생성 Razor를 사용하는 Leave 브라우저 검사는 달력/목록 갱신, 초안과 확인된 쓰기, 늦은 성공·실패, 모바일/테마를 함께 확인한다.
