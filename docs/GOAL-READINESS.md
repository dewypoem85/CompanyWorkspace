# 통합 목표의 완료 판정과 남은 작업

180차에서 실제 게시 묶음을 운영 Compose와 직접 섞지 않고, 저장소·commit/tree·검증/게시 실행 및 정확한 여섯 GHCR digest를 다시 검증해 서비스별 digest-only override와 hash manifest를 생성하는 경계를 추가했다. 후보 생성은 기존 데이터/포트/network/env/command를 복제하지 않고 Docker·registry를 호출하지 않으며 `deploymentApproved:false`를 유지한다. 집중 10개와 루트 전체 384개가 통과했다. 첫 GHCR 게시, 서명 provenance, 백업·실운영 preflight와 build 금지 전환/롤백은 아직 남는다.

179차에서 원격 전체 브라우저 1,226개 중 유일하게 실패한 연차 승인 배지 역행을 실제 경쟁 조건으로 확인했다. 권한 스냅샷보다 늦게 갱신된 badge revision을 보존하고 이후 시작한 새 조회는 서버 값을 다시 적용하도록 수정했으며, 집중 navigation 18개·루트 378개·Razor 통합 196개와 실패했던 Chromium 시나리오가 로컬에서 통과했다. 실패한 run `34701556396`의 `required` 집계는 정상적으로 배포 가능 판정을 막았고, 수정 commit `5371b52fdfcca31bb8fd92bafb0aaf95d24d026c`의 원격 run `34703332199`는 16개 job과 브라우저 1,226개, artifact 8개를 모두 성공했다.

178차에서 현재 main의 성공한 전체 검증 실행만 GitHub API와 정확한 artifact로 재검증한 뒤 여섯 서비스를 빌드·격리 기동하고, 동일 로컬 이미지를 GHCR에 게시해 repository digest 여섯 개를 하나의 기록으로 묶는 수동 workflow를 추가했다. 자동 실행·이전 성공 run·다른 ref·matrix 축소·가변 태그·실패 무시를 정책/변이 검사로 거부하며 루트 377개가 통과했다. 현재 Free 비공개 저장소는 GitHub Artifact Attestation을 사용할 수 없어 서명 상태는 명시적으로 false이고, workflow는 아직 실행하지 않았으며 운영 승인이 아니다.

177차에서 비공개 `company-org/company-workspace` 원격을 생성해 현재 main과 21개 `archive/*` 보존 브랜치를 게시했다. 첫 push run `34696048728`은 공통/Node/.NET/React/통합, 여섯 Docker 이미지 격리 기동과 전체 브라우저 회귀 및 `required` 집계까지 모두 성공했고 검증 artifact도 확인했다. 첫 실행에서 확인된 Node 20 action 경고는 공식 최신 major(checkout/setup-node/upload v7, setup-dotnet v6, download v8)로 갱신해 정책 검사와 함께 봉인했다. 다만 비공개 조직 저장소의 branch protection/ruleset은 Free 요금제에서 HTTP 403으로 거부되어 실제 필수 check 보호는 적용되지 않았다.

176차에서 실행 중인 운영 컨테이너 여섯 개와 모노레포 Compose 후보를 읽기 전용 사전 검사로 다시 대조했다. 기존 Compose 프로젝트명을 유지해 해석했을 때 데이터 mount, loopback 포트와 network는 여섯 서비스 모두 정확히 같았고, 후보별 차이는 게시된 불변 이미지 digest가 없다는 `candidate-image-not-pinned` 하나뿐이었다. 운영 컨테이너·볼륨·환경·DB는 변경하지 않았다. 이 결과는 경계 보존 근거이지 이미지 출처, 백업·스키마 호환, 운영 인증·업무 조회, 전환·롤백 승인 증거가 아니다.

175차에서 로컬 checkout 검사와 별개로 여섯 원본 GitHub 저장소의 실제 `refs/heads/main`을 변경 없이 조회하는 `source:remote-check`를 추가했다. 2026-09-12 조회에서 여섯 원격 main은 모두 수입 commit과 정확히 일치했다. 원격 응답 누락·손상·수입 후 변경은 실패하며 집중 4개와 루트 366개가 통과했다. 이 확인은 원본 저장소의 branch protection이나 모노레포 원격·필수 검사, registry 게시·운영 전환 승인을 대신하지 않는다.

