# Leave 외부 일정 변경 계약

## 적용 상태

외근·출장 등 연차를 차감하지 않는 관리자 전용 외부 일정의 화면/서버 계약이다. `/Leave?handler=ExternalScheduleSave`와 `ExternalScheduleDelete`의 native URL, DB, 감사 동작을 유지한다. `leave-external-schedules.js`가 `CompanyForm`/`CompanyDialog`/`CompanyState`에 연결하고 같은 handler에 `Accept: application/vnd.company.workspace-form+json`을 보낸다.

실제 달력 칩은 서버가 계산한 fingerprint를 전달하고 두 native 폼은 현재 관리자와 기준값을 제출한다. 추가/수정/삭제의 확인창은 직원·기간·구분·메모를 보여준다. 날짜 재선택/상세창 닫기는 초안을 유지하며, 다른 일정 편집과 초기화는 초안을 버릴 때 공통 확인을 받는다. 저장된 정확한 ID·새 fingerprint·정규화 입력으로 편집기를 갱신해 후속 수정을 update로 보낸다. 다른 초안과의 순차 저장 및 늦은 GET은 `form-session.md`, 공통 native 상세 프레임과 승인 후 숨김은 `leave-day-detail.md`를 따른다.

## 입력과 서버 경계

- 기존 중앙 세션, EmployeeOnly 및 antiforgery와 현재 로컬 직원의 `IsAdmin` 검증을 유지한다. 메뉴/버튼 숨김은 인가가 아니다.
- enhanced 요청의 `expectedEmployeeId`는 현재 **작업 관리자**의 로컬 직원 ID 십진 문자열이다. 대상 직원 ID와 구분한다.
- `expectedSnapshot`은 새 일정이면 빈 문자열 한 개, 수정/삭제이면 화면을 읽었을 때의 `IndexModel.ExternalScheduleFingerprint(item)` 한 개다.
- Save는 `ExternalInput.Id`가 비어 있으면 생성, 유효한 양수 long이면 수정이다. 바인딩 실패·음수/0·중복 ID는 422이며 생성으로 전환하지 않는다. 존재하지 않는 수정 대상은 409다.
- Delete의 `id`는 정확히 한 개의 유효한 양수 long이다. 같은 Razor 페이지의 다른 양식 바인딩 오류 때문에 정상 요청을 거부하지 않도록 처리 대상 필드만 검증한다.
- Save의 `ExternalInput.EmployeeId`, `StartDate`, `EndDate`, `Category`, `Memo`는 각 한 개다. 잘못된 날짜·역전 기간, 알려지지 않은 구분, 빈 메모 및 500자 초과는 저장 전 거부한다. 구분/메모는 Trim하여 저장한다.
- 기존 직원 정책을 유지한다. 공용 계정·회사 마스터는 대상에서 제외하고 관리자는 비공개 직원과 이력 관리를 위한 비활성 직원을 선택할 수 있다. 기존 관리자 대신보기의 외부 일정 관리도 유지한다.

fingerprint는 일정 ID·대상 직원·기간·구분·메모·작성/수정 관리자·작성/수정 시각 ticks의 SHA256이다. UTC 시각의 ticks로 SQLite 왕복의 DateTime.Kind 차이를 정규화한다. 직원 표시명/프로필은 일정 내용 버전에 포함하지 않는다. 이것은 **읽기 시점 대조**이며 원자적 DB CAS·인가 토큰·영구 멱등성이 아니다. 읽기와 저장 사이의 경쟁 구간은 남는다.

## 확인 응답

`workspace-form-v1` envelope의 `outcome: saved`와 아래 data를 반환한다. 큰 ID는 JSON 숫자로 바꾸지 않는다.

| 필드 | 의미 |
| --- | --- |
| `operation` | `ExternalScheduleSave` 또는 `ExternalScheduleDelete` |
| `mode` | `create`, `update`, `delete` |
| `actorEmployeeId` | 실제 변경 관리자의 문자열 ID |
| `id` | 저장되거나 삭제된 일정의 문자열 ID |
| `previousSnapshot` | 대조한 수정 전 기준값; 생성이면 빈 문자열 |
| `snapshot` | 저장 후 기준값; 삭제이면 빈 문자열 |
| `input` | 대상 `employeeId` 문자열, `startDate`/`endDate` ISO 날짜, 정규화 `category`/`memo` |
| `navigateTo` | 시작일 기준 `/Leave/Index` 월 달력 및 SelfOnly/ShowOthers/ViewEmployeeId/RequestLimit/RequestPage 필터 |

