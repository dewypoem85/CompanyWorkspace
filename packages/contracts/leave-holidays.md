# 연차 공휴일 저장 계약

## 전환 범위

`Holidays.cshtml.cs`의 Add/Delete/ImportOnline/ImportJson은 기존 native POST와 함께 `workspace-form-v1` 응답을 제공한다. `Holidays.Protocol.cs`는 조회 기준값·현재 관리자·입력/응답·실패 구분을 담당한다. 공휴일 파싱, 날짜별 이름 합치기, 온라인 원 공휴일/대체휴무 보정과 DB/감사 경계는 기존 업무 코드에 남는다.

실제 브라우저의 네 폼은 `holiday-settings.js`에서 `CompanyForm`/`CompanyDialog`/`CompanyState` 및 하나의 문서 작업 세션에 연결한다. `holiday-contract.js`는 도메인 입력/전체 응답만 검증하며 전송/확인을 복제하지 않는다. 최초/후속 행은 동일 `_HolidayRow`를 사용한다. JavaScript가 없으면 기존 POST와 native 오류 복구를 유지하며 no-JS 확인창까지 제공한다고 주장하지 않는다.

## 요청과 기준값

- 페이지의 기존 AdminOnly·중앙 세션·CSRF를 유지한다. enhanced 요청은 `Accept: application/vnd.company.workspace-form+json`, `expectedEmployeeId`, `expectedStateToken`을 제출한다. 둘 다 없던 native 문서는 호환한다. 기준값을 제출한 native 문서에는 동일 대조를 적용한다.
- 스냅샷은 문자열 `actorEmployeeId`, 대문자 SHA-256 `stateToken`, 날짜/ID 순서의 `items[{id,date,name}]`이다. ID는 정확한 Int64 십진 문자열, 날짜는 `yyyy-MM-dd`다. DOM JSON은 기본 System.Text.Json 인코딩을 유지한다.
- 직접 추가/가져오기의 연도와 현재 목록 연도가 다를 수 있어 기준값은 **모든 연도**의 공휴일을 포함한다. 다른 연도 수정도 충돌로 판단하며 전체 목록 크기에 비례하는 조회/응답 비용이 있다. 직원/계정 정보는 목록에 포함하지 않는다. 표시 연도만으로 변경 대상을 추정하지 않는다.
- Add는 날짜와 trim한 100자 이내 이름, Delete는 양의 ID를 확인한다. JSON은 기존 20,000자 한도와 원문을 유지한다. enhanced 가져오기는 2000~2100 연도와 bool을 검증하며 Razor 체크박스의 `true,false` 전송도 허용한다. 다른 양식의 Required 오류로 현재 양식을 거부하지 않고 대상 필드만 검증한다. 중복 scalar 값은 거부한다.
- 온라인 API 조회가 끝난 뒤 첫 DB 쓰기 전에 동일 제출 기준값을 다시 대조한다. 조회 중 다른 관리자가 목록을 변경하면 저장하지 않는다. 이는 읽기 시점 대조이며 DB CAS/영구 멱등성이나 전체 작업 트랜잭션이 아니다.

## 응답과 실패

공통 `saved`의 data는 `operation`, `previousStateToken`, `intent`, 최신 `snapshot`, `applied`, `counts`, `/Admin/Holidays?Year={대상연도}`를 담는다. 업무 저장과 감사 기록 및 실제 DB 재조회까지 성공한 뒤에만 saved를 반환한다.

| 작업 | intent | 적용 목록/집계 |
| --- | --- | --- |
| Add | date, trim한 name | applied/counts는 null. 같은 날짜는 기존 ID를 보존해 이름 수정, 없으면 신규 ID. |
| Delete | 정확한 문자열 id | applied/counts는 null. 삭제 대상이 없으면 conflict. |
| ImportJson | year, overwriteExisting, 원문 UTF-8 SHA-256 jsonHash | 정규화된 applied 날짜/이름 및 created/updated/skipped. |
| ImportOnline | year, overwriteExisting, jsonHash=null | 실제 외부 응답과 기존 보정 규칙을 적용한 목록 및 집계. |