174차에서 최초 수입 보존 검사와 별개로 여섯 로컬 원본 checkout의 현재 drift를 다시 판정하는 `source:check`를 추가했다. manifest의 서비스/폴더/원격/commit/tree를 엄격히 검증하고, checkout 누락·dirty·main 이탈·remote 변경·수입 후 추가 commit·history 분기를 각각 실패시킨다. 실제 여섯 원본은 모두 clean main이며 수입 commit/tree와 정확히 일치했다. 집중 3개와 루트 365개가 통과했다. 이 검사는 fetch하지 않으므로 원격 서버의 새 commit 부재나 운영 전환 승인을 증명하지 않는다.

173차에서 images matrix의 여섯 개별 기록을 전체 CI 영수증과 결합하는 `workspace-image-verification-set-v1`을 추가했다. aggregate job은 정확한 run/attempt artifact만 내려받고, 현재 workflow/policy hash와 일곱 job 성공, 저장소·commit·tree, 서비스별 로컬 image ID·플랫폼·registry digest를 교차 검증한다. 누락·중복·다른 실행 기록은 실패하며 원본 artifact hash도 남긴다. registry digest가 모두 있어도 배포 승인은 false이고, 집중 16개와 루트 362개가 통과했다. 실제 registry 게시·서명 provenance·승인·운영 전환은 계속 남는다.

172차에서 native POST 정책을 파일별 개수 봉인에서 폼별 identity/구체 계약 봉인으로 올렸다. 현재 31개 폼은 handler/action/id/업무 marker 단위로 16개 파일에 고정되고, 같은 개수 안의 handler 변경과 범용 경계 문서를 소비자 계약처럼 쓰는 우회도 실패한다. Leave 대시보드 5개는 신청·관리자 강제 작업·외부 일정 계약으로 나눴고 Portal 직원 Add/BulkUpdate와 SSO launch에 전용 계약을 추가했다. 집중 10개와 루트 357개가 통과했으며, 정적 identity가 서버 인가·CSRF·트랜잭션이나 운영 저장을 증명하는 것은 아니다.

171차에서 여섯 CI 이미지의 빌드·기동 검사 결과에 저장소와 정확한 commit/tree/run/attempt, 서비스 태그와 content-addressed 로컬 image ID를 결합한 기록을 추가했다. 기록은 GitHub Actions의 깨끗한 정확한 checkout에서만 생성되고 배포 승인은 항상 false다. registry 게시·서명 provenance·원격 보호와 실제 운영 승격은 계속 남는다.

170차에서 여섯 Docker 이미지를 각각 격리 기동하고 최소 health JSON을 확인하는 CI 단계를 추가했다. 로컬에서도 별도 verify 태그와 임시 loopback 포트/UUID 컨테이너로 여섯 이미지를 확인했으며 운영 컨테이너·DB·볼륨·네트워크는 변경하지 않았다. 최소 health는 실제 로그인·권한·업무 의존성과 운영 전환의 증거가 아니다.

169차에서 브라우저 네트워크 목록의 일반적인 computed/indirect 우회면을 닫았다. `window['fetch']`, `fetch.call/apply/bind`, 전역 `XMLHttpRequest`, computed axios/sendBeacon과 literal `Reflect.get`도 기존 16개 transport 목록으로 계산한다. 현재 제품 소스의 호출 수는 변하지 않았고 집중 4개와 루트 345개가 통과했다. 계산 문자열·eval·임의 런타임 반사와 서버 인가는 별도 검증 대상이다.

168차에서 연차 대시보드의 raw HTML 조회를 1,100줄 Razor 본문에서 `leave-dashboard-read.js` 단일 transport로 분리했다. 페이지는 공통 read session과 화면 적용만 소유하고, transport가 동일 출처·허용 경로/필터·중복 query·HTML media type·redirect·취소를 검사한다. 집중 단위/구조 7개, 루트 344개, Razor 서버 196개와 실제 Chrome 42개가 통과했으며 다른 Leave transport와 운영 전환은 계속 남아 있다.

167차에서 native POST 봉인의 동적 우회면을 닫았다. submitter `formmethod`, JavaScript `.method`/`.formMethod` 할당과 `setAttribute`도 기존 31개 목록과 함께 검사하며, 현재 작성 소스에는 추가 동적 POST가 없음을 확인했다. 집중 4개와 루트 341개가 통과했다. 계산된 문자열·런타임 반사와 서버 인가/CSRF는 여전히 별도 검증 대상이다.