Delete도 실제 삭제한 객체의 필드를 반환한다. 클라이언트는 전체 응답과 확인 전 캡처한 의도를 대조한 뒤에만 결과를 반영한다. 이동 경로는 같은 출처·허용된 달력 경로/중복 없는 쿼리·시작일과 원래 필터인지 검증한다. 이 응답은 후속 달력 조회까지 성공했다는 의미가 아니다.

## 화면 수명주기

- 확인/쓰기 중 다른 외부 일정 작업·연차 신청·취소/철회·관리자 native 제출을 겹치지 않는다. 공통 확인창 Escape가 뒤의 달력 상세창까지 닫히지 않게 한다.
- 달력 GET 시작과 응답 적용/오류 redirect 직전에 외부 일정의 초안/처리 상태를 검사한다. 초안이 있으면 이동 대신 저장/명시적 초기화를 안내한다. 목록 GET도 진행 중 쓰기와 겹쳐 교체되지 않게 한다. 전체 문서 이탈은 native beforeunload로 보호하며 확인된 저장 이동은 미확정 쓰기 경고와 구분한다.
- 다른 POST 편집 초안이 있으면 확인된 저장 뒤에도 자동 이동하지 않는다. 다른 일정 삭제는 현재 외부 일정 초안도 유지한다. 달력 기본 날짜/직원 선택 자체를 미저장 업무로 오인하지 않도록 이 편집기의 기준값을 신청/취소 어댑터와 공유한다.
- 전체 응답 확인 뒤에도 현재 문서의 외부 일정 추가 쓰기는 잠그고 새 탭 GET으로 최신 내용을 확인하게 한다. 초안/버전은 자동 갱신이나 재전송하지 않는다. 명확한 422 invalid만 같은 화면에서 수정 후 재시도할 수 있다.
- 동적으로 교체된 달력 폼은 공통 전송기에 다시 연결하고 제거된 폼은 dispose한다. 계정 범위 변경·timeout·해제 뒤 늦은 응답은 적용하지 않는다. 전송 중 프로그램이 바꾼 초안도 이전 확인 응답으로 덮어쓰지 않는다. 강제로 DOM이 제거되는 경우 저장 결과는 미확정이며 원문 영구 복구를 보장하지 않는다.
- 폼 식별에는 `getAttribute('id')`를 사용한다. `name="id"` 입력이 HTMLFormElement의 `id` 속성을 가려 삭제를 생성으로 잘못 판별할 수 있다.

## 실패·호환

- 사전 입력 오류는 422 `invalid`, 계정/내용 변경·사라진 대상은 409 `conflict`, 비관리자는 403 `denied`다.
- 업무 DB와 감사 저장은 기존처럼 별개다. 쓰기/감사 예외는 로그에만 남기고 500 `unknown`을 반환한다. 일부 반영될 수 있으므로 자동 재전송하거나 롤백으로 안내하지 않는다. 요청 취소도 저장 취소 보장이 아니다.
- 응답은 `Cache-Control: no-store`다. handler 이전 CSRF/인증 미들웨어 응답은 기존 정책을 따른다.
- 기준값이 전혀 없는 구형 native POST는 기존 인가/입력 검증과 redirect 호환을 유지한다. 어느 기준값이라도 제공되면 둘 다 정확해야 한다. 현재 화면은 두 기준값을 보내지만 구형 호환 요청까지 버전 검증을 보장하지는 않는다.
- native 실패는 허용된 업무 필드만 JSON 원문으로 보관하고 Razor 인코딩으로 표시한다. 토큰·임의 POST 항목·예외 원문은 복사하지 않는다. 외부 일정 변경 컨트롤을 제거하고 새 탭 GET 확인을 제공한다. 다른 미전송 폼·파일이나 handler 이전 실패를 복구하지는 않는다. 문서/탭을 닫으면 원문도 사라진다.

## 검증

`LeaveExternalScheduleTests.cs`는 실제 격리 Portal SSO/Leave/Razor/SQLite에서 CRUD·정확한 ID·버전 왕복·권한/CSRF·입력·사라진 대상·구형 native 경로와 원문 보존을 검사한다. 감사 오류로 일정이 이미 바뀐 경우와 업무 저장 자체 실패를 구분한다. 실제 달력 fingerprint와 native 토큰으로 브라우저 fixture를 만든다.

`leave-external-schedules.spec.mjs`는 실제 Razor와 공통 자산에서 CRUD/확인/초안·반복 전송·동적 교체·모든 응답 필드/경로·scope/dispose/timeout·진행 중 GET/프로그램 입력 변경을 검사한다. `leave-external-recovery.spec.mjs`는 HTML 오류 복구를 담당한다. 320/1440px light/dark와 넘침·포커스를 확인하고 시각 검증을 병행한다. 정적 검사/변이 테스트는 대표 누락만 감지하며 완전한 인가/임의 우회 방지 증거가 아니다.