- 동일 날짜의 서로 다른 이름은 입력 순서대로 중복 제거 후 ` / `로 합친다. 선택한 연도 밖 데이터는 제외한다. JSON 직접 등록에는 온라인 대체휴무 보정을 추가하지 않는다.
- 덮어쓰기 꺼짐은 기존 날짜를 건너뛴다. 켜짐도 이름이 같으면 skipped다. 전부 건너뛰거나 동일 이름을 저장하면 stateToken이 바뀌지 않을 수 있다. 이를 저장 실패로 해석하지 않는다.
- malformed/빈 입력과 **저장 전** 외부 HTTP/응답 오류는 422 invalid다. 외부 조회 재시도는 쓰기를 반복하는 것과 구분한다. 잘못된 계정/기준값/삭제 대상은 409 conflict다.
- DB 쓰기 시작 뒤 예외·감사 실패·저장 후 재조회 실패는 502 unknown이다. 이미 반영됐을 수 있으며 자동 재전송하거나 롤백을 안내하지 않는다. 예외 세부와 원본 외부 오류는 서버 로그에만 남긴다.
- native unknown/conflict는 기존 폼 값을 보존하고 전체 fieldset을 잠그며 새 탭 조회 링크를 제공한다. JSON textarea 원문을 인코딩해 보존하고 성공 안내를 함께 표시하지 않는다. no-store를 유지한다.

## 클라이언트 연결과 검증

클라이언트는 확인 전에 lease를 얻고 계정/전체 기준값·입력 원문을 캡처한다. JSON digest를 비동기로 준비한 뒤에도 입력/lease를 다시 대조한다. Add/Delete는 대상 외 모든 행 보존, Import는 입력 digest/연도/덮어쓰기·적용 목록/집계·기존/신규 ID와 전체 결과를 검증한다. 서버가 해석한 JSON/온라인 적용 목록을 바탕으로 기대 결과를 구성하며 브라우저에서 공휴일 파서/보정 규칙을 복제하거나 원문 JSON을 재직렬화하지 않는다. 이는 외부 제공자의 공휴일 정확성을 독립적으로 증명하는 검사가 아니다.

- 확인 취소/입력 변경은 POST를 보내지 않는다. 하나의 확인/저장 중에는 다른 폼·연도 조회를 잠근다. 실제 checkbox checked 상태와 Razor hidden false를 함께 보존한다.
- 저장 후에는 대상 연도의 확인된 목록을 표시하되 온라인/JSON 연도·덮어쓰기·직접 추가 입력·원문을 자동 초기화하지 않는다. 연도 조회는 현재 확인된 전체 스냅샷을 필터링하는 로컬 동작이다. 새 탭 링크만 서버의 최신 목록을 조회하며 기존 문서 잠금을 해제하지 않는다.
- 저장된 Add/JSON 입력은 그대로일 때 재전송하지 않는다. 온라인 조회는 외부 데이터가 갱신될 수 있으므로 매번 공통 확인을 거쳐 명시적으로 다시 실행할 수 있다. 자동 재시도는 없다.
- definite invalid는 수정/재확인이 가능하다. 나머지 거부/충돌/손상/통신/timeout은 문서 쓰기를 잠그고 원문을 보존한다. 계정 변경에는 이전 본문/스냅샷을 제거한다. 화면/폼 제거와 non-persisted pagehide는 해제하며 늦은 응답을 적용하지 않는다. 확인된 저장 이후 화면 반영 실패는 재저장이 아닌 새 탭 확인으로 안내한다.

`LeaveHolidayTests.cs`는 격리 SSO/SQLite/합성 HTTP로 위 계약과 native 복구를 검사하고 실제 Razor/응답 자료를 만든다. `leave-holidays.test.mjs`는 큰 ID/날짜/전체 응답·건수·원문 hash를 검사한다. `leave-holidays.spec.mjs`는 실제 Razor/공통 자산으로 네 작업·조회 연도/독립 초안·두 테마/폭·거부/손상/확인 취소·계정/해제/늦은 응답을 검증한다. `leave-holiday-native.spec.mjs`는 native 실패 화면의 원문·잠금·조회 링크를 확인한다. `checkHolidayProtocol`의 변이는 대표 연결 누락을 검출하는 소스 검사이며 모든 경쟁/인가 우회를 증명하지 않는다. 운영 공휴일 API/DB는 사용하지 않는다.
