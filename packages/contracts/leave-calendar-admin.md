# 달력 관리자 강제 연차 계약

## 현재 범위

`/Leave?handler=AdminForceAdd`와 `AdminForceDelete`의 기존 native POST, antiforgery 및 서비스 DB/업무 처리를 유지한다. `Accept: application/vnd.company.workspace-form+json`일 때 `workspace-form-v1` 응답을 반환한다. 정상 달력의 두 폼은 `leave-calendar-admin.js`에서 공통 CompanyForm/CompanyDialog/CompanyState에 연결한다. 날짜 상세 프레임과 승인 후 숨김은 `leave-day-detail.md`의 공통 native 연결을 사용한다. 다른 업무 UI·운영 이관 완료를 뜻하지 않는다.

## 화면과 초안 수명주기

- 실제 폼은 현재 관리자 ID·기존 스냅샷·전체 달력/목록 필터를 보낸다. 삭제 칩의 AdminTarget은 문자열 신청/직원 ID, 실제 스냅샷·상태·전체 사용일·신청 사유·차감 일수다. 관리자 편집 가능 화면에서만 출력하며 HTML 속성을 Razor로 인코딩한다. 표시용 데이터는 서버 인가를 대신하지 않는다.
- 추가 폼에서 대상 날짜를 직접 볼 수 있다. 날짜 재선택은 깨끗한 폼의 기본값만 바꾸고 기존 추가 초안을 덮어쓰지 않는다. 초기화는 해당 추가 초안만 공통 확인 후 지운다. 직원은 기존 공통 로컬 선택기를 사용한다.
- 삭제는 공통 `CompanyDialog.present`와 `.cw-dialog-form`/`.cw-confirm`으로 직원·전체 사용일·신청 사유·번호·삭제 사유를 함께 확인한다. 여러 사용일은 각각 줄바꿈한다. Escape/닫기는 사유 초안을 보존하고 상단 이어쓰기에서 재개한다. 다른 신청으로 바꿀 때는 이전 삭제 사유를 버릴지 확인한다. 사유 필수 여부는 서버의 기존 보안 설정과 맞춘다.
- 공통 폼이 native POST·CSRF·timeout·계정 변경/해제를 관리한다. 도메인 어댑터는 확인 전후 대상과 제출값, 응답의 모든 업무 필드·이전/이후 기준값·전체 날짜·이동 경로/중복 필터를 검증한 뒤에만 입력 기준을 갱신한다. 클라이언트가 직접 fetch/재전송하지 않는다.
- 신청·취소·외부 일정 어댑터는 강제 작업의 실제 초안과 진행 상태를 참조한다. 기본 날짜를 미저장 초안으로 혼동하지 않는다. 진행 중 다른 POST·달력/목록 교체를 막으며 시작한 달력 GET의 늦은 응답이나 오류 redirect로 새 초안을 버리지 않는다. 반대로 다른 흐름의 진행 중에도 강제 작업을 시작하지 않는다.
- 삭제와 관계없는 추가 초안, 다른 신청/외부 일정 초안은 확인된 저장 뒤에도 보존한다. 해당 초안이 남으면 자동 문서 이동 대신 새 탭 내역 GET 링크를 제공한다. 저장 미확정은 자동 재실행하지 않으며 현재 문서의 반복 쓰기를 잠근다. 422 invalid만 수정 후 다시 확인할 수 있다.
- 동적 폼 제거 시 공통 컨트롤러를 dispose하고 진행 중 응답을 무시한다. 계정 변경은 사유 확인창도 닫는다. 탭 닫기 경고는 native beforeunload를 유지한다. 강제로 제거한 DOM·닫은 탭의 영구 초안 복구나 서버 롤백을 보장하지 않는다.
- 독립 초안의 순차 저장은 `form-session.md`의 공통 세션으로 조정한다. 확인된 작업은 다른 초안을 풀고 삭제한 신청의 이전 기준값만 소모한다. 관리자 추가의 변경 없는 입력은 재전송하지 않으며 명시적 초기화/변경된 새 의도를 구분한다. 미확정 결과는 여전히 문서 전체 쓰기를 잠근다. 늦은 달력/내역 GET은 작업 revision을 대조한다.