166차에서 HTML/Razor native POST 경계를 봉인했다. 작성 소스 147개의 현재 POST 31개를 검토된 16개 파일과 소비자 계약에 고정해 신규 페이지 폼·기존 수 증가·퇴역/손상 정책을 구조 검사에서 거부한다. 집중 4개와 루트 340개가 통과했다. 이는 기존 각 폼의 서버 인가·CSRF·트랜잭션이나 운영 저장 성공을 새로 증명한 것이 아니며, 실제 소비자 회귀와 운영 전환은 계속 남아 있다.

165차에서 연차 대신보기와 관리자 사용 통계의 직원 필터가 쓰던 inline `form.submit()`을 제거했다. GET 전용 `data-cw-auto-submit`과 공통 navigation의 guarded `requestSubmit()`으로 연결해 POST·비활성·진행 중·취소된 이벤트를 차단한다. 단위/구조 66개, Razor 서버 196개와 실제 Chrome 2개가 통과했으며 다른 화면의 이동/폼 수명주기와 운영 전환은 계속 남아 있다.

164차에서 브라우저 네트워크 소유권을 봉인했다. 작성 소스 167개의 raw 요청을 검토된 transport 16개로 고정하고, 신규 페이지 호출·기존 호출 증가·퇴역/손상 정책을 구조 검사에서 차단한다. Portal 직원 충돌 GET도 페이지에서 전용 checked transport로 옮겼으며 단위 11개, Razor 서버 196개, 실제 Chrome 집중 11개가 통과했다. 이는 남은 raw transport의 계약 전환이나 운영 이관 완료를 뜻하지 않는다.

88차에서 Portal 직원 일괄 저장의 충돌 비교 GET을 공통 `CompanyReadSession`에 연결했다. 계정 변경·페이지 이탈과 취소를 무시한 늦은 응답이 기존 직원 초안·64비트 기준 버전·동적 프로젝트 선택지를 덮지 않는다. 구조 단위 5개와 실제 Chrome 7개가 통과했으며, 다른 남은 raw 읽기/쓰기와 운영 전환은 계속 남아 있다.

163차에서 공통 셸의 회사 계정 context GET을 `CompanyReadSession`과 전체 응답 계약에 연결했다. 손상·취소·해제·늦은 응답은 정상 계정/서비스/프로필 화면을 덮지 않고, 저장 후 확인된 최신 사진·아이콘은 context revision으로 이전 주기 응답보다 우선한다. 계약/구조·단위 28개, 루트 327개와 Chrome 집중 2개가 통과했다. 다른 화면의 남은 raw 경로·폼과 최종 운영 전환은 계속 남아 있다.

2026-09-13, 178차 작업 기준이다. 이 문서는 개별 단계의 통과를 전체 목표 완료로 확대하지 않기 위한 점검표다. 이관 작업 기록은 `MIGRATION.md`, 실제 명령/화면 검증은 `DEVELOPMENT.md`, 운영 경계는 `DEPLOYMENT.md`를 따른다. 원본 운영 checkout은 아직 모노레포로 전환하지 않았다.

CS 미저장 초안 확인을 공통 dialog와 명시적인 비동기 disclosure 전환에 연결했다. 승인 전후 전체 초안/대상·노드 대조, 취소/해제·연속 클릭·중첩 창 포커스를 검증했다. 루트 268개, CS 단위 97개/브라우저 59개, 최종 모바일 버튼 보완 22개가 통과했다. 두 React 빌드·Razor 서버 196개와 여섯 서비스 전체 1,160개 회귀도 통과했다(16.7분). 같은 전체 실행의 여섯 서비스 대표 화면을 직접 확인했다. 당시 발견한 Sheet 모바일 소개 제목 줄바꿈은 87차에 수정하고 6개 viewport/theme 조합으로 검증했다. 계약은 `draft-transitions.md`이며 모든 Schedule 초안 전환까지 완료한 것은 아니다.

