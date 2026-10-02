# 연차 날짜 상세창의 공통 소유권

월간 달력의 날짜 상세는 기존 Razor `calendarArea` 안의 native `<dialog class="cw-modal">`이다. `CompanyDialog.attach`가 열기·닫기·중첩 확인창·Escape·범위 변경·포커스를 소유하고 원래 연차/외부 일정 폼은 이동하거나 삭제하지 않는다. DB·서버 handler·인가·저장 계약을 변경하지 않는다.

## 진입과 종료

- 날짜 번호는 공통 compact 버튼이다. 마우스로 셀을 선택하거나 버튼에서 Enter/Space로 동일 동작에 진입한다. 신청 기간 선택 중에는 기존 시작/끝 날짜 선택을 유지한다.
- 제목에 먼저 포커스를 두고 native modal이 배경과 Tab 탐색을 격리한다. 제목과 닫기 버튼은 내부 스크롤 중에도 보이게 한다. 닫기·Escape·바깥 영역 클릭은 공통 `requestClose`를 호출한다. 창 내부 빈 여백 클릭은 닫지 않는다.
- 사용자 닫기는 진행 중인 문서 작업(`LeaveFormSession.pending`) 동안 보류한다. 위쪽 공통 확인창의 Escape는 확인 의도만 취소하고 날짜 상세는 남긴다.
- 승인한 의도를 실제 POST로 넘기는 기존 세 경로(본인 취소/철회·외부 일정·관리자 강제 작업)는 `LeaveDayDetail.close()`로 공통 연결을 해제한다. 이것은 승인 직후 상세를 숨기는 기존 흐름이며 전송/폼을 폐기하거나 서버 작업을 취소하지 않는다. 직접 class/aria-hidden을 바꾸지 않는다.
- 닫고 다시 열어도 관리자 추가·외부 일정의 초안과 hidden 기준값/CSRF는 같은 노드에 남는다. 날짜 재선택 시 깨끗한 폼만 초기화하는 기존 도메인 정책을 따른다. 다른 날짜를 선택했다고 작성 중인 내용을 덮지 않는다.
- `scope:'dismiss'`는 계정 범위 변경 때 상세창과 자식 확인창을 닫는다. 각 저장 어댑터가 권한/쓰기 잠금을 소유하고, 무효한 문서 세션에서는 상세를 다시 열지 않는다. DOM에 보관한 초안은 새 계정의 쓰기 권한이 아니다.
- 달력 GET으로 이전 노드가 교체되거나 일반 pagehide가 발생하면 연결과 자식 창을 해제한다. bfcache 보관은 유지한다. 포커스는 연결된 원래 날짜 버튼에만 복귀한다.

## UI 경계

공통 `.cw-modal`이 표면·글자·테두리·그림자·backdrop·viewport 한도를 소유한다. Leave CSS에는 최대 본문 너비, 내부 여백과 sticky 제목만 둔다. 옛 overlay/card/backdrop와 프레임별 다크 CSS는 제거한다. 본문의 일반 입력·작업 버튼은 `leave-dashboard-controls.md`의 공통 primitive를 사용하며 업무 카드·달력/표 등 남은 UI의 완료와 구분한다.

일반 직원·관리자·대신보기의 원래 서버 출력 조건을 유지한다. JavaScript 없이 날짜 팝업은 열리지 않으며 기존 신청 내역/native 폼 경로의 지원 범위를 확대했다고 주장하지 않는다. 날짜 내부 데이터·초안은 브라우저 저장소에 복제하지 않는다.

## 검증

- `LeaveCalendarAdminTests`: 실제 Razor native dialog/공통 연결·키보드 진입, 같은 폼의 actor/기준값/CSRF와 원래 POST 계약.
- `checkLeaveDayDetail`와 변이 테스트: 공통 연결·scope/해제·접근성 진입 누락, 직접 숨김 및 옛 프레임 CSS 복원 검출. 정적 문자열 검사는 전체 제어 흐름/인가 증명이 아니다.
- `leave-calendar-admin.spec.mjs`: PC/모바일·두 테마의 계산 색/viewport·Tab/Enter/Escape·복귀 포커스·초안/중첩 확인·scope·DOM 교체, 기존 관리자 쓰기/응답/재조회 회귀.
- 전체 Leave 브라우저 검사로 신청·취소·외부 일정·복수 폼 및 다른 페이지의 CSS 영향도 확인한다. 합성 HTTP와 실제 Razor를 사용하며 운영 계정/DB 검증과 구분한다.
