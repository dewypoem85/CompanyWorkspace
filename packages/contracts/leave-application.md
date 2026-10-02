# 직원 연차 신청 계약

`/Leave?handler=Apply` 및 `/Leave/Index?handler=Apply`의 native POST/위조 방지 토큰을 유지한다. `CompanyForm`은 전송과 관찰, `CompanyDialog`는 실행 의도, `CompanyState`는 결과 표시를 담당한다. 날짜·근무일·충돌·가불·배정·감사/알림은 기존 Leave 서비스가 소유한다.

## 요청과 응답

- 입력은 `Input.StartDate`, `Input.EndDate`, `Input.Portion`, `Input.Reason`, `Input.WorkPlan`이다. 현재 보이는 직원 `expectedEmployeeId`를 제출하며 서버 현재 로컬 직원 ID와 문자열로 대조한다. 이 필드는 인가가 아니고 중앙 세션/직원 인가와 CSRF는 별도로 유지한다. enhanced 요청은 필수이며 값 없는 기존 native POST는 호환한다.
- 날짜/유형/업무 기록은 단일 값이고 모델 바인딩 오류·미정의 유형·중복 값은 쓰기 전에 거부한다. 업무 기록은 필수, 최대 2000자다. 생일연차는 하루·전후 30일·해당 생일 재직·혜택별 1회를 검증하고 0일 차감으로 저장한다. 기존 종료일 보정·반차 하루 제한·주말/공휴일 제외·중복 신청/잔여량/가불 정책은 유지한다.
- `application/vnd.company.workspace-form+json`의 `workspace-form-v1` saved 응답에는 `operation: Apply`, 문자열 `employeeId`, 문자열 양수 long `id`, `status: Pending`이 있다. `input`은 요청 날짜 범위/유형과 서버가 trim한 사유/업무 기록이며 `dates`는 정렬한 실제 신청 근무일/유형, `calculatedDays`는 문자열이다.
- 전체 대상·입력·날짜 목록·차감 일수·로컬 `navigateTo`를 확인한 뒤만 저장 결과를 반영한다. 64비트 ID를 JavaScript Number로 바꾸지 않는다. 이동은 같은 origin의 `/Leave` 또는 `/Leave/Index`, 허용된 단일 query 필드와 해당 날짜의 월간 보기/페이지 1이어야 한다. 본인 보기·다른 직원 표시·대신보기 ID·표시 개수는 전송 값과 대조한다.

## 실패와 초안 보존

- 확실한 입력 거부만 `LeaveRequestValidationException`으로 422 invalid를 반환하여 수정 후 재신청을 허용한다. 다른 예외는 내부 내용을 노출하지 않는 500 unknown이다. 기존 서비스는 신청 DB commit 뒤 감사/알림을 수행하므로 unknown이 DB 롤백을 뜻하지 않는다.
- 계정 불일치는 409이며 401/403, 충돌, 손상/불완전 응답, 통신/관찰 timeout 후에는 같은 문서에서 반복 쓰기를 잠근다. 새 탭에서 현재 신청 내역을 읽도록 안내한다. 자동 재전송이나 영구 멱등성을 제공하지 않는다.
- HTML 실패는 허용된 신청 필드만 JSON 원문으로 인코딩해 보관한다. 인증 토큰/내부 예외를 포함하지 않는다. invalid는 수정 가능하고 미확정/충돌은 잠근다. 원문 보관은 자동 재전송이나 서버 원본 복구가 아니다.
- 확인 취소와 신청 패널 닫기/다시 열기는 입력을 지우지 않는다. 확인/전송 중 달력에서 날짜를 변경하지 않는다. 계정 변경·화면 해제 뒤 늦은 응답을 적용하지 않으며 비동기 관찰 취소를 서버 취소로 설명하지 않는다.
- 성공 뒤 다른 native POST 폼에 바뀐 입력이 없으면 서버가 확인한 내역 URL로 이동한다. 다른 편집 초안이 있으면 그대로 두고 승인 대기 성공 안내와 새 탭 내역 링크를 제공한다. 연도/표시 개수 등 GET 필터 기본값은 미저장 업무 초안이 아니다.

## 적용 범위

이번 계약은 직원 신청 Apply에 적용한다. 취소 요청·취소 철회·달력 강제 추가/삭제·외부 일정은 `form-session.md`의 같은 공통 작업 세션에서 동시 쓰기와 독립 초안 순차 저장을 조정한다. 성공한 신청 입력은 읽기 전용으로 유지하지만 다른 폼을 잠그지 않고 달력은 상세 보기로 동작한다. 관리자 승인 전환은 `leave-approvals.md`를 따른다. DB 스키마·SSO·실제 휴가 정책·공개 URL을 통합하거나 전면 재작성하지 않는다.

검증: `LeaveApplicationTests`는 실제 격리 Portal SSO/Leave/SQLite/Razor 및 commit 후 감사 실패를 검사한다. `leave-application.spec.mjs`는 실제 Razor와 공통 런타임에서 확인/초안/정확한 응답/미확정/해제/반응형을 검사한다. 구조 마커 검사는 우회 실수를 발견하는 보조 장치이지 완전한 인가/동작 증명이 아니다.