계정·사진·알림·Discord·정산 등의 native 작업 버튼 15개도 공통 primitive로 전환했다. 기존 저장/확인/권한·disabled 수명주기를 유지하며 별도 사진 버튼 skin을 제거했다. 루트 259개·Razor 서버 196개·집중 Chrome 95개와 실제 화면을 확인했다. 공통 CSS 변경의 여섯 앱 전체 1,138개 회귀도 종료까지 관찰해 통과했다(16.8분). 각 서비스 대표 화면과 영향을 받는 프로젝트 아이콘 편집 화면도 직접 확인했다. 계약은 `account-action-controls.md`이며 운영/전체 목표 완료 증거로 확대하지 않는다.

일반 Leave 업무 표는 공통 cards/key-value 변형·서버 레이블·value wrapper에 연결했다. 루트/서버 및 집중 Chrome 검증과 공통 CSS의 여섯 앱 전체 1,122개 회귀가 통과했다. 추가 native 8개와 실제 두 테마 캡처도 확인했다. 계약은 `responsive-tables.md`이며 전체 목표 완료 증거가 아니다.

82차에서 발견한 CS 라이트 안내문 대비 문제는 83차에 공통 `cw-callout`으로 전환했다. 네 화면 아홉 안내의 고정 글자색을 제거하고 실제 두 테마의 계산 대비·크기/폭을 검증했다. 집중 25개·native 8개와 실제 캡처, 같은 앱 코드의 여섯 서비스 전체 1,138개 회귀가 통과했다. 다른 앱의 남은 안내/상태 badge까지 완료한 것은 아니다. 계약은 `static-guidance.md`다.

일정과 연차 날짜 상세의 공통 프레임에 이어 연차 신청/날짜 상세·목록 취소/조회의 일반 필드·작업 버튼도 공통 primitive를 사용한다. 입력 원문·native 제약·직원 검색/초안·전송을 보존하며 실제 종료된 검사와 화면 검증 근거는 MIGRATION을 따른다. 카드·달력/표·링크·다른 소비자와 전체 운영 이관 완료로 확대하지 않는다.

연차 달력 갱신·날짜 상세의 직원 사진도 공통 entity 렌더러에 연결했다. 레이아웃의 로컬/회사 ID 문자열 매핑, 이름/상태 속성 분리와 본인 보기의 표시 대상 누락을 보완했다. 역할별 실제 Razor와 사진 갱신/폴백 검증은 `leave-calendar-entities.md`를 따르며 나머지 표시 위치/서비스의 완료 증거는 별도로 필요하다.

## 1. 저장소·책임·독립 실행

| 요구 | 현재 근거 | 남은 판정 |
| --- | --- | --- |
| 여섯 저장소의 이력·변경 보존 | `migration-sources.json`, `verify-import.mjs`, `source-drift.mjs`: 여섯 ancestry/exact import tree와 21개 보관 ref, 현재 로컬 checkout 및 GitHub 원격 main 6개 exact 확인 | 2026-09-12 조회 시점에는 추가 원격 변경이 없었다. 운영 동결 직전 `source:check`와 `source:remote-check`를 다시 실행해야 하며, 이 확인은 branch protection이나 모노레포 원격 구성을 증명하지 않는다. |
| 공통/서비스 책임 분리 | `packages/contracts/services.json`, 공통 UI 원본/생성 어댑터, `check-architecture.mjs` | 기존 앱별 UI/동작 중 아직 공통화하지 않은 영역은 아래와 같이 남는다. |
| 독립 빌드·테스트·배포 | 각 앱의 실행 정의와 Dockerfile, CI 여섯 이미지 matrix | 정의가 있다는 사실과 최종 커밋의 여섯 이미지 빌드·독립 운영 전환 성공은 다르다. 최종 산출물 검증과 롤백 리허설 필요. |
| DB·기존 URL·원본 보존 | 기존 서비스별 DB/세션 경계 유지, 이관 원본 ref, 실제 6개 운영 컨테이너와 후보의 mount/port/network 대조 | 2026-09-12 경계는 모두 일치했다. 원본 삭제/보관·원격 변경·운영 checkout 교체는 게시 이미지와 대상/계획 확정 후에만 실행한다. |

## 2. 셸·페이지·공통 UI

