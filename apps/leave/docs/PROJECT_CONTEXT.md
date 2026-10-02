# LeaveManager 프로젝트 구조 및 수정 지침

## 생일연차 신청과 사용 가능 안내 (2026-09-29)

- 생일연차는 생일 당일을 기준으로 앞뒤 30일 안에서 1일만 신청할 수 있으며 일반 연차·월차 잔여량을 차감하지 않습니다. 입사일이 해당 생일보다 늦으면 그 해 혜택은 사용할 수 없고, 미사용분은 이월하거나 지급분으로 만들지 않습니다. 2월 29일생은 평년 2월 28일을 기준으로 합니다.
- 본인 대시보드 상단과 신청 유형 안내에서 현재 사용 가능 여부, 사용 기간, 이미 사용한 상태를 표시합니다. 생일연차는 단일 근무일만 선택할 수 있고 일반 신청과 같은 승인·취소 흐름을 따릅니다.
- 본인과 관리자는 달력·앱 알림에서 `생일연차`를 확인할 수 있지만 다른 직원과 공용 Discord 채널에는 일반 `연차`로 표시합니다. 관리자는 사유를 남기는 강제 추가로 기간·입사일·연 1회 제한을 예외 처리할 수 있으며 모든 예외는 감사 기록에 남깁니다.
- 과거 자동 지급과 기존 `IsBirthdayLeave` 기록은 정산 호환을 위해 보존하되 새 지급분은 만들지 않습니다. 신청의 귀속 생일과 관리자 예외 여부는 `LeaveRequests.BirthdayBenefitDate`, `IsBirthdayPolicyOverride`에 저장하고 활성 일반 신청은 직원·귀속 생일별 한 건만 허용합니다. 계약 원본은 `packages/contracts/leave-birthday.md`입니다.

## 지급·사용 기준 가불 자동 재계산 (2026-09-23)

- 현재 연차년도의 승인·승인대기 사용량과 유효 지급분, 관리자 보정, 정산을 한 장부로 다시 맞춥니다. 가장 오래된 신청부터 실제 지급분을 배정하고 부족한 수량만 가불로 남기므로 한 신청이 지급분 배정과 가불에 동시에 중복 기록되지 않습니다.
- 월차 자동 발생은 같은 연차년도 가불을 새 지급분에 재배정하고, 입사 1주년 연차 발생은 직전 연차년도의 미상환 연차 가불을 자동 차감합니다. 관리자 발생분 추가·양수 보정은 가불을 줄이고, 음수 보정·회수는 실제 부족분만큼 가불을 늘립니다.
- 신청·관리자 강제 추가·반려·취소·강제 삭제, 발생분 추가·보정·삭제, 소멸·이월·보상 뒤에도 같은 재계산을 실행합니다. 서비스 시작 시 자동 발생 작업이 현재 연차년도를 다시 맞추므로 과거의 누락 배정과 중복 가불도 복구합니다.
- 같은 연차년도 안의 기존 가불 차감 정산은 제거하고 실제 신청 배정으로 정규화합니다. 연차년도 경계를 넘겨 다음 연차로 갚은 정산은 보존하여 새 연차 지급량에서 차감합니다.

## 일정 주요일정 달력 표시 (2026-09-21)

- 월간·연간 연차 달력과 날짜 상세는 Schedule에서 현재 로그인 사용자가 볼 수 있는 주요일정을 읽기 전용으로 표시합니다. 기본 일정과 추가 일정 발생을 `📌` 칩으로 표시하며 제목·유형·선택적 프로젝트명만 가져옵니다. 프로젝트 ID가 있으면 공통 workspace context와 `CompanyEntityDisplay`를 통해 권한이 확인된 프로젝트 아이콘도 함께 표시합니다.
- Leave DB에 일정을 복제하지 않고 연차 신청·승인·차감·잔액·관리자 외부 일정과 분리합니다. Schedule 장애나 잘못된 응답에는 주요일정만 비우고 기존 달력을 유지합니다.
- 내부 호출은 실제 actor의 회사 ID가 들어간 60초 HMAC 토큰, 전용 timeout/redirect 금지 클라이언트와 전체 응답 검증을 사용합니다. 관리자 대신보기에서도 대상 직원이 아닌 로그인 actor의 Schedule 공개 범위를 따릅니다. 계약은 `packages/contracts/leave-schedule-milestones.md`입니다.

## 연차 달력 보기 전환의 부분 갱신 (2026-09-18)

- 관리자 `자기것만 보기`와 일반 직원 `다른 사람 연차도 같이 보기`는 기존 GET 선호 저장을 유지하면서 달력 영역만 다시 받습니다. 관리자 `대신보기`는 직원별 잔액·신청 내역·쓰기 권한이 달라져 공통 본문 라우터로 연차 대시보드 본문만 교체합니다. 상단·사이드바는 유지하고 서버 권한 검사와 JavaScript 없는 native GET을 보존합니다.
- 확인 중인 쓰기·미확정 결과·편집 초안 보호, 현재 직원/역할 검증, 최신 조회만 적용하는 공통 읽기 수명주기를 유지합니다. 계약은 `packages/contracts/leave-calendar-preferences.md`, `leave-dashboard-reads.md`, `page-navigation.md`입니다.

## 등록 메뉴의 본문 전환 (2026-09-18)

- 같은 연차 서비스의 등록 메뉴는 기존 인증·권한 검사를 거친 Razor GET HTML만 새로 받아 공통 상단바와 사이드바를 유지한다. 데이터 HTML 캐시는 없다. GET 필터·POST·로그인/로그아웃·서비스 간 이동은 기존 문서 이동이다.
- `_Layout`의 `[data-workspace-page-scripts]`만 전환 뒤 다시 초기화한다. dashboard의 신청·외부 일정·관리자 달력, 관리자 보정·승인·정산·감사와 Discord/공휴일/웹훅 설정은 `company-page-leave`에서 폼 세션·읽기·관찰자를 정리한다. 진행 중 저장은 이동하지 않고, 수정 중인 내용은 확인 후 버린다. 세부 경계는 루트 `packages/contracts/page-navigation.md`다.

## 비공개 직원 생일 달력 표시 (2026-09-17)

- 생일 원본은 Portal 직원 관리의 연도 없는 `MM-DD` 선택 필드이며 Leave에는 기준연도 2000으로 정규화한 달력 표시용 `Employee.BirthDate`만 투영합니다. 새 claim도 `MM-DD`이며 명시적 null이면 삭제합니다. 순차 배포 중 기존 `yyyy-MM-dd` claim은 월·일만 취하고, claim 자체가 없으면 기존 값을 보존합니다. 일반 직원 목록·프로필·다른 서비스에는 노출하지 않습니다.
- 월간·연간 연차 달력은 일반 직원에게 본인 생일만, 관리자·마스터의 전체 보기에는 활성 실제 직원 생일을 표시합니다. 관리자 자기것만 보기와 대신보기는 선택 직원으로 제한하며 출생 연도는 표시하지 않습니다.
- 2월 29일생은 평년 달력에서 2월 28일에 표시합니다. 새 연차·반차는 생일 여부와 무관하게 평소대로 차감하며 미사용 생일 `+1일` 지급도 하지 않습니다. 과거 `IsBirthdayLeave` 신청과 `Birthday` 지급 기록은 기존 정산 유지를 위해 보존합니다. 계약 원본은 `packages/contracts/leave-birthday.md`입니다.

## 연차 대시보드 다크모드 대비 보강 (2026-09-15)

- `/Leave/Index` 날짜 상세의 신청 사유·업무 일정·외부 일정 메모는 공통 `raised/text/muted` 토큰을 사용해 상태 카드 안에서도 두 테마의 본문과 라벨을 구분합니다.
- 월간 달력의 연차·갱신·외부 일정 보조 문구는 카드의 의미 색을 상속하고, 가불 지표·공휴일과 연간 공휴일명은 공통 warning/sunday 토큰을 사용합니다.
- Razor의 기존 링크형 버튼도 공통 active/raised/hover 토큰을 사용합니다. 작은 보조 글자와 날짜 상세 본문은 실제 Chromium에서 4.5:1 이상의 대비를 확인합니다.

## 승인 배지와 권한 조회 경쟁 방지 (2026-09-13)

- 공통 사이드바의 권한·badge 스냅샷이 진행 중일 때 승인 화면의 실시간 대기 건수가 먼저 갱신되면, 늦은 스냅샷이 새 값을 과거 값으로 되돌리지 않습니다. badge별 로컬 revision을 조회 시작 시점과 대조합니다.
- 로컬 갱신 뒤 새로 시작한 권한 조회는 최신 서버 값을 적용할 수 있습니다. 계정·역할·서비스 범위 변경 시에는 기존 메뉴·badge·revision을 함께 제거하므로 이전 계정의 수가 노출되지 않습니다.
- 승인/취소 승인 3초 폴링, 서버 권한 검사, DB와 알림 처리는 변경하지 않습니다. 계약 원본은 모노레포 `packages/contracts/navigation-reads.md`입니다.

## 계정·알림·정산 작업 버튼 (2026-09-11)

- 알림 읽음/모두 읽음/확인, Discord 연동/테스트/해제/저장, 정산 처리와 로그인 fallback의 native 버튼을 공통 `cw-button`으로 연결합니다. primary/danger/compact와 실제 disabled·fieldset-disabled를 사용하고 기존 POST/CSRF/hidden 값·업무 handler는 바꾸지 않습니다.
- 정산 버튼은 조회가 아니라 기존 정산 POST입니다. 로그인 handler는 Portal redirect를 유지하며 fallback Razor 버튼을 정상 로그인 화면에 추가로 표시하지 않습니다. 일반 이동 링크·file·checkbox·달력은 별도 경계입니다.
- 공통 상태/확인·초안/ACK와 Discord OAuth/DM 및 알림 읽음 수명주기를 보존합니다. 모노레포 `packages/contracts/account-action-controls.md`의 실제 계산 색/크기 검사와 기존 업무 회귀·두 테마 캡처를 검증합니다. 운영 데이터/외부 알림은 테스트하지 않습니다.

