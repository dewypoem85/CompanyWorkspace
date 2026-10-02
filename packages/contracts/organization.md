# 조직 관리 폼 계약

대상은 Portal `/Admin/Organization`의 부서/프로젝트 등록·수정이다. 프로젝트 아이콘은 같은 화면의 별도 native 폼이며 `project-icons.md`를 따른다. 두 저장은 독립적이다. 이 Razor 페이지의 전체 요청과 multipart 본문 제한은 1MiB이며 조직 요청에도 적용된다.

## 요청

동일 출처 native POST와 실제 Razor antiforgery 필드를 사용한다. enhanced 요청의 Accept/응답 Content-Type은 `application/vnd.company.workspace-form+json`이다.

- `ExpectedUserId`: 최초 화면의 회사 사용자 ID, 십진 문자열. 현재 서버 인증 계정과 정확히 대조한다. 기존 인가를 대신하지 않는다.
- `Tab`: `departments` 또는 `projects`.
- `Form.Id`: 등록은 빈 문자열, 수정은 양의 Int64 문자열.
- `Form.Version`: 등록은 `0`, 수정은 조회한 기존 Int32 버전. 최신 버전으로 자동 교체하지 않는다.
- `Form.Name`, `Form.Color`, `Form.IsPrivate`, `Form.Archived`, 반복되는 `Form.EmployeeIds`: 기존 native 입력과 업무 정책을 유지한다. disabled 관리자 선택의 hidden 값과 checkbox false 입력을 임의로 제거하지 않는다.

계정/관리 항목/ID/버전/이름의 단일 입력 개수를 확인한다. 일부 필드만 전달한 별도 API가 아니며 새 계정 필드가 없는 예전 문서는 새로 열어야 한다.

## 응답

확인된 저장만 `200`, `protocol: workspace-form-v1`, `outcome: saved`, `message`와 다음 `data`를 반환한다.

| 필드 | 의미 |
| --- | --- |
| `tab` | 요청한 관리 종류 |
| `userId` | 실제 저장을 수행한 회사 계정 ID 문자열 |
| `id`, `version` | 트랜잭션 커밋을 마친 객체의 ID/버전 문자열 |
| `previousId`, `previousVersion` | 제출한 수정 전 ID/버전 문자열. 신규는 빈 ID와 `0` |

클라이언트는 전체 결과와 보낸 폼·현재 초안을 비교한다. 기존 ID는 같아야 하고 기존 버전은 정확히 1 증가해야 한다. 신규 버전은 `1`이며 ID는 양의 Int64 범위여야 한다. 검증 이후에만 알려진 로컬 경로로 GET 이동한다. 응답에 외부 redirect URL을 받지 않는다. 새 GET의 실패를 확인된 쓰기의 롤백으로 간주하거나 자동 POST 재시도하지 않는다.

`409 conflict`는 계정 또는 기존 버전 불일치, `422 invalid`는 입력/업무 검증 실패다. 권한 거부·미확정 쓰기·손상/HTML 응답은 공통 폼 상태로 안내한다. 확실한 입력 오류 외에는 현재 문서의 반복 저장을 잠근다. 서버 내부 쓰기 예외는 사용자에게 그대로 노출하지 않는다.

## 초안과 수명주기

공통 확인창 취소는 전송하지 않는다. 확인 전후와 전송 후 입력·계정 범위를 검증하고 화면 해제 시 공통 폼/확인창을 해제한다. native beforeunload는 저장 응답이 검증되기 전까지 유지한다. 미저장 아이콘/진행 중 아이콘 작업이 있으면 조직 제출을 막아 독립 초안을 잃지 않도록 한다. 조직 전송 중 아이콘 영역은 inert로 잠그고 아이콘 어댑터도 조직 폼의 busy 상태를 확인한다. 아이콘 저장·삭제는 조직 이름/색상/참여자 초안을 바꾸거나 페이지를 이동하지 않는다. 조직 저장 후 응답을 반영하기 전에도 새 아이콘 초안이 없는지 확인한다.

enhanced 실패는 현재 폼에 초안을 남긴다. 일반 HTML 실패는 원래 ModelState와 업무 필드만 원문으로 보관한다. 현재 선택기에 없는 직원 등 표현할 수 없는 입력·미확정 결과는 복사용 원문과 새 탭 확인만 제공한다. 원문은 Razor HTML 인코딩을 거치며 antiforgery/임의 POST 필드는 포함하지 않는다. 브라우저 저장소에 초안을 자동 보관하지 않는다.

이 계약은 영구 멱등성·새 탭/프로세스 재시작 후 중복 생성 방지, 브라우저 abort에 따른 서버 롤백, 아이콘과 조직 정보의 원자적 저장을 보장하지 않는다.