| 요구 | 현재 근거 | 남은 판정 |
| --- | --- | --- |
| 로고/서비스 메뉴·계정/프로필·알림·테마·사이드바 | 여섯 서비스 모두 shared navigation 등록, 공통 셸 및 생성 어댑터 | 최종 여섯 앱 회귀와 실제 화면 확인이 필요하다. 등록 값만으로 운영 적용이나 모든 본문 중복 제거를 증명하지 않는다. |
| 제목·위치·권한·본문 기반 페이지 | `pages.json`의 44개 페이지, `create-page.mjs`, 생성 서버/React 연결 | 새 페이지 생성 테스트를 유지한다. 생성된 준비 중 상태는 실제 업무 완성을 의미하지 않는다. |
| 입력/표/펼치기/확인/수정 비교/저장 안내 | `primitives`, `disclosure`, `dialogs`, `review`, `forms`, `states` 및 소비자별 계약 | 검사에 기록된 native primitive 부채는 0이다. 일정 관리 초안/삭제·댓글·업무 편집 취소/history·업무 링크·업무 창 닫기·TODO 편집 취소/대상·탭·페이지 이탈과 행 높이 range, 일정·연차 팝업과 연차 일반 컨트롤·업무/달력 표, 계정·알림 작업 버튼, CS 초안 확인·클립보드와 직원 관리의 동적 프로젝트 선택은 각 계약의 공통 코어로 연결했다. 검사 밖 UI와 실제 소비자 동작을 계속 확인하며 수치만으로 전체 완료하지 않는다. |
| 로딩·실패·권한 상태의 실제 동작 | 공통 상태 렌더러, CS/Leave/Sheet 및 Schedule 보드/업무·댓글 상세와 쓰기별 계약 | 현재 raw 브라우저 요청 16개와 native POST 31개는 모두 명시적 소유자·구체 계약에 봉인됐다. 이 목록은 의미 검증 완료가 아니므로 각 소비자의 실제 실패·권한·늦은 응답·미확정 저장 회귀를 계속 대조해야 한다. |
| 모바일/두 테마의 일관성 | 공통 의미 토큰·정적 검사, 실제 Chrome 너비/테마 시나리오 | Leave 달력 선호·공휴일 덮어쓰기·Discord 개인 DM, CS 정적 사용자 노출, 통계 필터와 일정 보드 설정 checkbox는 공통 단일 primitive를 사용한다. 개인 TODO 등 다른 checkbox·dialog 프레임·일부 장식/상태의 앱별 구현은 남으며, 일부 소비자의 가로 폭/계산 색 통과를 다른 컨트롤의 완료로 보지 않는다. |

### 106차 실제 primitive 잔여 소스 대조

83차의 40회 중 84~104차의 기존 전환에 이어 105차 Leave 월간 선택 달력 1회를 공통 달력 표 계약으로 전환해 기록 부채가 0회가 됐다. 106차부터 이 상태는 봉인되어 예외 재등록이나 봉인 해제로 되돌릴 수 없다. 숫자와 전체 UI/동작 완료는 계속 구분한다.

- 전환한 버튼 15회: Leave 로그인·정산 처리·기존 알림·Discord 설정, Portal 서비스 진입·통합 알림·개인 설정이다. `cw-profile-actions`는 배치만 남기고 실제 버튼은 `cw-button`을 소비한다. 기존 handler/disabled/권한·사진/알림 수명주기를 보존했다. 정산은 기존 POST 처리이며 로그인 fallback의 정상 노출 검증과 스타일 전환은 구분한다.
- 남은 동기 확인 0회: Schedule TODO의 페이지 이탈까지 공통 비동기 초안 확인에 연결했다.
- 연간·월간 달력 표는 별도 `cw-calendar-table`의 이름·요일 열·고정 격자 계약으로 옮겼다. 월간 날짜 메타데이터·공통 상세 버튼과 기존 범위 선택·공휴일·키보드 상세 진입도 실제 렌더링에서 보존했다.
- 전환한 range 1회: Schedule 직원 행 높이 입력은 공통 `cw-range`가 시각·포커스·비활성을 소유한다. 앱의 36~100px/4px 단위·출력·선호 저장과 실제 행 계산은 보존하고 모바일/PC·두 테마에서 검증한다.
- 동적 native 생성 0회: Leave 달력 선호 입력은 서버 렌더링으로, Portal 프로젝트 checkbox와 CS clipboard fallback textarea는 공통 소유자로 전환했다.

