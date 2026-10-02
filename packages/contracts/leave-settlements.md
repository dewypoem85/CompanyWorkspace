# 연차 소멸·이월·보상 계약

`/Admin/Settlements`는 같은 native POST/CSRF와 기존 정산 서비스를 사용한다. `leave-settlements.js`는 공통 `CompanyForm`, `CompanyDialog`, `CompanyState`, 작업 세션에 연결하는 도메인 어댑터다. 별도 fetch/확인창을 만들지 않는다.

## 화면과 입력

- 직원 검색은 공통 employee/local 선택기다. 로컬 직원 ID와 회사 프로필 ID는 별개이며 직원 검색은 발생분 목록만 필터링한다. 실제 POST 대상은 기존 `grantId`다. 초성 검색·프로필·비공개 정책을 공유한다.
- 등록 선택지는 재직 중인 실제 직원의 현재 유효한 잔여 발생분이다. 비공개 직원은 관리자에게 표시하고 공용 계정·회사 마스터는 대상에서 제외한다. 과거 정산/감사 기록은 삭제하지 않는다.
- 검색/발생분 변경은 사유·일수 초안을 유지한다. GET의 발생분별 잔여량/스냅샷 중 선택한 기준값만 제출한다. 잔여량은 조회 시점의 값이다.
- 공통 `cw-form-fields`/`cw-form-field`/`cw-form-control`/`cw-form-wide`, `cw-data-table`/`cw-table-scroll`과 직원/처리자 프로필을 사용한다. 도메인 CSS에는 패널·내역·원문 배치만 남긴다. 필드 규약은 `native-fields.md`다.
- `grantId`, `type`, `days`, `note`를 유지한다. enhanced 요청은 `Accept: application/vnd.company.workspace-form+json`과 정확히 하나의 `expectedEmployeeId`, `expectedSnapshot`을 보낸다. ID는 문자열, 일수는 서버 decimal이다.
- 사유 필수 여부는 `Security:RequireReasonsForSensitiveAdminActions`를 따른다. 미필수 설정의 빈 사유는 기존 `사유 미입력`으로 정규화한다. 보상은 정산 기록이며 실제 급여 지급이 아니다.

## 서버 경계

현재 관리자·CSRF·중앙 세션 검증을 유지하고 서비스에서도 관리자 및 대상 자격을 확인한다. `LeaveSettlementSnapshot`은 조회 기준일, 발생분 ID/직원/유형/기간/지급일수/출처/메모/이관 여부/가용량, 배정 목록과 신청 상태, 정산 목록을 해시한다. 정산 직전 현재값과 대조하고 날짜가 달라져도 다시 확인해야 한다.

정산과 선택적 이월 발생분을 저장한 뒤 같은 트랜잭션에서 대상 직원의 현재 연차년도 지급·사용·배정·가불을 다시 맞춘다. 소멸·보상으로 순지급량이 줄면 실제 부족분만 가불로 전환되고, 이월처럼 순지급량이 유지되면 가불 총량도 유지된다. 현재 연차년도의 중복 가불 차감 정산은 실제 신청 배정으로 정규화하며 연차년도 경계를 넘긴 상환 정산은 보존한다.

잘못된 enum/자동 가불 차감 유형, 0 이하 또는 0.5일 단위가 아닌 일수, 잔여량 초과, 필수 사유 누락은 저장 전 `LeaveSettlementValidationException`이다. 중복/누락/형식 오류를 기본값으로 처리하지 않는다. 대상/발생분 만료·삭제·변경과 기준값 불일치는 `LeaveSettlementConflictException`이다.

소멸/보상은 정산 일수를 원본에서 차감한다. 이월은 같은 트랜잭션에서 동일 일수의 발생분을 만들고 `CreatedGrantId`로 연결한다. 기간은 처리일부터 `AddYears(1).AddDays(-1)`까지다. 감사 기록은 커밋 뒤 저장한다.

스냅샷은 읽기 시점 대조이며 원자적 CAS·다중 탭 멱등성·동시 정산 중복 방지를 새로 보장하지 않는다. 검증과 트랜잭션 사이의 기존 경쟁 구간은 남는다.

## 확인 응답과 실패

`workspace-form-v1 / saved`의 `data` 전체를 검증한다.

| 필드 | 확인 조건 |
| --- | --- |
| operation | `Settle` |
| actorEmployeeId / employeeId | 화면 관리자 / 발생분 직원 문자열 ID |
| grantId / previousSnapshot | 제출한 발생분 / 스냅샷 |
| id | 새 정산의 양의 십진 문자열 ID |
| type / days / note | 제출 유형 / 정규화 일수 문자열 / 서버 정책대로 정규화한 사유 |
| processedDate | 조회·확인한 기준일 `yyyy-MM-dd` |
| createdGrantId | 이월이면 원본과 다른 양의 문자열 ID, 나머지는 null |
| navigateTo | 정확히 `/Admin/Settlements` |

확인 전 세션 lease를 확보하고 확인 후 입력·계정·문서를 다시 대조한다. 전체 응답이 맞으면 폼을 읽기 전용으로 보관하고 새 탭의 최신 내역 GET을 제공한다. 잔여량/새 발생분을 클라이언트가 임의 계산하지 않는다. 현재 화면은 편집 폼 하나이며 다음 정산은 최신 화면에서 한다.

확실한 422만 수정 후 다시 보낼 수 있다. 충돌·권한·통신·HTML·잘못된 응답·timeout/DOM 제거는 자동 재전송하지 않는다. 커밋 뒤 감사 오류는 결과 미확정이지 롤백이 아니다. 계정 변경/해제 뒤 늦은 응답을 배제하고 확인창/전송기/리스너를 정리한다. 초안과 진행 중 문서 이탈은 beforeunload로 보호하며 bfcache 보관은 실제 해제와 구분한다.

JS가 연결될 때만 enhanced 기준값을 추가한다. 구형/JS 미지원 native POST는 기준값 없는 호환 경로지만 현재 관리자·대상·업무 검증은 동일하다. native 실패는 `grantId/type/days/note` 원문만 Razor 인코딩으로 보관하고 쓰기를 잠근다. 임의 POST 필드·CSRF·내부 예외는 보관하지 않는다. handler 이전 프레임워크 거부나 네트워크 단절의 HTML 복구는 보장하지 않는다.

## 검증

`LeaveSettlementTests.cs`는 격리 SSO/SQLite에서 세 유형·큰 ID·이월 연결/기간·감사·실제 잔여량·재전송/배정/발생분 기준값·인가/대상·입력/CSRF·커밋 후 감사 실패·native 원문을 검증하고 실제 Razor fixture를 만든다. `leave-settlements.spec.mjs`는 초성 선택·확인/취소/포커스·전체 응답·실패·계정/DOM/해제/timeout·초안/전송 보호 및 두 폭/테마를 검증한다. 구조 변이 검사는 대표 누락 검출이며 인가/실제 시각 검증을 대신하지 않는다.