## Discord 개인 알림 공통 체크박스 (2026-09-11)

- 개인 DM 활성화와 역할별 수신 유형은 `cw-check-control`/`cw-checkbox`를 사용합니다. 공통 계층이 두 테마의 선택·hover·focus·disabled와 18px 입력을 소유하고 앱에는 제목·설명과 2열/모바일 1열 배치만 둡니다.
- `discordDmEnabled`의 hidden false fallback, `selectedTypes` 다중 전송, 미연동 native disabled와 기존 Save/Unlink/Test/OAuth·초안/응답 검증은 유지합니다. 상세 계약은 모노레포 `packages/contracts/leave-discord-controls.md`이며 운영 Discord를 호출하지 않습니다.

## 공통 반응형 업무 표 (2026-09-11)

- 신청 내역·승인/취소 대기·직원 연결/잔여 현황·사용 통계·보안 표는 공통 cards/key-value 변형을 사용합니다. PC 표와 모바일 카드가 같은 값/프로필/폼 DOM을 유지합니다.
- 열 제목과 셀 레이블을 서버에서 함께 제공하며 카드의 value wrapper로 긴 제목/값의 행 높이를 유지합니다. 승인 버튼/사유 입력도 공통 native primitive를 소비합니다.
- 앱 CSS에는 열 너비와 메모 읽기 면적만 둡니다. 달력·감사 상세 표·링크 및 기존 mobile-tables.js의 GET 폼 동기화는 별도입니다. 모노레포 `packages/contracts/responsive-tables.md`와 이관 기록의 실제 검증 범위를 따릅니다.

## 달력 직원 프로필 연계 (2026-09-11)

- 월간/연간 신청·외부 일정, 갱신 및 날짜 상세는 공통 entity 렌더러를 사용합니다. 로컬 직원 ID와 회사 ID를 레이아웃 JSON에서 모두 문자열로 보존하며 매핑 없는 직원은 이니셜만 표시합니다.
- 상세의 이름/상태/ID/유형을 별도 속성으로 전달하므로 이름이나 공휴일에 `|` 또는 HTML 같은 원문이 있어도 항목이 어긋나거나 HTML로 해석되지 않습니다. 모바일의 보조 문구 숨김은 내부 프로필을 숨기지 않습니다.
- 갱신의 본인 보기는 기존 표시 직원 필터를, 외부 일정 본인 보기는 허용 외부 일정 직원 목록을 사용합니다. 회사 마스터/공용 제외, 일반 직원의 비공개 제외 및 관리자 과거 외부 일정 정책을 유지합니다. 업무 저장/DB/발생 계산을 변경하지 않습니다.
- 계약은 모노레포 `packages/contracts/leave-calendar-entities.md`이며 실제 Razor/격리 DB와 합성 프로필 HTTP 브라우저 검사를 사용합니다. 운영 적용은 별도입니다.

## 연차 대시보드 공통 컨트롤 (2026-09-11)

- 신청·관리자 강제 추가·외부 일정의 일반 필드와 버튼, 목록/상세 취소·철회 및 동적 수정/삭제가 공통 native primitive를 사용합니다. 독자적인 필드 높이/모서리/disabled 테마를 제거하고 폼 배치와 textarea 읽기 면적만 유지합니다.
- 기존 필드 이름/ID·입력 원문·필수/길이/범위 검증·hidden 기준값/CSRF·직원 검색과 서버/저장 수명주기는 유지합니다. 조회 필드도 공통 스타일을 사용하지만 달력/내역 표·업무 카드·이동 링크까지 완료한 것은 아닙니다.
- 계약은 모노레포 `packages/contracts/leave-dashboard-controls.md`, 실제 검사 근거는 `docs/MIGRATION.md`입니다. 운영 DB/환경/서비스는 변경하지 않습니다.

## 날짜 상세 공통 팝업 (2026-09-11)

- 월간 날짜 상세는 공통 native dialog이며 원래 폼/CSRF/기준값은 같은 노드에 보관합니다. 날짜 버튼으로 키보드 진입·닫은 뒤 복귀가 가능하고 긴 내용을 내려도 제목/닫기가 보입니다.
- 취소·철회/외부 일정/관리자 강제 작업의 확인 후 숨김은 `LeaveDayDetail.close()`를 호출합니다. 공통 확인창 위의 Escape가 뒤 창을 닫지 않으며 닫고 다시 열어도 도메인 초안은 유지합니다.
- scope 변경에는 창을 닫고 무효 문서에서 재진입을 막습니다. 달력 노드 교체·일반 pagehide에는 연결을 해제하고 bfcache는 유지합니다. 서버 저장/인가/DB·기존 URL과 정책은 변경하지 않습니다.
- 계약은 모노레포 `packages/contracts/leave-day-detail.md`입니다. 아래 과거 단계의 상세 프레임 미전환 기록은 이 단계로 대체하며 본문 입력/카드·다른 미전환 UI와 운영 이관은 남습니다.

## 공휴일 관리 공통 편집기 (2026-09-11)

- `holiday-settings.js`가 직접 추가/수정·삭제·JSON/온라인 가져오기를 공통 폼·확인창·상태와 문서 작업 세션에 연결합니다. `holiday-contract.js`에서 정확한 전체 응답/기존·신규 ID·반영 건수·입력 digest를 대조합니다. 변경 없는 목록 hash도 정상 건너뜀 결과로 인정합니다.
- 최초/후속 목록은 `_HolidayRow`를 공유합니다. 연도 조회는 확인된 전체 목록을 필터링하고 입력을 초기화하지 않습니다. 서버 재조회는 별도 새 탭 링크로 구분합니다. 저장한 Add/JSON의 동일 입력 재제출을 막되 온라인 조회는 별도 명시적 확인 후 다시 실행할 수 있습니다.
- 오류/충돌/권한/미확정과 늦은 응답은 초안을 덮거나 재전송하지 않습니다. 계정 변경은 이전 입력/목록을 제거하며 화면/폼 제거와 pagehide에서 해제합니다. 아래 73차 서버 단계의 클라이언트 미연결 상태는 이 단계에서 대체했습니다.

## 공휴일 저장 서버 계약 (2026-09-11)

- `Holidays.Protocol.cs`에서 네 기존 POST handler의 공통 JSON 응답·현재 관리자/전체 연도 기준값과 native 오류 복구를 관리합니다. 온라인 조회가 끝난 뒤 쓰기 전에 다시 대조합니다. 저장 전 외부 오류는 invalid, 저장/감사 이후 예외는 unknown으로 구분하며 내부 예외를 사용자에게 노출하지 않습니다.
- 기존 JSON 원문/형식·날짜별 이름 합치기·덮어쓰기/건너뜀·온라인 보정은 유지합니다. 감사 실패 뒤 DB가 이미 반영될 수 있으며 native 화면은 입력을 보관하고 모든 쓰기를 잠급니다. 실제 공통 폼/확인창/문서 세션 연결은 아직 남아 있습니다. 모노레포 계약은 `packages/contracts/leave-holidays.md`입니다.

## 채널 알림 설정 공통 폼 (2026-09-11)

- `Admin/NotificationSettings`의 Add/Delete/Test를 공통 폼·확인창·상태·문서 작업 세션에 연결했습니다. 현재 관리자와 전체 웹훅 기준값을 서버에서 대조하고 정확한 문자열 ID·대상 digest·마스킹 목록 응답을 확인한 뒤 같은 `_WebhookRow`로 갱신합니다.
- Test는 검사한 수신처 목록에 발송하며 편집 중인 추가 초안은 저장하지 않습니다. 삭제/테스트/등록의 순차 작업과 초안을 보존하고 계정 변경/해제/timeout 뒤 늦은 결과는 적용하지 않습니다. unknown은 자동 재전송하지 않습니다.
- 실제 업무 저장 뒤 감사 실패/일부 채널 발송 실패도 있을 수 있습니다. 내부 예외/웹훅 토큰을 응답에 노출하지 않습니다. 기존 native 호환·DB/인가/일반 알림은 유지하며 새 CAS/영구 멱등성을 추가하지 않았습니다. 계약은 모노레포 `packages/contracts/leave-webhooks.md`이며 공휴일 native 저장 등은 아직 남습니다.

## 공휴일·채널 설정 공통 컨트롤 (2026-09-11)

- `Admin/Holidays`와 `Admin/NotificationSettings`의 일반 필드·버튼·표를 공통 primitive로 전환했습니다. 공휴일 가져오기 중복 DOM ID를 분리하되 기존 전송 이름과 JSON 원문, native handler/CSRF/검증을 유지합니다.
- 개별 필드/다크 색을 제거하고 직접 추가는 공통 모바일 1열, 목록은 키보드로 진입 가능한 내부 스크롤을 사용합니다. 웹훅 미설정 테스트 버튼의 disabled는 유지합니다.
- 기존 native 저장/삭제 확인/HTML 결과는 아직 공통 폼 수명주기 전환 대상입니다. DB·공휴일/웹훅 업무 정책과 외부 호출을 변경하지 않았습니다. 계약과 검증 범위는 모노레포 `packages/contracts/leave-admin-controls.md`입니다.