## 입력과 인가

- 공통 요청은 정확히 하나의 `expectedEmployeeId`와 `expectedSnapshot`을 제출한다. 현재 로컬 관리자 ID와 대조한다. 추가의 스냅샷은 빈 문자열, 삭제는 `LeaveRequestSnapshot.Compute`다. 승인·직원 취소·달력과 같은 전체 신청 기준값이며 월 밖의 날짜 변경도 감지한다.
- 추가 필드는 `ForceInput.EmployeeId`, `ForceInput.Date`, `ForceInput.Portion`, `ForceInput.Reason`이다. 삭제 필드는 `ForceDeleteRequestId`, `ForceDeleteReason`이다. 각 필드는 한 번만 제출하고 해당 작업의 바인딩 오류만 검사한다. 같은 Razor 모델의 미제출 신청/외부 일정 필드 오류는 이 폼의 오류가 아니다.
- 관리자 역할과 삭제의 `SecurityPolicyService.EnsureCanForceDelete`를 서버에서 검증한다. Portal 관리자 → Leave Master 투영은 기존대로다. 회사 마스터 대상 신청 삭제는 관리자 승인 화면의 보호 규칙과 맞춘다.
- 강제 추가 대상은 목록과 동일한 활성 실제 직원이다. 공용 계정·회사 마스터·비활성 계정을 조작한 POST로 추가하지 못한다. 관리자는 비공개 실제 직원을 계속 관리할 수 있다. 대신보기에서는 UI의 읽기 전용 규칙에 맞춰 POST도 거부한다.
- 과거/휴일도 관리자가 기록할 수 있다. 하루 1일, 오전/오후 0.5일, 특수휴가/기타/생일연차 0일이며 즉시 Approved로 기록한다. 생일연차는 생일 정보가 필수이고 사유를 남긴 관리자는 기간·재직·연 1회 제한을 예외 처리할 수 있다. 같은 날짜의 Pending/Approved/CancelRequested 및 반차 겹침 검사는 유지한다. 관리자 자기 대상 강제 작업은 일반 자기 승인 금지와 달리 기존 허용 정책을 유지한다.
- 사유 필드는 존재해야 하지만 값의 필수 여부는 기존 보안 설정에 따른다. 필수 해제 시 빈 사유는 `사유 미입력`으로 정규화한다.

## 저장 확인

성공 응답은 `protocol`, `outcome: saved`, `message`, `data`를 갖는다. `data`의 필드:

- `operation`: `AdminForceAdd` 또는 `AdminForceDelete`
- `actorEmployeeId`, `targetEmployeeId`, `id`: 십진 문자열. JS Number로 변환하지 않는다.
- `previousSnapshot`: 추가는 빈 값, 삭제는 제출 전 전체 신청 SHA-256. `snapshot`: 추가 후 실제 DB 재조회 해시, 삭제는 빈 값.
- `previousStatus`: 추가는 null, 삭제는 원래 상태. `status`: 추가는 `Approved`, 삭제는 `deleted`.
- `reason`: 정규화된 관리자 작업 사유. 삭제 대상 신청의 원래 신청 사유와 혼동하지 않는다.
- `calculatedDays`: 불필요한 소수점 0을 제거한 invariant 십진 문자열.
- `dates`: 전체 신청 날짜의 `{date: yyyy-MM-dd, portion: enum 이름}` 배열. 삭제는 클릭한 하루가 아닌 신청 전체를 지운다.
- `navigateTo`: `/Leave/Index` 로컬 GET 경로와 기존 달력/목록 필터. 추가는 추가 날짜의 월로, 삭제는 기존 필터로 돌아간다.

