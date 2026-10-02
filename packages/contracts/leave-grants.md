# 연차 보정·발생분 관리 계약

## 현재 전환 범위

`/Admin/Adjustments`의 보정·추가·삭제는 `leave-grants.js`에서 `CompanyForm`/`CompanyDialog`/`CompanyState`와 하나의 작업 세션에 연결한다. native 필드·버튼·표와 직원 검색/프로필은 공통 UI를 사용한다. `leave-grants-contract.js`는 정밀한 값·날짜·전체 응답이라는 Leave 도메인 계약만 소유하며 전송/확인/세션을 복제하지 않는다. 기존 handler·native POST/CSRF 및 JS 없는 복구 경로를 유지한다.

## 읽기와 기준값

- `GET ?handler=Baseline&employeeId={로컬 직원 ID}`는 페이지의 AdminOnly와 현재 관리자 검증을 유지한다. `no-store`, `protocol: leave-grants-v1`, 문자열 `actorEmployeeId`, `actorName`, `today`, `employeeId`, `employeeName`, `employeeSnapshot`, `defaultDate`, bool `reasonRequired`/`canDelete`, `grants: [{grant,snapshot,allocated,settled,remaining}]`를 반환한다. 모든 일수는 정규화한 십진 문자열이다. 현재 문서의 요청자·날짜·권한 설정, 정확한 직원/발생분 ID와 잔여량 산술을 확인한다.
- 공용/회사 마스터는 제외한다. 관리자는 비공개 직원과 퇴사 직원의 과거 기록을 보정할 수 있다. 정산 화면의 **재직 직원만 허용** 규칙과 혼동하지 않는다.
- 직원 fingerprint에는 정확한 ID·회사 연결·이름·메일·입사일·재직/공용/마스터/비공개 상태가 포함된다.
- `LeaveGrantSnapshot`에는 발생분 전체 기본값과 생성 ticks, 모든 배정 및 해당 신청 상태, 정산 ID·유형·일수·파생 발생분/가불 신청 연결이 포함된다. 취소된 신청의 배정도 삭제 제한과 같은 범위로 읽는다.
- 정산도 이 공통 발생분 hash에 조회일과 가용량을 더해 사용한다. 이전 정산 hash와 형식은 다르므로 전환 전 열린 enhanced 폼은 충돌 후 최신 GET이 필요하다. DB 스키마·계산 방식은 바꾸지 않는다.
- 같은 직원·발생 유형·발생일의 기존 발생분이 없으면 이전 snapshot은 빈 문자열이다. 빈 문자열과 누락 필드를 구별한다. 기준값은 인증·원자적 DB CAS·영구 멱등성 키가 아니다.

## 쓰기

기존 POST/default, `?handler=AddGrant`, `?handler=DeleteGrant`와 antiforgery를 유지한다. `Accept: application/vnd.company.workspace-form+json`을 보낸 enhanced 요청은 아래 세 값이 각각 정확히 하나 필요하다.

업무 저장과 같은 트랜잭션에서 대상 직원의 현재 연차년도 지급·사용·배정·가불을 재계산한다. 양수 발생분은 기존 가불을 먼저 실제 신청 배정으로 전환하고, 음수 발생분·보정 회수는 순지급량을 줄여 실제 부족분을 가불로 전환한다. 같은 연차년도의 중복 가불 차감 정산은 제거하지만 이전 연차년도의 가불을 다음 연차에서 갚은 정산은 보존한다. 이 재계산 결과로 배정과 가불 필드가 바뀌므로 확인 응답의 발생분 snapshot은 재계산 이후 값을 사용한다.

- `expectedEmployeeId`: 현재 요청자(대상 직원이 아님).
- `expectedEmployeeSnapshot`: 대상 직원 fingerprint.
- `expectedSnapshot`: 정확한 대상 발생분 fingerprint 또는 빈 슬롯의 빈 문자열.

어떤 expected 필드라도 보낸 native 요청도 같은 검사를 수행한다. 기준값이 전혀 없는 구형 native 요청은 기존 호환 경로다. 모든 경로에서 현재 서버 인가·직원 제외 정책·업무 입력 검사를 별도로 수행한다. 각 작업은 자신의 필드만 파싱/중복 검사하며 다른 폼의 필드는 저장에 사용하지 않는다.

| 작업 | 입력 | 유지되는 업무 규칙 |
| --- | --- | --- |
| Adjust | EmployeeId, Days, EffectiveDate?, Note? | 0이 아닌 0.5일 단위, 음수 허용. 같은 직원·Manual·기준일에 합산. 없으면 생성. 기준일 1년 후 전날 만료로 설정하고 메모 누적. |
| AddGrant | AddEmployeeId, AddGrantType, AddGrantedDate, AddExpiresDate?, AddDays, AddNote? | 다섯 기존 발생 유형, 음수 허용. 동일 직원/유형/발생일 중복 거부. 명시 만료일 또는 1년 후 전날. |
| DeleteGrant | grantId, DeleteGrantReason? | 기존 `EnsureCanForceDelete` 정책. 모든 배정 합계 또는 정산 합계가 0이 아니면 거부. |