## 보정·발생분 공통 편집기 (2026-09-11)

- `Admin/Adjustments`의 세 기존 handler는 `Adjustments.Protocol.cs`의 공통 폼 응답 계약에 연결됩니다. 요청자·대상 직원·발생분 기준값을 대조하며 읽기 전용 Baseline handler는 관리자만 접근합니다. 퇴사/비공개 직원의 과거 보정과 음수 발생분, 동일 기준일 합산, 모든 배정/정산 합계의 삭제 제한을 유지합니다.
- 원래 업무 저장과 감사 기록 경계를 바꾸지 않습니다. 감사 실패도 이미 반영됐을 수 있어 unknown으로 반환합니다. native 실패는 허용 원문만 보관하고 새 탭 내역 확인을 제공합니다. 구형 기준값 없는 native 호환은 남습니다.
- `LeaveGrantSnapshot`을 정산과 공유합니다. 이전 enhanced 정산 화면의 hash는 달라져 최신 GET이 필요하지만 DB/계산/SSO/URL은 유지합니다. 정상 UI는 `leave-grants.js`의 공통 폼·확인·상태·복수 작업 세션에 연결하며 정밀한 값/전체 응답은 `leave-grants-contract.js`가 검증합니다. 계약은 모노레포 `packages/contracts/leave-grants.md`입니다.
- 직원별 목록과 행 DOM을 보관하여 직원 전환/순차 저장으로 다른 삭제 사유·보정·추가 초안을 지우지 않습니다. 세 작업은 같은 직원/유형/기준일의 이전 hash를 공유하고 저장 후 자동 재기준화하지 않습니다. 확인된 저장 뒤 독립 초안은 계속 쓸 수 있고, 미확정 쓰기는 잠그고 새 탭 GET으로 결과를 확인합니다.
- 최초/후속 행은 동일 `_GrantRow.cshtml`, 일반 필드·버튼·표는 공통 클래스, 직원 검색/제목/확인창은 공통 프로필 매핑을 사용합니다. 15초 읽기 관찰·공통 30초 전송 관찰, 계정/해제/폼 제거·늦은 응답 보호를 실제 Razor Chrome에서 검사합니다. 공휴일·채널 설정·기존 날짜 상세 프레임과 운영 이관은 아직 남습니다.

## 소멸·이월·보상 공통 폼 (2026-09-10)

- `/Admin/Settlements`는 공통 직원 초성 검색/프로필, native 필드·표, 확인창·폼·상태·세션을 사용합니다. 실제 대상은 기존 발생분 ID이며 사유·일수 초안을 유지합니다. 서버 스냅샷은 조회일·발생분·배정/신청 상태·기존 정산을 포함합니다.
- 관리자·실제 재직 직원·유효 발생분을 다시 확인합니다. 기존 0.5일/가용량/사유 정책, 정산과 이월 생성 트랜잭션, 커밋 뒤 감사 기록은 유지합니다. 가불 차감은 자동이고 보상은 실제 급여 지급이 아닙니다.
- 전체 응답을 확인한 저장과 결과 미확정을 구분합니다. 감사 실패도 이미 정산됐을 수 있으므로 자동 재전송하지 않고 최신 내역 GET을 제공합니다. native 실패는 허용된 입력 원문만 인코딩하고 잠급니다. 구형 기준값 없는 POST는 호환 경로이며 CAS/다중 탭 멱등성은 새로 보장하지 않습니다.
- 모노레포 `packages/contracts/leave-settlements.md`/`native-fields.md`, 실제 격리 `LeaveSettlementTests.cs` 및 Chrome `leave-settlements.spec.mjs`가 계약과 검증 근거입니다. 보정/발생분 관리·공휴일·채널 설정·날짜 상세 프레임과 운영 이관은 여전히 남습니다.

## 복수 폼 순차 저장 (2026-09-10)

- 신청·취소·외부 일정·관리자 강제 작업을 공통 `CompanyForm.createSession()` 한 인스턴스로 조정합니다. 확인된 저장은 다른 초안을 계속 저장하도록 풀고, 결과 미확정은 현재 문서의 쓰기를 잠급니다. 같은 신청의 이전 기준값은 취소/관리자 삭제/중복 표시에서도 다시 실행하지 않습니다.
- 외부 일정 생성 후 반환된 정확한 ID·fingerprint·정규화 입력으로 편집기를 갱신합니다. 후속 수정이 중복 생성으로 전송되지 않습니다. 변경 없는 추가/수정의 재전송을 막고 명시적 초기화/다른 대상 선택은 기존 초안 보존 규칙을 따릅니다. 신청 성공 뒤 달력은 날짜 재선택 대신 상세를 엽니다.
- 달력/내역 GET은 시작한 작업 revision과 현재 pending/invalid를 확인해 쓰기 후 늦은 성공/오류 응답도 DOM 교체/redirect하지 않습니다. 서버 인가·CSRF·기준값·전체 응답·업무 처리는 그대로이며 영구 멱등성/DB CAS를 추가한 것은 아닙니다. 계약은 모노레포 `packages/contracts/form-session.md`, 통합 브라우저 검사는 `leave-form-session.spec.mjs`입니다.
- 이전 단계 기록의 문서 전체 성공 잠금/복수 초안 재개 한계는 이번 연결로 대체했습니다. 기존 날짜 상세 프레임·보정/정산 등 남은 업무 UI와 원격/운영 이관은 별도 미완료입니다.

## 달력 관리자 강제 작업 공통 UI (2026-09-10)

- 강제 추가와 전체 신청 삭제를 공통 폼/확인창/상태에 연결했습니다. 추가 날짜를 폼에서 확인하며 날짜 이동으로 기존 초안을 덮어쓰지 않습니다. 삭제는 공통 입력 확인창에서 전체 날짜와 사유를 함께 확인하고 Escape/닫기 후 사유 이어쓰기를 제공합니다. 사유 필수 여부는 서버 보안 설정을 따릅니다.
- 실제 관리자·신청 스냅샷·전체 날짜/일수·필터와 정확한 응답을 대조합니다. 기존 신청/취소/외부 일정과 초안/진행 상태를 연결하고 늦은 GET 교체·오류 redirect·다른 POST를 차단합니다. 계정 변경/해제/timeout/폼 제거 뒤 응답은 적용하지 않습니다.
- native prompt/confirm/submit을 제거했고 공통 날짜/확인창 의미 색·폭·줄바꿈을 적용했습니다. 실제 서버/Razor와 `leave-calendar-admin.spec.mjs`를 검증합니다. 계약은 모노레포 `packages/contracts/leave-calendar-admin.md`입니다. 현재 문서 단위 잠금 아래에서 다른 초안을 연속 저장하는 재개 구조·기존 상세 프레임은 아직 개선 대상이며 운영 이관 완료를 뜻하지 않습니다.

## 달력 관리자 강제 연차 서버 계약 (2026-09-10)

- 기존 강제 추가/삭제 POST에 공통 폼 응답을 연결했습니다. 정확한 관리자와 전체 신청 스냅샷을 대조하고 문자열 ID·상태·작업 사유·날짜/차감 일수·현재 내역 경로를 반환합니다. 생성 직후 해시는 실제 DB 재조회 기준으로 만들며 기존 승인/취소 해시 정의를 바꾸지 않습니다.
- 과거 날짜/반차/미차감, 승인 완료 기록, 마스터 삭제 정책과 배정·가불 상환 복구는 유지합니다. 추가 대상은 화면 목록과 같은 활성 실제 직원이며 비공개 직원은 관리자가 처리할 수 있습니다. 공용/회사 마스터/비활성 대상과 대신보기 쓰기는 서버에서도 거부합니다.
- 확실한 사전 검증과 저장 뒤 감사/알림 실패를 구분합니다. native 실패는 허용된 업무 원문만 인코딩해 보관하고 강제 추가/삭제 UI를 잠근 뒤 새 탭 내역 확인을 제공합니다. 정상 달력의 공통 확인·폼·초안 수명주기 이관은 아직 다음 단계입니다. 계약은 모노레포 `packages/contracts/leave-calendar-admin.md`입니다.

## 외부 일정 편집 공통 폼 연결 (2026-09-10)

- 달력 칩의 실제 fingerprint와 현재 관리자 ID를 기존 native 저장/삭제 폼에 연결했습니다. 추가·수정·삭제는 공통 확인/폼/상태를 사용하며 정확한 전체 응답 뒤에만 결과를 반영합니다. `name=id`가 폼 속성을 가리지 않도록 폼 식별은 getAttribute로 읽습니다.
- 날짜 재선택/상세 닫기로 초안을 지우지 않고 다른 일정 편집·초기화 시 공통 확인을 받습니다. 달력 조회/오류 redirect·다른 연차 쓰기와 경쟁하지 않게 하며 다른 POST 초안과 삭제와 무관한 외부 일정 초안을 보존합니다. 계정/해제/timeout 및 전송 중 바뀐 입력에 이전 응답을 적용하지 않습니다.
- 실제 Razor/SSO/DB 및 Chrome 회귀에서 검증합니다. 입력/비활성 색은 의미 토큰을 사용합니다. 업무 정책·스키마·native 호환은 그대로이며 기존 달력 상세 프레임/관리자 강제 작업은 아직 전환 대상입니다. 상세는 모노레포 `packages/contracts/leave-external-schedules.md`입니다.

## 외부 일정 변경 서버 계약 (2026-09-10)

