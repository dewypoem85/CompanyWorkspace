# 연차 Discord 채널 설정의 공통 폼 계약

`/Admin/NotificationSettings`의 기존 Add/Delete/Test POST는 `webhook-settings.js`가 공통 `CompanyForm`, `CompanyDialog`, `CompanyState`, 문서별 `createSession()`에 연결한다. 일반 컨트롤은 `leave-admin-controls.md`를 따른다. 공휴일 설정이나 개인 Discord DM 설정과 저장 대상을 혼동하지 않는다.

## 서버 책임과 응답

- 기존 AdminOnly·중앙 세션·antiforgery는 유지한다. enhanced 요청은 `Accept: application/vnd.company.workspace-form+json`, `expectedEmployeeId`, `expectedStateToken`을 보낸다. 서버는 현재 로컬 직원 ID와 정렬된 전체 웹훅 목록의 SHA-256 기준값을 대조한다. 기준값은 ID·원본 URL·메모·생성 시각 ticks를 포함하며 URL을 브라우저의 조회 스냅샷에 노출하지 않는다.
- 이전 기준값 없는 native 폼은 호환 경로다. 기준값이 있는 native 폼도 대조한다. 기존 DB 스키마/감사 경계는 유지하며 이 확인은 읽기 시점 비교다. 원자적 DB CAS나 다중 탭 멱등성을 새로 보장하지 않는다.
- JSON은 `workspace-form-v1`과 `outcome`, 일반 사용자용 `message`, `data`를 사용한다. 확실한 입력 오류/중복 URL은 422 invalid, 오래된 계정/목록/삭제 대상은 409 conflict다. 저장 후 감사 실패 또는 외부 발송/응답 실패는 502 unknown이며 내부 예외·URL 토큰·Discord 응답 원문을 메시지로 노출하지 않는다.
- saved의 data는 `operation`, `previousStateToken`, `affected`, `snapshot`, 정확한 `/Admin/NotificationSettings` 경로를 포함한다. snapshot은 문자열 `actorEmployeeId`, 대문자 64자리 `stateToken`, ID 순서의 `items[{id,memo,maskedUrl,createdAt}]`다. id는 양의 Int64 십진 문자열이며 createdAt은 기존 KST `yyyy-MM-dd HH:mm` 표기다.
- Add의 affected는 생성 문자열 ID, 정규화 메모, 제출 URL의 SHA-256 `urlHash`다. 클라이언트는 URL 원문을 확인창/결과 목록에 표시하지 않고 digest와 마스킹된 대상·신규 행 및 모든 기존 행을 확인한다. 해시는 인증/암호화가 아니라 제출 대상 대조용이다.
- Delete는 affected.id와 해당 행만 제거된 전체 목록을 확인한다. Test는 affected=null 및 확인 당시 snapshot과 정확히 같은 응답이다. 둘 모두 일부 필드만 일치한 응답으로 성공 처리하지 않는다.
- Test는 서버에서 검사한 **동일 웹훅 목록**을 `SendTestAsync(actor,Webhooks)`로 전달한다. 도중 DB를 다시 읽어 새 수신처로 발송하지 않는다. 기존 일반 알림 경로는 여전히 자체 목록을 조회한다. 일부 수신처만 성공해도 전체 요청은 unknown일 수 있으며 클라이언트 취소는 이미 발송한 메시지/DB의 롤백이 아니다.

## 실제 UI 수명주기

- 확인 전 문서 세션 lease를 얻고 입력·계정·목록을 캡처한다. Add는 URL digest 준비 후에도 lease/입력을 다시 검증한다. 확인 취소·확인 중 입력 변경은 POST를 보내지 않는다. 한 작업 전송 중에는 다른 등록/삭제/발송을 실행하지 않는다.
- 공통 폼은 전체 응답을 검증한 뒤 성공을 알린다. 확인된 목록을 같은 `_WebhookRow` 템플릿으로 갱신하며, 큰 ID를 Number로 바꾸거나 메모를 HTML로 삽입하지 않는다. 삭제·테스트가 미저장 추가 초안을 지우지 않는다. 확인된 Add 원문은 보관하고 입력이 그대로면 재제출을 막는다.
- 확실한 invalid는 수정 가능하다. 나머지 권한/충돌/손상/통신/timeout은 현재 문서의 모든 쓰기를 잠그며 새 탭 GET 확인만 제공한다. GET 확인 링크를 눌러도 기존 문서의 잠금이 해제되지 않는다. 수신 확인을 위해 테스트를 자동 재발송하지 않는다.
- 계정/권한 변경은 이전 목록·조회 스냅샷·입력을 DOM에서 제거한다. 비동기 응답은 다시 붙이지 않는다. pagehide/화면 또는 폼 제거는 컨트롤러와 세션을 해제한다. bfcache의 persisted pagehide는 기존 공통 규약을 따른다.
- 서버가 다시 렌더링하는 native fallback의 실패는 원문 양식과 안전한 메시지를 유지하고 unknown/conflict는 disabled로 잠근다. no-JS 사용자는 현재 URL을 새 문서에서 다시 조회한다. 이전 native 경로에는 공통 확인창이 없으며 enhanced 기능과 동일하다고 주장하지 않는다.

## 검증

- `LeaveWebhookTests.cs`: 실제 격리 Portal SSO/Leave/SQLite·테스트 HTTP, 정확한 큰 ID, 등록/삭제/발송 대상, stale/invalid/CSRF/직원 POST 인가, native, 일부 외부 실패와 commit 뒤 감사 실패를 검사한다. 운영 Discord/DB는 사용하지 않는다.
- `leave-webhooks.test.mjs`: 전체 응답의 ID·원문 비노출·목록/digest/대상 대조를 검사한다.
- `leave-webhooks.spec.mjs`: 실제 Razor의 PC/모바일·라이트/다크 확인/저장, 초안·순차 작업·오류/범위/해제/timeout·취소 무시 응답·중복 실행을 검사한다. 결과 안내가 고정 상단바 아래에 보이는지도 확인한다.
- `checkWebhookSettings`와 변이 검사는 대표적인 공통 연결 누락/raw transport 재도입을 거부한다. 소스 표기 검사이며 임의 코드의 인가/경쟁 안전성을 증명하는 전체 프로그램 분석은 아니다.

현재 스코프는 채널 설정이다. 공휴일 native 저장, 기타 미전환 UI와 원격 보호·배포·운영 연계는 별도 남은 목표다.