사유 필수 여부는 서버 설정을 따르고 생략 허용 시 `사유 미입력`으로 정규화한다. 날짜·enum·정밀한 decimal 입력과 보정 합계 overflow는 쓰기 전 검증한다. 일수는 JS Number로 ID와 함께 처리하지 않는다. 윤년은 .NET `DateOnly.AddYears(1).AddDays(-1)` 의미다(2024-02-29 → 2025-02-27).

## 확인 응답과 실패

`workspace-form-v1 / saved`는 업무 쓰기 **및 이후 감사 기록**이 모두 끝난 뒤에만 반환한다. data에는 operation, 문자열 요청자/대상 ID, employeeSnapshot, previousSnapshot, snapshot, grant, beforeDays, inputDays, reason, 정확한 `/Admin/Adjustments?employeeId=...` 경로를 담는다.

`grant`는 문자열 id/employeeId/sourceGrantId(없으면 null), type, yyyy-MM-dd 날짜, 십진 문자열 days, note, isImported다. 삭제는 삭제 전 값과 빈 새 snapshot을 반환한다. 나머지 저장은 실제 DB 재조회 값과 hash를 반환한다. 추가는 원래 정책대로 선택 유형이 Imported여도 isImported=false다.

422는 알려진 쓰기 전 입력 거부, 409는 누락·변경된 기준값/대상, 403은 권한 거부다. 쓰기 이후 예외는 500 unknown이며 비공개 예외는 서버 로그에만 기록한다. 기존 보정 트랜잭션과 추가/삭제 저장 뒤 감사 경계를 유지하므로 감사 실패에도 업무 DB는 이미 반영될 수 있다. 자동 재전송·롤백 성공 안내를 하지 않는다.

native 실패는 허용한 업무 입력만 JSON으로 보관하고 Razor HTML 인코딩한다. 임의 POST 키·CSRF·내부 예외는 원문 블록에 포함하지 않는다. 실패 화면에서 변경 폼을 다시 활성화하지 않고 최신 내역 새 탭 GET을 제공한다. JS가 없어도 오류와 원문을 읽을 수 있다. 해당 원문은 영구 저장이나 서버 저장 확인이 아니다.

## 실제 편집기와 독립 초안

확인 전에 요청자/대상/기준값/입력을 캡처하고 전체 ACK를 검사한다. 같은 직원·유형·기준일·이전 hash를 보정/추가/삭제가 공유하는 리소스로 취급하여 처리된 이전 기준값은 재사용하지 않는다. 다른 직원/발생분의 초안은 확인된 저장 뒤 이어 쓸 수 있다. 미확정 쓰기는 문서를 잠그고 새 탭 GET만 제공한다. 422 사전 거부는 입력을 교정할 수 있지만 성공·권한 거부·충돌·미확정과 구분한다.

- 직원별 조회 결과와 실제 행 DOM을 문서 동안 보관한다. 목록을 왕복해도 각 행의 삭제 사유와 보정/추가 초안은 유지한다. 최초 Razor 행과 후속 조회 행은 같은 `_GrantRow.cshtml`을 사용한다. 데이터는 고정된 셀에 textContent로 표시한다.
- 목록 GET 실패는 기존 표와 선택으로 복귀하며 수동 조회만 재시도한다. 공통 `CompanyReadSession`의 직원별 `leave-grant:{employeeId}` 채널이 15초 읽기 관찰 제한·취소·최신 요청 판정을 맡고, 공통 작업 revision과 함께 늦은 응답을 배제한다. 같은 직원의 동시 조회는 기존 진행 promise를 공유하며 읽는 동안 쓰기를 시작하지 않는다.
- 명시적으로 편집한 기준일·만료일은 직원 선택으로 덮지 않는다. 저장 후 자동 GET이나 새로운 hash로 초안 재결합을 하지 않는다. 처리한 표는 조회 당시 스냅샷임을 안내하고 최신 내역은 새 탭에서 확인한다.
- 확인/전송 중에는 다른 폼과 직원 목록을 잠근다. 취소는 포커스와 초안을 복원하고, 계정 변경·timeout·화면 해제/폼 제거 뒤 늦은 응답은 반영하지 않는다. 관찰 timeout은 서버 롤백이 아니다.
- 직원 선택·표 제목·확인창의 사진은 공통 로컬 직원→회사 ID 매핑을 따른다. 매핑 없는 로컬 ID를 회사 ID로 추정하지 않고 이름 이니셜로 표시한다.

검증은 `LeaveGrantManagementTests.cs`의 실제 격리 SSO/SQLite HTTP 왕복과 Razor fixture, `leave-grants.spec.mjs`의 여섯 저장 순서·두 테마/폭·독립 초안·실패/늦은 응답·native 색상/프로필, `leave-grants-values.test.mjs`의 큰 ID/정밀 일수/윤년/전체 ACK, 정산/셸/native 복구 회귀와 구조 위반 변이 검사를 사용한다. 정적 marker 검사는 모든 우회나 동시 쓰기를 증명하는 보안 경계가 아니다.