- 기존 외부 일정 native handler에 공통 폼용 JSON 응답을 추가했습니다. 현재 관리자·정확한 일정 번호·수정 전 fingerprint를 대조하고 문자열 ID·정규화 입력·이전/이후 기준값·달력 경로를 반환합니다. 잘못된 수정 번호를 신규 생성으로 처리하지 않습니다.
- 실제 인가/CSRF·직원 대상 정책·DB 스키마·기존 native redirect를 유지합니다. 감사 기록과 업무 저장은 별개이므로 예외는 미확정으로 안내합니다. native 실패는 허용된 입력만 인코딩해 보관하고 외부 일정 변경 UI를 잠급니다.
- 서버/원문 복구 화면은 통합 검증 대상입니다. 기존 달력 저장/삭제 클라이언트는 아직 native 호환 경로를 사용하며 공통 확인·전송·초안 보호 이관은 다음 단계입니다. fingerprint는 읽기 시점 대조이지 원자적 CAS나 영구 멱등성이 아닙니다. 상세는 모노레포 `packages/contracts/leave-external-schedules.md`입니다.

## 직원 신청 취소·철회 공통 폼 (2026-09-10)

- 목록과 월간 달력 상세의 Cancel/WithdrawCancel을 같은 `_SelfActionForm`과 공통 확인창·폼·상태에 연결했습니다. 사용 기간·사유·신청 번호를 확인하고 현재 직원 소유권/전체 신청 스냅샷을 서버에서 대조합니다. 승인 전 즉시 취소와 승인 후 취소 승인 요청을 혼동하지 않습니다.
- 관리자 승인과 직원 취소는 `LeaveRequestSnapshot.Compute`를 공유합니다. 기존 해시 정의를 보존했고 달력의 부분 날짜가 아니라 전체 신청 날짜를 사용합니다. 지난 날짜의 승인 대기 취소/취소 철회가 달력에서만 숨겨지던 부분을 목록/서비스 정책에 맞췄습니다. 승인된 과거 연차 취소 금지는 유지합니다.
- 신청/취소 동시 실행과 처리 중 목록/달력 교체를 막습니다. 동적 폼 해제 뒤 늦은 응답을 적용하지 않고, Escape로 공통 확인창만 닫힙니다. 다른 폼 초안이 있으면 성공 후에도 보존하고 새 탭 내역 링크를 제공합니다. 미확정은 자동 재실행하지 않으며 감사/알림 실패가 DB 롤백을 뜻하지 않는다고 안내합니다.
- 실제 격리 서버/Razor·브라우저 검사는 `LeaveSelfActionTests`와 `leave-self-actions.spec.mjs`입니다. 계약은 모노레포 `packages/contracts/leave-self-actions.md`를 따릅니다. 달력 관리자 강제 작업/외부 일정과 보정/정산 UI 전환은 아직 별도입니다. 운영 DB/신청/Discord는 변경하지 않았습니다.

## 직원 연차 신청 공통 폼 (2026-09-10)

- Apply native POST/CSRF를 공통 폼·확인창·상태에 연결했습니다. 새 화면은 `expectedEmployeeId`를 현재 로컬 직원과 대조합니다. 응답의 신청 ID·Pending 상태·입력·실제 근무일/차감 일수·이동 경로를 전부 확인한 뒤 성공을 반영합니다.
- 기존 근무일/공휴일·중복 신청·반차·가불/배정 정책은 유지합니다. 날짜·유형 바인딩 실패/중복 필드와 업무 기록 검증은 쓰기 전 422입니다. 확실한 입력 오류와 commit 후 감사/알림 오류를 구분하며 후자는 미확정 안내와 반복 신청 잠금으로 처리합니다. 내부 예외는 브라우저에 노출하지 않습니다.
- 확인 취소·패널 재열기·계정 변경 후에도 입력을 임의로 비우지 않습니다. 다른 POST 폼 초안이 있으면 저장 후 문서 이동 대신 승인 대기 안내와 새 탭 조회 링크를 제공합니다. GET 필터 기본값은 업무 초안으로 취급하지 않습니다. 해제/timeout 뒤 늦은 응답은 무시하고, 신청 관련 실패의 HTML 원문에는 허용된 업무 필드만 남깁니다.
- PC/모바일 입력 배열과 disabled 색은 공통 의미 토큰을 사용합니다. `LeaveApplicationTests`와 `leave-application.spec.mjs`에서 실제 격리 서버/Razor 및 브라우저 동작을 검증합니다. 취소/철회·달력 강제 작업/외부 일정 폼 전환은 아직 남아 있습니다. 상세 계약은 모노레포 `packages/contracts/leave-application.md`입니다.

## 승인·취소 승인·강제 삭제 공통 처리 (2026-09-10)

- `/Admin`의 세 native handler 폼을 `_ApprovalAction`으로 통일하고 `CompanyForm`/`CompanyDialog`/`CompanyState`에 연결했습니다. 현재 로컬 직원과 신청 스냅샷을 서버에서 대조하며, 정확한 처리 응답을 확인하기 전에는 완료 표시나 초안 정리를 하지 않습니다.
- 확인/전송/삭제 사유 입력 중에는 자동 대기열 교체를 보류합니다. 다른 행의 사유는 저장 후에도 유지하고, 목록 이동/새로고침으로 버릴 때 확인을 받습니다. 조회 장애는 빈 목록이나 자동 로그인 이동으로 바꾸지 않으며 처리 후 조회 실패는 처리 실패와 구분합니다.
- 계정 범위 변경·조회 권한 거부·해제 후 응답과 폴링은 이전 화면에 적용하지 않습니다. 버튼 간격·선택·위험/비활성 색은 공통 의미 토큰을 사용합니다. 새 공통 구조 우회 변이 검사와 실제 Razor/격리 DB·Chrome 회귀를 추가했습니다.
- 기존 연차 상태 전환·자기 신청 처리 금지·강제 삭제 정책·가불/배정·DB·감사·알림 로직은 유지합니다. 스냅샷은 handler 읽기 시점 검사이며 원자적 경쟁 제어가 아닙니다. 업무 변경 뒤 감사/알림 실패는 일부 반영 가능성을 안내합니다. 운영 신청/Discord는 사용하지 않았습니다. 상세는 모노레포 `packages/contracts/leave-approvals.md`입니다.

## 공통 이미지 편집 자산 갱신 (2026-09-10)

Portal 프로필과 프로젝트 아이콘 편집이 동일한 `CompanyImageEditor`를 사용하도록 공통 자산을 갱신했습니다. 프로젝트 아이콘은 별도 관리자/대상/이미지 버전 검증을 유지하며, 검증된 저장 후 기존 쿠키/storage 신호와 공통 context로 표시를 갱신합니다. Leave의 변경은 생성 자산 버전 참조뿐이며 자체 DB·인증·연차 handler를 변경하지 않았습니다. 실제 다중 출처의 동시 갱신이나 운영 배포 완료를 뜻하지 않습니다. 계약은 모노레포 `packages/contracts/profile.md`, `packages/contracts/project-icons.md`입니다.

## 공통 프로필 설정 자산 갱신 (2026-09-10)

Portal 개인 설정이 공통 폼·상태·확인창과 계정/사진 버전 대조로 전환되었습니다. 저장 확인 후 기존 프로필 쿠키/storage 신호를 발행하고 Leave 등 다른 탭은 공통 context에서 갱신된 사진을 읽습니다. Leave 자체 DB·프로필 읽기 권한·업무 handler는 바꾸지 않았으며 이 앱의 변경은 생성 자산 버전 참조입니다. 모노레포 `packages/contracts/profile.md`에 호환과 갱신 범위를 명시합니다.

## 공통 셸 알림 요청 수명주기 (2026-09-10)

공통 자산 갱신으로 상단 알림 조회/읽음은 `CompanyNotificationSession`의 계정 범위·15초 관찰 제한·공통 상태를 사용합니다. 요청 당시 회사 ID를 Portal이 대조하며, 계정 변경 뒤 이전 결과를 적용하지 않습니다. 확인된 읽음 완료와 후속 조회 실패를 구분하고 미확정 쓰기는 자동 재전송하지 않습니다. Leave 자체 알림 화면의 `CompanyForm`, 내부 HMAC·DB·읽음 handler는 이번 변경 대상이 아닙니다. Leave 코드 변경은 생성 자산 버전 참조이며 원본 계약은 루트 `packages/contracts/notifications.md`입니다.

## 통합 알림 ID 계약 (2026-09-10)

공통 셸 자산 갱신으로 Portal이 전달하는 알림 `sourceId`를 십진 문자열로 검증·표시·전송합니다. 최신 연차 알림 비교도 숫자 반올림 없이 수행합니다. Leave 내부 알림 모델·HMAC·소유자 검증·읽음 업무 handler는 변경하지 않습니다. 계약 원본은 모노레포 `packages/contracts/notifications.md`이며 Leave의 변경 파일은 공통 자산 버전 참조입니다.

## 공통 테마 검사 범위 보강 (2026-09-10)

- 루트 `check:ui`가 Pages와 wwwroot의 새 UI 소스까지 자동 수집하여 정의되지 않은 `--cw-*` 참조와 개별 재정의를 거부합니다. 정적 리터럴 검사이므로 모든 색 대비/동적 스타일의 적합성을 보장하지 않습니다.
- 뒤에 로드되는 mobile.css의 Discord 안내 코드 배경에 남아 있던 미정의 `--cw-input`을 `--cw-raised`로 수정했습니다. `leave-shell.spec.mjs`에서 실제 Razor의 320/390/1440px·light/dark 계산 배경색을 확인합니다. 인증·DB·알림 전송·OAuth 동작은 변경하지 않습니다.

이 문서는 LeaveManager를 안전하게 수정하기 위한 내부 작업 문서입니다. 구조, 인증, 권한, 환경 변수, DB 스키마, 페이지, 알림 또는 운영 절차가 바뀌면 이 문서도 함께 갱신합니다.