이 분류는 현재 `primitiveViolations`와 각 실제 소스를 읽은 근거다. 기록 부채 0은 검사 밖의 링크·checkbox·카드·개별 CSS·요청 수명주기까지 완전 조사했다는 뜻이 아니다. 다음 UI 작업은 실제 소비자의 중복 소유권과 완료 기준의 남은 전 서비스 증거를 계속 대조한다.

### 초안 확인 전환에서 확인한 실제 연결 경계

- CS의 이전 native confirm 두 표기는 두 동작만 의미하지 않는다. `confirmDiscard`의 저장소 상세 키 변경, 서버 변경, 새 조회/새로고침, 키 추가/삭제, 저장 후 최신 목록 확인과 `resetEditor` 원래 값 복원을 모두 공통 확인으로 연결했다. 취소 시 원래 상세와 편집 원문·서버 선택을 보존하며 실제 대상 변경 직전에 승인 스냅샷을 다시 대조한다.
- `CompanyDisclosure.setOpen`의 `beforeChange`는 동기 boolean만 허용하고 Promise를 명시적으로 거부한다. 85차의 별도 `beforeRequest`/`requestOpen`은 먼저 확인을 기다린 뒤 패널/표시 상태와 최종 동기 가드를 통과해야 적용한다. CS가 이를 소비하며 직접 동기 전환으로 초안 보호를 우회하지 않는다.
- 일정 관리·버전 편집과 업무 상세 창은 generated `useWorkspaceNavigationRequest`/`beforeCloseRequest`로 비동기 이동·닫기 승인을 요청한다. `useWorkspacePage`는 확인 전 URL을 유지하고 거부한 history 이동을 복구하며, owned modal은 닫기/Escape/외부 close를 같은 승인에 연결한다. 댓글 편집기 내부 3경로는 초안 변경 횟수·대상·계정을 적용 직전에 다시 대조한다. TODO의 남은 동기 경로도 확인창 API만 바꾸지 않고 실제 선택·탐색 수명주기와 함께 전환해야 한다.
- 브라우저 자체 새로고침/탭 닫기의 `beforeunload`는 앱 팝업과 다른 제약을 가진다. 기존 저장/초안 보호를 제거하지 않는다. 공통화 후에도 확인 중 계정 변경·해제·다른 대상/초안 변경, 연속 클릭과 중첩 창의 포커스를 검사한다. 현재 CS/일정 브라우저의 native dialog 수락/취소 검사는 소비자 전환과 함께 공통 창 검사로 바꾸되 기존 취소·초안 보존 단언을 유지한다.

CS와 공통 disclosure는 85차, 일정 버전과 설정 초안 팝업/라우팅은 86·89차, 업무·댓글 전환과 업무 창 닫기는 91~96차, TODO 편집 취소·대상·탭 전환은 97~99차에 구현·집중 검증했다. TODO 페이지 이탈 등 다른 초안 소비자는 별도 후속 구현 경계로 남는다.

## 3. 계정·엔티티 데이터 계약

| 요구 | 현재 근거 | 남은 판정 |
| --- | --- | --- |
| 직원 사진/초성검색/비공개 정책 | 공통 entity 표시/선택/검색, 서비스 서버의 디렉터리 필터와 통합 테스트 | 남은 표시 위치와 최종 서비스별 실제 역할 검증을 확인한다. 클라이언트 필터는 서버 인가를 대신하지 않는다. |
| 프로젝트 아이콘/검색/비공개 정책 | 공통 project 표시/선택 및 프로젝트 아이콘 저장 계약 | 업무 본문 원문이나 이미 발송된 메시지까지 자동 익명화한다고 주장하지 않는다. |
| 신규/기존 계정 필드 일치 | 공통 `AccountFields`/`AccountInput`/`_AccountField`, 신규/일괄 수정의 검증 | 기존 단건 호환 경로와 신규 공통 전송의 범위는 구분한다. 최종 등록/수정의 모든 필드·권한 조합 회귀 필요. |
| 프로필/권한/서비스 갱신 및 API 인가 | 중앙 세션 검사, 서버 메뉴/디렉터리, 공통 범위 변경 이벤트 | 모노레포 운영 전환 후 실제 여섯 서비스 연계 확인이 필요하다. 합성 HTTP 성공을 실운영 SSO 성공으로 보고하지 않는다. |

## 4. 강제 규칙·회귀·운영 차단

