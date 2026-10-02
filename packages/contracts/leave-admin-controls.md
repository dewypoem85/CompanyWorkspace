# 연차 공휴일·채널 설정 컨트롤

`Pages/Admin/Holidays.cshtml`와 `NotificationSettings.cshtml`은 일반 입력·버튼·표에 공통 native primitive를 사용한다. `native-fields.md`와 `ui-primitives.md`가 스타일 원본이며 별도 라이트/다크 필드 색을 만들지 않는다.

## 화면과 전송 경계

- 공휴일 직접 추가는 공통 2열/모바일 1열 필드, 온라인/JSON 가져오기는 개별 카드 안의 공통 필드를 사용한다. 긴 JSON의 편집 높이와 고정폭 글꼴은 도메인 기하다.
- 온라인/JSON 폼의 `Import.Year`와 `Import.OverwriteExisting` **전송 이름은 동일하게 유지**하되 DOM ID는 각각 고유하다. 덮어쓰기 label/input은 `cw-check-control`/`cw-checkbox`를 사용하고 공통 계층이 두 테마·선택·focus·disabled 상태를 소유한다. 라벨/체크박스 클릭이 다른 양식을 조작하면 안 된다. 입력 JSON은 원문 그대로 native form에 남기며 브라우저에서 JSON.parse/stringify하지 않는다.
- 공휴일 조회는 다른 달력 toolbar의 고정 열 수/입력 폭을 상속하지 않는다. 연도 min/max, 실제 GET 이름/값과 POST handler·위조 방지 필드는 보존한다.
- 웹훅 URL/메모는 같은 공통 필드 구조를 사용하며 required/maxlength를 보존한다. 미설정 상태의 전체 테스트는 native disabled로 실행을 막는다. 화면에는 기존 서버 Mask 결과만 표시한다.
- 목록은 공통 `cw-data-table`/`cw-table-scroll`로 렌더링한다. 폭이 큰 웹훅 표는 이름 있는 키보드 진입 가능 영역 안에서 스크롤하며 문서를 넓히거나 내용을 잘라 감추지 않는다. 삭제는 공통 danger/compact 버튼을 사용한다.

## 검증과 아직 남은 전환

채널 설정과 공휴일의 저장/확인 수명주기는 각각 `leave-webhooks.md`, `leave-holidays.md`로 전환했다. 두 화면 모두 실제 공통 폼/확인/문서 세션에 연결한다. 아래 항목 중 저장/응답 수명주기는 해당 후속 계약에서 검증하며, 이 문서의 컨트롤 검사만으로 완료를 주장하지 않는다.

`leave-shell.spec.mjs`는 실제 Razor fixture로 두 화면의 320/1440px·라이트/다크, 공통 색/높이/그리드, 고유 입력 ID·독립 체크, 원문 FormData, native 검증·disabled·표 키보드 진입·문서 폭을 검사한다. 원래 Leave 셸·권한과 업무 브라우저 회귀도 유지한다. fixture의 테스트 발송은 disabled 상태이며 운영 웹훅/외부 API를 호출하지 않는다.

이 문서의 전환은 컨트롤 소유권 범위다. 다음 항목은 후속 계약 및 별도 검증 범위다.

- 기존 native POST/HTML 결과·기본 삭제 confirm을 공통 CompanyForm/CompanyDialog/CompanyState에 연결하기.
- 확인 당시 계정/대상 기준값, 전체 저장 응답, 늦은 응답·계정 변경·복수 초안·미확정 쓰기 수명주기 검증.
- 공휴일 온라인 가져오기의 외부 조회·실제 반영·감사 경계와 웹훅 테스트의 외부 발송 결과 구분. 요청 취소를 이미 저장된 DB나 발송된 메시지 롤백으로 안내하지 않기.
- Discord 수신 유형 등 다른 checkbox, 요약 카드와 결과 메시지 및 실제 운영 이관.

AdminOnly/중앙 세션/CSRF, DB·감사·공휴일 정규화·웹훅 검증/마스킹·발송 정책은 기존 서버 책임이다. 스타일 검사 통과는 업무 저장 안전성이나 원격 배포 성공을 증명하지 않는다.