## 2026-09 통합 워크스페이스 구조

### 모노레포 공통 Razor 페이지 연결 (2026-09-10)

- 페이지·제목·메뉴·기존 서버 정책의 원본은 루트 `packages/contracts/pages.json`의 `leave` 항목이다. 공통 C# adapter를 `Workspace/*.g.cs`에 생성하며 직접 수정하지 않는다. 루트 `npm run page:new -- leave <slug> "제목"`과 `npm run build:ui`를 사용한다.
- `_Layout`은 공통 사이드바 mount와 등록된 현재 페이지/제목만 표시한다. 개별 페이지의 별도 Layout·Title·Authorize·경로 정의와 미등록 페이지는 자동 검사가 거부한다. 기존 handler, antiforgery, 연차 계산·승인·DB 경계는 유지한다.
- `/api/workspace/navigation`은 실제 EmployeeOnly/AdminOnly/MasterOnly 인가와 기존 중앙 세션 검증 뒤에서 허용 메뉴 ID를 반환한다. 회사 관리자/마스터의 Leave Master 투영은 그대로다. 인증되지 않은 메뉴 API는 로그인 HTML 대신 401이며, 비활성/권한 회수는 기존 403, 중앙 인증 장애는 기존 503을 유지한다.
- 승인 메뉴 배지는 허용된 관리자에게만 승인 대기와 취소 승인 대기 합계를 반환한다. 공통 메뉴가 배지를 렌더링하고 기존 승인 화면의 폴링이 `CompanyNavigation.setBadge`로 갱신한다. 0건은 숨기고 100건 이상은 99+로 표시한다.
- 내부 세션 확인은 named HttpClient `WorkspaceSession`으로 주입한다. 기존 5초 timeout·리디렉션 금지·HMAC 서명·Host 검증은 변경하지 않았다. 통합 테스트에서는 이 연결을 테스트 Portal에 붙여 실제 SSO/중앙 세션 검증을 수행한다. 운영 인증을 테스트용으로 우회하는 설정은 추가하지 않았다.
- 루트(`/`, `/Index`), `/Leave/Apply`, `/Leave/Calendar` 리디렉션과 기존 OAuth/SSO 경로는 유지한다. 새 업무 화면을 기술 엔드포인트 예외 목록에 넣어 검사를 우회하지 않는다.
- 모바일 폼의 고정 최소 열 너비와 직원 선택창의 intrinsic width를 해제하고 긴 Discord 환경 변수/URL은 줄바꿈한다. 폼 label과 안내 code는 테마 색상을 사용한다. 전체 문서 overflow를 잘라 숨기지 않는다.
- 검증: 루트 `npm run check`, `dotnet test apps/schedule/integration-tests/CompanyIntegration.Tests.csproj -c Release`, `npm run test:browser`. 합성 직원/신청 DB와 실제 Razor HTML을 사용하며 실제 운영 신청/승인은 하지 않는다. 공통 계정 필드·선택기·전체 표/폼의 후속 전환과 운영 이관은 별도 미완료 작업이다.

- 회사 직원·조직·역할·서비스 권한의 원본은 계속 Company Portal DB이다. Leave DB는 연차 프로필, 신청, 발생, 정산, 알림과 감사 기록만 소유한다.
- Portal의 `/workspace/{service}`가 공식 진입 경로이고 기존 서비스 서브도메인 및 `/Auth/{service}`는 호환 경로로 유지한다.
- Portal의 공통 셸 자산이 상단 앱 전환, 모바일 내비게이션, 테마 쿠키, 세션 만료 안내를 제공한다. 테마 선택은 `CompanyUiTheme` 쿠키로 `*.example.com`에 공유한다.
- Leave 알림은 Portal DB로 복제하지 않는다. `/api/internal/company-notifications`가 `aud=company-notifications`, `iss=company-portal`, 60초 만료, 일회용 `jti` HMAC Bearer를 검증한 뒤 회사 사용자 ID에 연결된 알림 읽기 모델만 반환한다.
- Portal 통합 알림센터는 Leave와 Schedule을 병렬 조회하고 부분 장애를 허용한다. 알림 상세·읽음 처리의 최종 소유권은 각 서비스에 있다.
- 웹 세션 기본값은 168시간 슬라이딩 만료다. 재직 상태와 권한 변경은 기존의 매 요청 검증 규칙을 유지한다.

## 1. 시스템 경계

### 팀 일정 부재 조회 API

- `format=calendar-v2`를 지정하면 `{items, holidays}`를 반환합니다. `holidays`는 같은 기간의 등록 공휴일 `{date,name}`만 포함합니다. 기존 형식 미지정 요청은 부재 배열을 그대로 반환합니다. 공휴일 원본은 연차관리이며 주간 일정에서 별도로 날짜를 추정하거나 저장하지 않습니다.
- 주요 일정의 남은 근무일 계산에는 별도 `GET /api/internal/schedule/holidays?from=YYYY-MM-DD&to=YYYY-MM-DD`를 사용합니다. 동일한 일정 서비스 Bearer 인증으로 연차 DB에 등록된 공휴일만 조회하며, 부재·외부 공휴일 정보는 포함하지 않습니다. 날짜 범위는 양 끝 포함 최대 73,050일 간격입니다.

`GET /api/internal/schedule/absences?from=YYYY-MM-DD&to=YYYY-MM-DD`는 팀 일정 서비스용 읽기 전용 API입니다. 날짜 범위는 양 끝 포함 최대 62일 간격이며 승인 완료와 취소 승인 대기 중인 휴가만 반환합니다. 취소 완료·반려·승인 대기는 제외합니다. 응답은 `employeeId`(CompanyUserId), `date`, `portion`(`full|morning|afternoon|other`)만 포함하며 사유·업무 계획·승인 메모는 노출하지 않습니다. 공용 계정과 Portal 연결이 없는 직원 기록은 제외합니다.

인증은 기존 `CompanyPortal:SsoSharedSecret`의 HMAC Bearer 토큰이며 issuer `company-schedule`, audience `schedule-absences`, subject `schedule`, 60초 만료·일회용 jti를 검증합니다. 내부 API 경로만 HTTPS 리디렉션을 제외하여 Docker 내부 호출을 수용합니다. 업무 일정·댓글·이미지는 일정 서비스 DB에서 관리하며 Leave는 부재의 원본으로 유지됩니다. 새 API는 연차 DB 스키마·신청·승인·취소 로직을 변경하지 않습니다.

LeaveManager는 **연차 도메인 전용 서비스**입니다.

```text
company-portal
  ├─ 회사 로그인
  ├─ 직원 정보 원본
  ├─ 회사 계정 활성/비활성
  ├─ 회사 역할 및 시스템 접근 권한
  └─ HMAC SSO 발급
        ├─ leave-system
        └─ CS
```

- 회사 계정과 시스템 권한의 원본: `company-org/company-portal`
- 연차 신청/발생/승인/알림/통계의 원본: 이 저장소의 SQLite DB
- Steam/PlayFab 운영 기능과 비밀키: `company-org/CS`
- LeaveManager가 CS 토큰을 발급하거나 CS 권한을 저장하면 안 됩니다.
- LeaveManager에는 독립 로그인, Google OAuth, 로컬 관리자 시드 또는 계정 생성 기능을 두지 않습니다.
- 회사 홈의 구조는 `회사 홈 → 연차관리 / CS / 향후 추가 시스템`이며 각 하위 서비스는 Portal SSO만 소비합니다.

## 2. 기본 정보

- 목적: 사내 연차/월차 신청, 승인, 취소, 통계, 공휴일, 감사 로그 관리
- 운영 URL: `https://leave.example.com`
- 로컬 URL: `http://localhost:5080`
- 기술 스택: .NET 10 ASP.NET Core Razor Pages, EF Core SQLite, Discord 알림, Docker Compose, Cloudflare Tunnel

## 3. 운영 데이터

Docker named volume을 사용합니다.

- DB: `leave-manager-data`의 `/app/data/leave-manager.db`
- DB 백업: `leave-manager-data`의 `/app/data/backups/`
- Data Protection 키: `leave-manager-data-keys`의 `/app/data-keys/`

DB 또는 인증 관련 수정 전에는 운영 volume을 삭제하지 않습니다.

## 4. 핵심 디렉터리

```text
Data/
  AppDbContext.cs        EF Core 모델/인덱스
  SchemaMigrator.cs      기존 SQLite 자동 보정

Models/
  Employee.cs            연차 로컬 프로필 및 연차 역할
  LeaveRequest.cs        신청/날짜/배정/가불
  LeaveGrant.cs          월차/연차 발생분
  OtherModels.cs         정산/감사로그/공휴일/알림/웹훅
  Enums.cs               연차 역할/상태/유형

Pages/
  Sso/Callback.*         Company Portal SSO 소비 및 로컬 세션 발급
  Sso/Provision.*        Portal outbox의 직원/권한 투영 수신(세션 미발급)
  Leave/Index.*          내 연차, 신청, 월간/연간 달력, 사용량
  Leave/Usage.*          연차년도별 사용 통계
  Admin/*                승인, 읽기 전용 직원 연결 현황, 공휴일, 감사, 정산, 보안
  Master/Employees.*     포털 연결 현황 확인
  Settings/Discord.*     개인 Discord 연동
  Notifications/*        앱 알림센터

Services/
  CompanySsoService.cs            Portal 토큰 서명/audience/만료/jti 검증
  CompanyEmployeeProjectionService.cs Portal 계정 정보를 로컬 연차 프로필로 투영
  LeaveRequestService.cs          신청/승인/취소/강제 조작 핵심 로직
  LeaveCalculationService.cs      잔여/가불/통계 계산
  LeaveAccrualWorker.cs            월차/연차 자동 발생
  NotificationService.cs          앱/DM 알림 생성
  NotificationTextFormatter.cs    외부 알림 공통 포맷
  AuditService.cs                 감사 로그
```