| 요구 | 현재 근거 | 남은 판정 |
| --- | --- | --- |
| AI 필수 참조·금지 패턴 | 루트 `AGENTS.md`, 개발/구조 문서와 소비자별 계약 | 새 기능 추가 시 필요한 공통 소유자를 확장하고 지침만으로 강제를 대체하지 않는다. |
| 생성 도구·구조/의존/테마 검사 | `page:new`, 생성 바이트 대조, architecture/primitive 검사 및 변이 테스트 | 정확한 기존 예외를 새 코드의 우회로로 늘리지 않는다. 소스 패턴 검사는 완전한 의미/보안 분석이 아니다. |
| PC/모바일·테마·역할 회귀 | 공통/앱 단위, 격리 서버 통합, 여섯 앱 Chrome 시나리오 | 마지막 코드에 대한 종료된 결과와 실제 캡처를 남긴다. 진행 중 검사는 완료 증거가 아니다. |
| 검사 실패 시 병합·배포 차단 | 원격 첫 main run의 일곱 필수 영역과 `required` 집계 성공, 정책/변이 검사 | 비공개 조직 저장소가 Free 요금제라 branch protection과 ruleset이 모두 403으로 거부됐다. Team 이상으로 올리거나 공개 전환하지 않는 한 필수 check·PR·관리자 우회 금지는 실제 적용되지 않는다. 저장소는 공개로 바꾸지 않는다. |
| 산출물 출처·단계적 배포·복구 | 서비스별 이미지 검증/게시 기록, 여섯 이미지 묶음, 수동 GHCR 게시 workflow, digest-only 후보 생성기, `deployment-preflight.mjs`와 `DEPLOYMENT.md` | 현재 main 성공 run만 게시하고 그 정확한 여섯 digest만 후보로 만들도록 구현했지만 아직 workflow를 실행하지 않아 registry digest가 없다. Free 비공개 저장소에서는 GitHub 서명 provenance를 쓸 수 없다. 게시 실행·대상 승인·백업·build 금지 실제 전환/롤백이 필요하며 어떤 JSON도 운영 승인이 아니다. |

## 다음 순서

1. 84차 전체 브라우저 1,138개의 종료 결과와 대표 화면 확인을 MIGRATION에 기록했다. 앞선 단계의 루트/React/서버·Chrome 종료 결과와 시각 검증도 해당 기록을 따른다. 운영 SSO·원격 필수 검사·배포/롤백의 증거로 확대하지 않는다.
2. 봉인된 raw 요청 16개/native POST 31개의 각 소비자 의미를 실제 서버·브라우저 회귀와 대조한다. 이미 전환한 일정 상세/업무·댓글·이미지·주요 일정, 연차 신청·날짜 상세·관리 작업, Portal 계정·조직, CS/통계/시트 경계를 우선하며, 사용하지 않는 모듈과 실제 화면을 구분하고 단순 수치 감소를 목표로 하지 않는다.
3. 수동 GHCR 게시 workflow의 원격 CI 검증을 먼저 통과시킨 뒤 별도 승인으로 실제 게시를 실행해 여섯 digest를 확인한다. branch protection과 서명 provenance는 조직 요금제 지원 전까지 미완료로 유지한다. 원본 저장소와 운영 데이터는 보존한다.
4. 최종 커밋에서 전체 검증·서비스별 빌드/배포/롤백과 실제 화면/연계를 확인한다. 위 항목 중 미완료·간접 증거·누락이 하나라도 있으면 전체 목표를 완료 처리하지 않는다.

## 최근 진행: 시트 저장 경계

시트의 두 실제 실행 POST는 공통 `CompanyForm` transport와 `workspace-form-v1` 영수증으로 전환했다. 분석/미리보기·문서·전체 실행 결과가 전송 명령과 일치해야만 성공 처리하며 timeout·계정 변경·불완전 응답은 자동 재전송하지 않는다. 성공 후 묶음 조회도 공통 `WorkspaceReadSession`의 30초·화면/계정 취소 경계로 이동했다. 서버는 회사 actor와 분석/미리보기 기준 헤더를 세션·본문에 다시 대조한다. 영구 멱등성 및 Google/DB 트랜잭션 revision은 남아 있으므로 이 항목만으로 목표 완료나 운영 배포 가능 상태로 보지 않는다.