업무 서비스의 저장·감사·알림이 끝난 뒤 성공을 반환한다. SQLite의 DateTime.Kind 및 decimal 표현이 추적 중 객체와 달라질 수 있으므로 신규 기준값은 `AsNoTracking` 재조회로 만든다. tracked `ReloadAsync`만으로 같은 tick의 Kind까지 치환된다고 가정하지 않는다. 기존 공유 해시 정의를 변경하지 않아 이전 승인/취소 화면의 기준값 호환을 유지한다.

## 오류·호환·한계

- 확실한 사전 입력 검증은 422 invalid, 역할/삭제 권한은 403 denied, 계정/스냅샷/대상 불일치는 409 conflict다. 일반 쓰기 예외는 로그에 남기고 500 unknown으로 반환한다. 모두 no-store다.
- typed `LeaveRequestValidationException`은 알려진 사전 업무 검증에만 사용한다. 업무 저장 뒤 감사/알림 실패 또는 이후 결과 재조회 실패는 일부 반영됐을 수 있다. 재전송/롤백으로 안내하지 않는다. 권한/기준값 확인 중 DB 조회 장애 등 handler 쓰기 영역 밖 오류 전체를 이 계약으로 감싼 것은 아니다.
- native 성공 redirect는 유지하며, enhanced가 아니고 두 기준 필드도 없는 구형 화면은 기존 호환 경로다. 어느 기준 필드라도 있으면 전체 기준 대조를 요구한다.
- native 실패는 해당 작업의 허용 필드 원문 배열만 Razor 인코딩으로 보관하고 강제 추가/삭제 폼·버튼을 숨긴다. 새 탭 GET 확인을 제공한다. 인증 토큰·임의 POST 값·내부 예외를 원문에 포함하지 않는다. 다른 업무 초안이나 탭을 닫은 뒤의 영구 보관은 제공하지 않는다.
- 기존 강제 삭제의 배정 제거·가불 상환 복원·감사·알림을 유지한다. 해시 대조는 읽기 시점 검사이지 DB 원자적 CAS나 영구 멱등성이 아니다. 별도 탭의 동시 처리/기존 native 재전송을 완전히 막는 보장이 아니다.

## 검증

`LeaveCalendarAdminTests.cs`는 실제 격리 Portal SSO/Leave/SQLite로 생성/삭제 왕복, 큰 ID, 전체 날짜/상태, 역할/CSRF/기준값/중복 입력/대신보기, 직원 정책, 과거일·반차 충돌·사유 설정, 삭제 배정/상환, 저장 전/후 실패와 native 원문 복구를 검사한다. 실제 연차 계산 과정이 만든 지급 내역은 보존하고 테스트가 만든 지급 건만 확인한다.

`leave-external-recovery.spec.mjs`는 외부 일정과 관리자 추가/삭제의 실제 실패 Razor를 같은 검사로 읽는다. 320/1440px·light/dark, 공통 상태/의미 색·가로 넘침·원문 인코딩·쓰기 UI 부재·새 탭 GET을 검사한다. `checkLeaveCalendarAdminServer`와 변이 검사는 대표 계약 누락/우회를 잡는 보조 검사이며 실제 인가나 전체 UI 완료를 증명하지 않는다.

`CalendarAdminRazorConnectsActorCompleteRequestAndCommonForms`는 현재 관리자/스냅샷/CSRF/사유 설정과 실제 전체 날짜 칩을 검증하고 격리 브라우저 fixture를 만든다. `leave-calendar-admin.spec.mjs`는 공통 추가/삭제 확인, 날짜·삭제 사유/다른 폼 초안, 기본 날짜·동적 폼 재연결, 정확한 응답/422·미확정, 계정/해제/timeout/DOM 제거·늦은 GET·경쟁 POST 및 두 폭/두 테마를 검사한다. `checkLeaveCalendarAdminClient`의 마커와 변이 검사는 대표 우회 감지일 뿐 브라우저/인가 검증과 별개다.