## 5. Company Portal SSO

필수 설정:

```dotenv
COMPANY_PORTAL_URL=https://company.example.com
COMPANY_SSO_ISSUER=company-portal
COMPANY_SSO_SHARED_SECRET=<Portal/Leave/CS 동일 값>
```

흐름:

1. 인증되지 않은 사용자가 Leave에 접근합니다.
   루트(`/`, `/Index`)도 별도 로그인 안내를 표시하지 않고 보호된 `/Leave/Index`로 이동합니다. 연차 세션이 없으면 아래 SSO 흐름으로 자동 연결되며, Portal에 이미 로그인한 직원에게 두 번째 로그인 버튼을 요구하지 않습니다. 루트 리디렉션은 `no-store`입니다.
2. `/Account/Login`이 `CompanyPortal:BaseUrl/Auth/leave`로 이동시킵니다.
3. Portal이 회사 로그인과 계정 활성 상태를 확인하고 기본 `leave.access`를 포함합니다.
4. Portal이 1분 유효 HMAC-SHA256 토큰을 `/auth/sso/callback`으로 POST합니다.
5. `CompanySsoService`가 `iss`, `aud=leave`, 서명, `iat`, `exp`, 일회용 `jti`를 검증합니다.
6. 콜백이 로컬 `Employee`를 연결하고 기본 7일 슬라이딩 로컬 쿠키 세션을 발급합니다.

알림과 승인 대기열처럼 JavaScript가 수행하는 백그라운드 요청은 세션 만료 또는 권한 부족 시
로그인 HTML로 리디렉션하지 않고 각각 `401`/`403`을 반환합니다. 화면 폴링이 회사 로그인
흐름을 반복 호출하는 것을 막고, 일반 브라우저 이동은 기존 SSO 로그인 흐름을 유지합니다.

SSO 토큰에 포함하는 직원 정보:

- Portal 사용자 ID (`sub`)
- 이름, 이메일, 부서
- 입사일
- 회사 역할 `role=employee|admin|master`
- 시스템 접근 권한 배열
- `iat`, `exp`, `jti`
- 선택적 로컬 `returnUrl`

회사 역할과 Leave 역할 매핑:

- Portal은 모든 활성 직원의 토큰에 기본 권한인 `leave.access`를 자동 포함하며, Leave는 서비스 경계에서 이를 반드시 검증합니다.
- 회사 `employee` → Leave `Employee`
- 회사 `admin` 또는 `master` → Leave `Master`

Portal의 회사 관리자와 마스터는 모든 시스템 접근 권한을 자동 포함합니다. Leave에서 둘 다
`Master`로 투영하므로 일반, `/Admin`, `/Master` 페이지 전체에 접근할 수 있습니다. 기존
`EmployeeRole.Admin` 값은 운영 데이터 호환을 위해 enum에 남을 수 있으나 새 SSO 세션은
생성하지 않습니다.

배포 순서 호환을 위해 `aud=leave` 로그인 토큰의 `role`이 누락된 경우에만
`leave.master` → `master`, `leave.admin` → `admin`, 그 외 → `employee`로 한시 변환합니다.
`role`이 포함된 로그인 토큰과 새 `aud=leave-provision` 계약에는 이 fallback을 적용하지 않습니다.

### Portal 프로비저닝

Portal은 직원·역할·접근권한 변경을 durable outbox에 기록하고 Leave의
`POST /Sso/Provision`으로 전달합니다.

`leave.access`는 관리자 화면에서 켜고 끄는 권한이 아니라 모든 활성 직원에게 적용되는
기본 권한입니다. Portal 시작 시 pending 행이 없는 모든 사용자를 다시 큐에 넣어 기존
Leave 투영도 현재 기본 권한 정책과 조정합니다.

- audience: `leave-provision`
- payload: 기존 SSO 직원 필드와 `role`, `permissions`, `active`, `iat`, `exp`, `jti`
- 인증: 로그인 SSO와 같은 issuer/shared secret의 HMAC-SHA256
- 재사용 방지: 로그인/프로비저닝 토큰의 `jti`를 만료 시각까지 한 번만 소비
- CSRF: cross-site 서버 POST이므로 antiforgery는 명시적으로 제외하고 HMAC을 필수 검증
- 응답: 성공/대상 없음 `204`, 연결 충돌 `409`, 토큰 오류 `401`, 서버 설정 오류 `503`
- 세션: 프로비저닝에서는 발급하지 않음

`active && leave.access`이면 프로필을 생성 또는 활성화합니다. 그렇지 않으면 기존 프로필을
비활성화하며, 프로필이 아직 없으면 새로 만들지 않습니다. 회사 Admin/Master는 Leave Master,
일반 직원은 Leave Employee로 투영합니다.

## 6. Employee와 Portal 계정 연결

`Employees.CompanyUserId`가 Portal 계정의 안정적인 연결 키입니다.

- 기존 운영 직원: 최초 Portal SSO에서 `CompanyUserId`가 null인 동일 이메일 직원을 찾아 연결합니다.
- 최초 전환 시 Company Portal의 `import-leave-employees` 명령으로 기존 직원을
  선이관하고 `CompanyUserId`를 미리 연결할 수 있습니다. 이관 전 양쪽 DB를
  각 Docker volume의 `backups/`에 백업합니다.
- 이후 로그인: `CompanyUserId`를 우선 사용합니다.
- 동일 이메일 직원이 이미 다른 `CompanyUserId`에 연결돼 있으면 재바인딩하지 않고 충돌로 처리합니다.
- Portal에서 이메일을 변경해도 기존 연차 기록의 `Employee.Id`는 유지합니다.
- 이름/이메일/부서/연차 역할/활성 상태는 provision에서 동기화하고, 활성 사용자의 다음 SSO에서도 보정합니다.
- 직원 계정과 접근권한은 `/Admin/Employees`에서 수정하지 않고 Portal `/Admin/Users`에서만 관리합니다.
- 기존 `SystemPermissions` DB 컬럼은 물리 DB에 남을 수 있으나 애플리케이션에서 사용하거나 새 DB에 생성하지 않습니다.
- `Employees.CompanyUserId`는 nullable unique index를 사용합니다.
- Portal 계정 삭제·퇴사 처리를 이유로 Leave `Employee`를 영구 삭제하지 않습니다. 접근을 차단해도 `Employee.Id`와 연차·신청·감사 기록은 보존합니다.

입사일은 연차 계산에 직접 영향을 줍니다. 신규 프로필 또는 지급·신청·정산 이력이 전혀 없는
프로필만 Portal 입사일로 동기화합니다. 이력이 하나라도 있으면 provision과 로그인 SSO 모두
기존 `HireDate`를 보존합니다. 입사일 정정은 양쪽 DB 백업, 기존 지급·배정·정산 영향 검토,
감사 로그를 포함하는 별도 연차 보정 절차로 처리합니다. 단순 재생성은 사용된 기존 지급분과
새 지급분을 섞어 중복 권리를 만들 수 있습니다.

## 7. 인증 및 로컬 세션

Company Portal SSO만 지원합니다. Portal URL이 유효하지 않거나 32자 이상의 SSO 공유키가
없으면 애플리케이션은 기동하지 않습니다. 로컬 세션은 기본 7일 슬라이딩 갱신을 사용합니다. 각 요청은 Portal의 sid와 현재 권한을 확인하므로 회사 전체 로그아웃·비활성화·권한 회수는 기존 로컬 쿠키가 남아 있어도 적용됩니다.

## 8. 연차/월차/가불 정책

- 입사 1년 미만: 월차 매월 1일, 총 11일 한도
- 입사 1년 이상: 입사일 기준 연차년도마다 연차 발생
- 1년차 15일, 이후 2년마다 +1일, 최대 25일
- 신청 가능일 계산에서 주말/등록 공휴일 제외
- 잔여량 부족 시 가불 가능
- 0년차 가불은 앞으로 발생할 월차를 먼저 소비
- 0년차 11일 한도 초과분은 1년차 연차 가불로 분리
- 1년차 이상 가불은 다음 연차 지급분에서 차감
- 반려/취소/강제 삭제 시 연결된 가불 정산도 되돌림
- `LeaveDayPortion.특수휴가`는 관리자 전용, 연차 미차감, 일반 신청 불가
- 특수휴가는 같은 날짜의 연차/반차와 중복 불가
- `LeaveDayPortion.기타`는 일반 신청 가능, 연차 미차감, 연차처럼 기간 신청 가능
- 기타는 같은 날짜의 연차/반차/특수휴가와 중복 불가하며 승인·알림 흐름은 일반 신청과 동일
- `LeaveDayPortion.Birthday`는 생일 앞뒤 30일 안에서 연 1회, 하루만 신청 가능하며 연차를 차감하지 않음
- 생일연차는 입사일이 귀속 생일보다 늦으면 사용할 수 없고 미사용분은 이월·지급하지 않음

## 9. 달력 표시

- `/Leave/Index?CalendarView=month|year`
- 월간/연간은 같은 `SelfOnly`, `ShowOthers`, `ViewEmployeeId` 상태를 사용
- 일반 직원의 다른 직원 표시: 승인 완료 연차만
- 연간 보기: 데스크톱 3열, 중간 2열, 모바일 1열, 각 월 6주 높이
- 연간 특정 월/날짜 클릭 시 해당 월의 월간 보기로 이동
- 월간 날짜 상세와 신청 기록에는 신청 사유와 업무 일정/인수인계를 모두 표시

## 10. 알림

- `NotificationMessageFactory`가 알림 Type/Title/Message/Link를 생성
- 앱 알림, Discord 채널 웹훅, Discord DM은 동일 payload 사용
- 관리자 승인 화면의 일반 승인/취소 승인 대기열은 상태별 건수와 관련 감사 로그 버전을 3초마다 확인하고, 변경 시 대기열 영역만 자동 갱신한다. 새 신청 알림을 수신하면 즉시 같은 확인을 수행한다.
- 외부 메시지는 `NotificationTextFormatter.BuildExternalContent` 사용
- 상대 링크는 `App:PublicBaseUrl` 기준 절대 URL로 변환

## 10-1. 관리자 전용 외부 일정 기록

- 관리자가 `/Leave/Index`의 월간 달력에서 날짜를 누르면 상세 창 안에서 외근·외부 일정·출장·기타 기록을 추가/수정/삭제한다.
- 직원, 시작일, 종료일, 구분, 메모를 저장하며 다일 일정도 지원한다.
- 월간 달력은 일정 기간의 각 날짜에 관리자 전용 일정 칩을 표시하고, 연간 달력에도 관리자에게만 요약 표시한다.
- `ExternalSchedules`는 `LeaveRequests`와 분리된 테이블이며 연차 차감, 잔여량, 사용 통계에 영향을 주지 않는다.
- 조회와 서버 CRUD 모두 현재 직원의 관리자 역할을 다시 확인하며 일반 직원 달력이나 API에는 기록을 노출하지 않는다.
- 추가/수정/삭제는 각각 `ExternalScheduleCreated`, `ExternalScheduleUpdated`, `ExternalScheduleDeleted` 감사 로그를 남긴다.

## 11. DB 변경 규칙

- 모델 컬럼 추가 시 `AppDbContext.cs`와 `SchemaMigrator.cs`를 함께 수정
- 운영 DB를 유지해야 하므로 새 컬럼은 기존 SQLite에 자동 추가되어야 함
- nullable/기본값을 고려해 기존 데이터로도 즉시 기동 가능해야 함
- 자동 백업은 `SqliteConnection.BackupDatabase` 사용
- `LeaveDayPortion` 값: FullDay=0, Morning=1, Afternoon=2, 특수휴가=3, 기타=4, Birthday=5

## 12. 보안/운영

- 일반 POST는 CSRF 검증 대상
- Portal SSO callback은 외부 cross-site POST이므로 `[IgnoreAntiforgeryToken]`을 사용하되 HMAC/만료/jti 검증을 반드시 수행
- 로그인 callback과 provision POST는 `[RequestSizeLimit(64 * 1024)]` 및 Content-Length 검사로 비인증 대형 form body를 차단
- 관리자/마스터 권한은 화면 숨김뿐 아니라 서버에서 다시 검증
- 회사 계정, 회사 역할, 시스템 접근권한을 Leave DB나 Leave 관리자 화면에서 직접 변경하지 않음
- 직원 영구 삭제로 연차 기록을 cascade 삭제하지 않음
- 강제 추가/삭제/보정은 사유와 감사 로그를 남김
- 운영 쿠키: Secure, HttpOnly, SameSite=Lax
- 인증 응답은 `Cache-Control: no-store`
- 호스트 포트는 `127.0.0.1:5080:8080`으로만 바인딩
- Cloudflare Tunnel은 Docker 네트워크에서 `http://leave-manager:8080`으로 접근
- 비밀값은 `.env`/Secret 저장소에서만 관리

## 공통 선택창 초성 검색 (2026-09-09)

- 공통 셸 JS를 `20260909.1`로 갱신했습니다. 직원 대신보기·신청·관리자 직원 선택 등 기존 검색형 목록에서 초성/이름 혼합 검색을 지원합니다.
- 예: `ㄹㅈㅈ`, `라ㅈㅈ`. 대소문자와 띄어쓰기 차이를 무시합니다. 검색 대상은 이미 권한 검사된 선택 목록이며 연차 데이터/인증/선택값은 변경하지 않습니다.

## 모바일 신청 내역 표 (2026-09-08)

- 모바일 카드형 표는 `table` 자체를 블록으로 전환하고 PC 전용 `colgroup`을 숨깁니다. 고정 열 너비가 남으면 모바일에서 표가 896px까지 늘어나 전체 페이지의 가로 빈칸과 상단 서비스 메뉴 오판정을 유발합니다.
- 업무 인수인계 텍스트의 220px 최소 너비를 모바일에서 해제하고 긴 단어도 줄바꿈합니다. 상태 배지는 단어를 보존하면서 공간이 부족하면 배지 단위로 줄을 바꿉니다. 넓은 일반 표는 표 컨테이너 안에서 스크롤합니다.
- `node scripts/preview-mobile.mjs`: 실제 CSS와 신청 내역 표 구조를 사용하는 127.0.0.1:19108 합성 미리보기입니다. 운영 API/직원 데이터는 사용하지 않습니다. 320·390·720px 카드와 1024px 이상 표, 서비스 메뉴 전환, 문서 가로 넘침을 함께 확인합니다.

## 13. 수정 체크리스트

- 인증/권한 변경 시 Portal/Leave/CS 세 서비스의 audience와 permission key를 함께 확인
- SSO payload의 `role`, `permissions`, `sub` 계약을 Portal/Leave/CS에서 함께 확인
- provision 변경 시 `aud=leave-provision`, `active`, 재사용 `jti`, 세션 미발급을 검증
- 직원 연결 로직 변경 시 이미 연결된 이메일의 다른 `CompanyUserId` 재바인딩이 불가능한지 확인
- 입사일 변경 작업은 기존 지급·사용 데이터 백업 및 중복 발생 검사를 포함
- 새 DB 컬럼 추가 시 SchemaMigrator 반영 확인
- 새 버튼/폼은 모바일/다크/라이트 모드 확인
- 알림 문구 변경 시 앱/웹훅/DM 일관성 확인
- 운영 배포 전 Release build와 Docker build 확인
- Company Portal의 책임을 LeaveManager로 다시 가져오지 않음

## 통합 워크스페이스 UI (2026-09-07)

- 공통 상단바 버전 `20260908.3`: 넓은 화면에서는 사용 가능한 서비스 링크를 가로로 표시하고, 실제 여유 폭이 부족하면 서비스 버튼으로 접습니다. 현재 서비스 강조와 권한별 필터는 두 형태에서 동일합니다. 연차 업무/인증/DB 변경은 없습니다.

- 상단바는 Company Portal의 `/js/company-workspace.js`, `/css/company-workspace.css`를 공통 사용합니다. 로고의 홈 이동, 종 모양 알림, 개인 설정/로그아웃, 권한별 서비스 전환, 테마를 한 곳에서 제공합니다.
- 공통 자산 변경 시 하위 서비스의 버전 쿼리도 함께 갱신합니다. Cloudflare에 이전 응답이 남을 수 있으므로 배포 검증은 실제 공개 자산의 내용까지 확인합니다.
- 서비스 내부 메뉴는 `.cw-sidebar`에만 배치합니다. 각 서비스에 별도 계정·알림·테마·회사 홈 버튼을 추가하지 않습니다. 사이드바 오른쪽 위 버튼으로 접으면 본문이 넓어지고 상단 버튼으로 다시 엽니다. 데스크톱 접기 상태는 `CompanySidebarCollapsed` 쿠키로 서비스 간 공유합니다. 900px 이하에서는 별도 모바일 열림 상태를 사용하며 메뉴 선택·바깥 클릭·Escape로 닫습니다.
- 테마는 의미별 `--cw-*` 토큰을 사용합니다. 선택/미선택 상태는 `aria-current` 또는 `aria-pressed`와 함께 표현하며 색 반전 필터를 사용하지 않습니다.
- `/api/workspace/context`가 실제 계정과 허용된 서비스만 반환합니다. 관리자 계정은 모든 서비스를, 공용 계정은 부여받은 서비스만 볼 수 있습니다. 화면 숨김과 별개로 각 서비스 백엔드도 권한을 검증합니다.
- 개인 설정 `/settings/profile`: 사진만 변경 가능합니다. 브라우저에서 가운데를 256×256 PNG로 변환하고 서버에서 크기/CRC/압축 해제 크기를 검증합니다. 이름·부서·역할 수정 API는 제공하지 않습니다.
- SSO 토큰과 서비스 세션에 `sid`가 포함됩니다. 서비스는 HMAC 서명된 60초 토큰(`aud=workspace-session`)으로 Portal의 `/api/internal/workspace/session`에서 세션과 최신 권한을 확인합니다. 로그아웃은 현재 브라우저의 sid를 폐기하므로 모든 하위 서비스의 기존 세션이 거부되며 다른 기기의 세션은 유지됩니다.
- 내부 인증 연결 실패는 503으로 실패 처리하며 인증을 우회하지 않습니다. Node 서비스의 내부 주소는 `COMPANY_PORTAL_INTERNAL_URL`(기본 `http://company-portal:8080`), Leave는 `CompanyPortal:InternalUrl`, Schedule은 `Portal:InternalUrl`입니다. Docker `company-services` 네트워크와 서비스 간 동일 SSO 키가 필요합니다.
- 알림 원본 DB는 각 서비스에 남습니다. 내부 GET `/api/internal/company-notifications?format=workspace-v2`는 `{items,unreadCount}`, 형식 미지정은 기존 배열을 반환합니다. 내부 POST `.../read?id=ID` / `.../read`는 서명 토큰의 사용자 소유 알림만 읽음 처리합니다. Portal은 권한 있는 출처만 조회하며 일부 실패를 UI에 표시합니다.
- Portal의 쓰기 API는 인증 쿠키와 `X-Workspace-CSRF`를 함께 검증하고 허용된 서비스 origin에만 CORS를 제공합니다. 각 서비스 CSP의 `connect-src`, `img-src`는 `https://company.example.com`을 허용합니다.
- 배포 시 Portal DB와 DataProtection 키를 백업하고 Portal 및 모든 하위 서비스를 함께 갱신합니다. 새 `WorkspaceSessions`/`WorkspaceProfiles` 테이블은 추가 방식이며 기존 직원·업무 데이터를 이동/삭제하지 않습니다. 구버전 서비스 세션은 최초 접근 시 한 번 SSO 재연결이 필요할 수 있습니다.
# 2026-09-07 프로필 연계 보완

- 공통 워크스페이스 자산 버전을 `20260907.4`로 갱신했습니다. Portal에서 프로필 사진을 변경하거나 삭제하면 다른 서비스에서도 갱신되며, 탭 복귀 시 최신 프로필을 조회합니다. 연차 데이터/권한/인증 방식 변경은 없습니다.

## 비공개 직원/회사 마스터 및 공통 프로필 (2026-09-08)

- Employees에 IsPrivate, IsCompanyMaster를 추가했습니다. 회사 포털의 서명된 프로비저닝/SSO를 통해 갱신합니다. IsCompanyMaster는 연차의 EmployeeRole.Master(회사 관리자도 매핑됨)와 반드시 구분합니다.
- 회사 마스터는 연차 직원 선택/승인 목록/일정 내보내기에서 제외합니다. 로그인, 관리자 기능, 기존 연차/감사 기록은 삭제하지 않습니다.
- 비공개 직원은 일반 직원용 달력에서 제외하고 관리자 화면에는 표시합니다. 공개 Discord 채널로 신규 신청을 전송하지 않으며 본인·관리자 알림은 유지합니다.
- 레이아웃의 로컬 EmployeeId→CompanyUserId 매핑은 현재 조회자에게 허용된 직원만 포함합니다. 공통 company-entities.js가 직원 선택을 검색형으로 보강하고 달력/승인/직원/사용 현황에 중앙 프로필을 표시합니다.
- 비공개 변경은 회사 포털 outbox로 전달되므로 프로비저닝 실패가 있으면 재시도 완료 여부를 확인합니다. 이름만 보고 부계정을 자동 지정하지 않습니다.

## 모노레포 공통 직원 선택 연결 (2026-09-10)

- 내 연차 대신보기·강제 신청·외부 일정과 관리자 사용 통계·보정·감사 로그의 직원 select에 `data-company-picker="employee" data-company-local="true"`를 명시합니다. 필드명으로 직원 선택 여부를 추측하는 기존 자동 연결을 제거했습니다.
- 중앙 `CompanyEntityDisplay`가 로컬 EmployeeId→CompanyUserId 매핑과 프로필 갱신을 처리합니다. 매핑이 없는 로컬 ID를 회사 ID로 대신 쓰지 않습니다. 사진 식별값과 실제 form value는 분리되며 기존 handler·연차 데이터 ID·변경 이벤트는 유지합니다.
- 선택창은 초성 검색·키보드·닫은 뒤 포커스 복원·form reset을 공통 지원합니다. 열려 있는 동안 옵션이 바뀌거나 비활성화되면 오래된 선택을 거부합니다. 사용자 범위 변경은 창을 닫으며 프로필만 바뀌면 검색어를 유지합니다.
- 공통 선택창의 한글 IME 조합 중 Enter/방향키와 keyCode 229 선택 방어를 추가했습니다. Leave는 생성된 공통 자산 해시 참조만 갱신합니다. 로컬/회사 직원 ID 매핑·form value·업무 handler·연차 데이터·서버 권한은 변경하지 않습니다.
- 비공개/회사 마스터 정책과 서버 인가, 지급 내역 ID의 의미는 바꾸지 않았습니다. 직원 ID가 아닌 grantId 선택창과 나머지 표/폼 전환은 후속 작업입니다.

## 알림 센터 공통 폼·상태 전환 (2026-09-10)

- `/Notifications`의 읽음·모두 읽음·확인은 native POST/위조 방지 토큰을 유지하면서 `CompanyForm`/`CompanyState`를 사용합니다. 서버 저장 완료 후 `workspace-form-v1` 응답의 작업·문자열 EmployeeId/알림 ID·로컬 이동 경로를 검증하고 읽음 표시를 반영합니다. 64비트 ID를 JavaScript Number로 바꾸지 않습니다.
- 새 폼은 `expectedEmployeeId`를 함께 제출합니다. 서버의 현재 직원과 다르면 쓰지 않으며 enhanced 요청은 이 값이 필수입니다. 기존 값 없는 native POST와 GET Open URL은 호환 목적으로 유지합니다. 현재 직원 소유권과 중앙 세션 검증은 별도로 계속 적용합니다.
- 저장 실패·미확정·계정 변경 뒤 자동 재전송하지 않습니다. 계정 변경은 이전 목록을 지우고 현재 계정의 목록을 GET으로 다시 확인하도록 합니다. timeout/화면 해제는 서버 롤백을 의미하지 않습니다. 읽음 완료와 상단 알림 갱신 실패는 분리합니다.
- 최근 표시 목록은 120개지만 ‘모두 읽음’ 노출 여부는 현재 직원의 전체 미읽음 수를 사용합니다. 서버는 기존처럼 현재 직원의 모든 미읽음 알림을 처리합니다. 원본 알림 DB·내부 통합 알림 API·Discord 전송·연차 승인 로직은 변경하지 않습니다.
- 알림 항목의 배경·구분선·유형·읽지 않음 표시는 공통 의미 토큰을 사용합니다. 실제 Razor/격리 DB 통합 검사와 `leave-notifications.spec.mjs`, 기존 Leave 셸 회귀로 모바일·테마·서버 인가·늦은 응답을 검증합니다. 나머지 연차 업무 폼/표 전환과 운영 검증은 계속 별도입니다.

## Discord 개인 알림 공통 폼·확인창 (2026-09-10)

- `/Settings/Discord`의 Save/Unlink/Test가 `CompanyForm`/`CompanyState`를 사용합니다. 서버 저장/수락 응답의 작업·문자열 직원/Discord ID·수신 설정을 검사한 뒤 반영합니다. 테스트 DM은 수신 설정 초안을 저장하지 않으며 실제 수신 완료를 보장하지 않습니다.
- Unlink와 저장하지 않은 초안을 버리는 Link 이동은 공통 확인창을 사용합니다. 입력을 잠그기 전에 복귀할 버튼을 캡처하여 취소 후 포커스가 돌아옵니다. Link는 OAuth redirect와 기존 10분 state cookie가 필요하므로 native POST이며 callback/Discord HTTP 서비스는 변경하지 않습니다.
- 새 폼의 화면 직원 ID와 설정 fingerprint를 현재 서버 직원/연결 설정과 대조합니다. 기존 값 없는 native POST는 호환 경로이고 enhanced 요청은 두 값이 필수입니다. 역할별 수신 카탈로그 정규화·CSRF·현재 직원 인가·DB 스키마는 유지합니다. fingerprint는 오래된 화면 검출이며 원자적 DB 경쟁 제어나 요청 멱등성 보장은 아닙니다.
- 미확정 결과는 자동 재전송하지 않으며 초안을 유지하고 현재 설정/DM 수신을 확인하도록 안내합니다. 계정 범위 변경은 이전 연결 정보와 확인창을 제거합니다. timeout/해제 뒤 늦은 응답을 UI에 적용하지 않으며 서버 롤백으로 설명하지 않습니다.
- 개별 다크 CSS와 안 쓰는 구형 Discord 메뉴 스타일을 제거하고 상태·선택·hover·포커스에 공통 의미 토큰을 사용합니다. 모바일 저장 안내는 고정 상단바 아래로 스크롤합니다. 실제 Razor/격리 DB·Discord HTTP 및 Chrome 회귀를 사용하고 운영 DM/설정을 변경하지 않습니다.

## 모노레포 감사 로그 공통 UI 전환

- `Admin/AuditLogs`의 검색·표시 개수·페이지 입력과 버튼/표는 공통 primitive를 사용합니다. 상세는 공통 `CompanyDisclosure`가 한 행만 펼치며 작업자 사진은 기존 로컬 직원 매핑을 사용합니다. 이름/감사 원문의 표시 정책은 그대로입니다.
- `audit-logs.js`는 읽기 전용 GET의 취소/15초 관찰/늦은 HTML 배제와 현재 직원·검색 조건 대조를 담당합니다. 일시 오류에는 마지막 정상 목록/입력을 유지하고 강제 이동하지 않습니다. 계정·권한 변경에는 이전 감사 본문을 지우고 공통 상태로 다시 열기를 안내합니다.
- 원문은 Razor 인코딩 상태로 표시해 큰 정수를 보존합니다. JavaScript가 없으면 기존 GET 폼/페이지 링크와 펼친 상세를 사용할 수 있습니다. 서버 관리자 정책·감사 DB·업무 쓰기/로그 기록은 변경하지 않습니다.
- 계약은 `packages/contracts/leave-audit.md`, 격리 서버 검사는 `LeaveAuditTests`, 실제 UI 검사는 `tooling/browser-tests/leave-audit.spec.mjs`입니다. 다른 페이지 및 운영 이관의 완료를 의미하지 않습니다.
