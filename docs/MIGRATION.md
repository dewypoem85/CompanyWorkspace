# 모노레포 이관 기록

## 210차: 생일연차 신청과 사용 가능 안내 (2026-09-29)

- 생일 당일 앞뒤 30일 안에서 하루를 선택하는 `생일연차` 신청 유형을 추가했다. 일반 연차 잔여량과 가불에는 영향을 주지 않고, 입사일이 귀속 생일보다 늦거나 같은 생일 혜택을 이미 사용 중이면 일반 신청을 막는다. 2월 29일생은 평년 2월 28일을 기준으로 한다.
- 본인 대시보드 상단과 신청 폼에 사용 가능 기간·사용 완료·예정 상태를 안내한다. 본인과 관리자는 실제 생일연차 유형을 보지만 다른 직원 달력과 공용 Discord 채널에서는 일반 연차로 마스킹한다.
- 관리자는 사유를 남기는 강제 추가에서 기간·입사일·연 1회 제한을 예외 처리할 수 있다. 신청에는 귀속 생일과 정책 예외 여부를 저장하고, 활성 일반 신청의 직원·귀속 생일 중복을 DB 고유 인덱스로 막으며 예외와 신청은 감사 로그에 남긴다. 과거 자동 지급 기록은 보존하되 새 지급분은 만들지 않는다.

## 209차: Leave 가불을 실제 지급·사용 장부에 자동 연동 (2026-09-23)

- 신청 당시의 가불 값을 고정해 두던 방식을 보완해 현재 연차년도의 유효 지급분, 관리자 증여·회수, 정산, 승인·승인대기 사용량을 한 번에 재배정한다. 지급분과 가불이 같은 신청에 중복으로 붙었던 기존 기록도 서비스 시작 시 자동 정규화한다.
- 월차 발생은 같은 연차년도 가불을 실제 배정으로 전환하고, 입사 1주년 연차 발생은 직전 연차년도 연차 가불을 정산으로 차감한다. 신청·관리자 강제 추가·반려·취소·삭제와 발생분 추가·보정·삭제, 소멸·이월·보상에도 같은 재계산을 연결했다.
- 11.5일 지급·12일 사용 시 실제 부족분 0.5일만 가불로 남는 회귀, 양수 증여 후 가불 해소, 음수 회수 후 가불 재발생, 월차/연차 갱신 상환을 격리 SQLite 통합 검사로 확인했다. 운영 데이터 보정은 배포 전 백업 뒤 새 서비스 기동 작업이 수행한다.

## 208차: 통계 React 화면을 회사 공통 셸로 재연결 (2026-09-22)

- ClickHouse 전환 때 새 React 진입 문서에서 빠졌던 `data-company-workspace` 마운트를 복구하고, 통계가 직접 그리던 Game Pulse 브랜드·사이드바를 제거했다. 회사 공통 헤더, 계정·알림·서비스 전환·테마와 권한 기반 통계 메뉴를 실제 `cw-sidebar`/`workspace cw-main` 구조로 연결했다.
- 기간·날짜·버전·모드·최소 단계와 중간보스 조건, 분석 탭·정렬·페이지 이동·검색·표를 공통 입력/checkbox/버튼/표 primitive로 바꿨다. 통계 고유 차트·아이콘·노드 트리·툴팁은 유지하고 앱 CSS의 전역 `aside`·`nav`·`header`·`button` 및 고정 다크 팔레트를 제거해 공통 라이트/다크 토큰을 사용한다.
- 공통 메뉴 링크와 React의 URL 필터/상세 라우팅을 같은 브라우저 이력에 연결하고 경로 변경 때 공통 현재 메뉴와 모바일 페이지 제목을 갱신한다. 통계 앱 102개, 타입/서버 구문 검사와 Vite 빌드, 루트 공통 UI·primitive·구조 검사가 통과했다. 운영 컨테이너 반영과 실제 인증 화면 확인은 이 기록 이후 별도로 수행한다.
- 통계 웹 컨테이너 분리 뒤 남아 있던 배포 사전검사의 이전 `game-statistics` 컨테이너 식별자를 실제 `statistics-web`으로 맞추고 배포 문서의 웹·워커·ClickHouse 경계를 갱신했다.

## 207차: 통계 조회 경로를 ClickHouse 기반으로 전면 재구축 (2026-09-21)

- 사용자 요청마다 SQLite 원문을 순회하거나 필터별 JSON snapshot을 만드는 구조를 제거하고, 웹·집계 워커·ClickHouse를 별도 컨테이너로 분리했다. 출정·보스·빌드 구성요소 사실 테이블과 일 집계를 두고 완료 revision만 원자적으로 공개한다.
- React·TypeScript·Vite SPA와 `/api/v2/statistics`의 대시보드·결과·빌드·보스 목록/상세 API를 추가했다. 서버 정렬·검색·50개 페이지네이션, URL 필터 복원, 이전 요청 취소, ETag/메모리 캐시, 해시 정적 자산 캐시와 SSO 검증 단일화를 적용했다.
- Azure 원본은 영구 보관하고 ClickHouse 분석 원본·구성요소·일 집계는 최근 90일만 TTL로 유지한다. 기존 90일 SQLite 인덱스 25,334,904건을 초기 백필 원본으로 사용하며, 실측 압축 환산 약 67.6GB·2배 안전 기준 약 135GB가 당시 가용 약 702GB 안에 들어오는 것을 확인했다.
- 최초 발행 전에는 유지보수 화면을 표시하고 기존 SQLite 볼륨과 이전 이미지 ID를 롤백 자료로 보존한다. 단위 검사·TypeScript/문법 검사·Vite 빌드·격리 ClickHouse 전체/증분/무변경 smoke를 통과했으며 운영 90일 백필과 완료 후 부하 검증 결과는 완료 시 별도로 기록한다.

## 206차: 연차 달력에 일정 주요일정 연결 (2026-09-21)

- Schedule에 Leave 전용 읽기 API를 추가해 실제 로그인 actor의 일정 접근과 공개 프로젝트 범위를 다시 확인하고, 지정 기간의 기본·추가 주요일정을 최소 발생 모델로 반환했다. Leave가 Schedule DB를 직접 읽거나 데이터를 복제하지 않는다.
- Leave 월간·연간 달력과 날짜 상세에 `📌` 주요일정 칩을 추가했다. 제목·유형·프로젝트 원문은 Razor/DOM 텍스트 경계로 렌더링하며 연차 차감·신청·승인·외부 일정 쓰기에는 포함하지 않는다.
- 전용 timeout·redirect 금지 클라이언트가 상태/JSON/ID/길이/유형/날짜 범위를 확인한다. Schedule 장애나 형식 오류 시 주요일정만 비우고 기존 연차 달력과 부분 갱신을 유지한다. 서버 공개 범위·실제 Razor·PC/모바일 및 두 테마 브라우저 검증을 추가했다.

## 205차: 업무 실제 날짜 기능 제거와 실선 통일 (2026-09-21)

- 사용되지 않던 실제 시작일·실제 종료일 입력과 목표/실현 비교 토글, 별도 조회 기준, API 필드를 제거했다. 업무는 시작일·종료일 한 쌍만 사용한다.
- 업무와 완료 업무의 카드 테두리를 실선으로 통일했다. 보기 설정에는 상세 보기와 행 높이만 남겼다.
- 기동 스키마 전환은 관련 인덱스와 `ActualStartDate`·`ActualEndDate` 열을 재실행 가능하게 제거한다. 배포 전 DB 백업을 만들고 업무 ID·기존 시작일·종료일·본문·댓글·첨부·이력을 유지한다.

## 204차: 주요 일정 공동 편집과 변경 이력 (2026-09-21)

- 주요 일정 생성·수정을 일정 접근 권한이 있는 모든 활성 개인 계정에 열었다. 일정 관리 메뉴와 편집 기준 조회도 같은 범위로 맞췄으며, 삭제와 업무 보관함은 기존처럼 관리자·부서 책임자 또는 관리자에게만 노출하고 서버에서 재검증한다.
- Milestone에 생성자·생성 시각·최근 수정자·수정 시각을 추가하고 생성·수정마다 actor와 변경 전후 스냅샷을 별도 이력으로 저장한다. 편집 화면은 등록·최근 수정 정보와 제목·프로젝트·타입별 마감·상세 내용의 전후 값을 표시한다. 기존 행은 작성자를 임의 추정하지 않고 `이전 기록`으로 표시한다.
- 기동 스키마 전환은 감사 열과 이력 테이블을 재실행 가능하게 만든다. 일반 직원 생성·수정과 관리자 삭제, 작성자/수정자 및 변경 전후 이력, 기존 DB 전환을 서버 검사로 확인하고 Schedule 단위 검사와 TypeScript/배포 빌드를 통과했다.

## 203차: 주요 일정의 타입별 기간을 단일 마감일로 전환 (2026-09-18)

- 주요 일정의 각 타입은 시작일·종료일이 아닌 마감일 하나를 가진다. 기존 기간 기록은 마지막 날짜를 마감일로 옮기고 종료일을 비우며, 같은 게시글의 제목·내용·프로젝트·타입과 다른 날짜는 유지한다.
- 일정 DB 기동 전환은 트랜잭션으로 수행하고 변경된 행의 버전을 올린다. 재실행해도 날짜나 버전이 다시 바뀌지 않는다. 이전 데이터가 있는 운영 볼륨은 전환 전에 백업한다.
- 기존 API의 종료일 입력은 호환성을 위해 받되 마지막 날짜를 단일 마감일로 정규화한다.

## 202차: 연차 대시보드 보기 전환의 새로고침 제거 (2026-09-18)

- 관리자 `자기것만 보기`와 직원 `다른 사람 연차도 같이 보기`는 기존 서버 GET 저장을 유지하되 달력만 다시 받아 교체한다. 관리자 `대신보기`는 직원별 잔액·신청 내역·쓰기 권한이 달라지므로 공통 본문 라우터로 대시보드 본문만 전환하고 상단·사이드바는 유지한다.
- JavaScript 없는 native GET, 미확정 쓰기·초안 이탈 보호, 직원/역할 대조와 최신 조회 판정을 유지한다. 실제 Razor 응답의 관리자·직원 전환과 취소된 대신보기의 초안 보존을 브라우저에서 검증했다.

## 201차: 같은 서비스의 탭 전환 수명주기 (2026-09-18)

- Portal·Leave·CS의 등록 메뉴에 서버 GET 본문 전환을 연결했다. 공통 문서·계정바·사이드바를 유지하고 URL·뒤로가기·제목·현재 메뉴·스크롤·포커스를 갱신한다. 로그인, 서비스 간 이동, 다운로드와 폼 제출은 기존 문서 이동이다.
- Portal 조직·계정·개인 설정, Leave 신청/승인·관리/설정, CS 환불/상품/로그/플레이어 화면의 초안·진행 중 작업을 이탈 전에 확인하고 리스너·폼 세션·읽기를 정리한 뒤 재시작한다. 서버 업무 데이터와 권한 검사는 캐시하지 않는다.
- 동일한 계정 컨텍스트는 전체 헤더를 다시 그리지 않고 검증 이벤트만 내보낸다. 동시에 들어온 메뉴 권한 조회는 하나로 합치며 정기 검사는 유지한다. 화면별 계약은 `packages/contracts/page-navigation.md`다.

## 200차: 생일 연차 혜택 중단, 달력 표시 유지 (2026-09-17)

- 생일 당일 신규 연차·반차와 관리자 강제 추가를 평소 차감 규칙으로 처리하고, 미사용 생일 `+1일` 자동 발생을 중단했다. 관리자 수동 지급도 `Birthday` 유형은 거부한다.
- 월간·연간 달력과 날짜 상세의 생일 및 케이크 아이콘, 본인·관리자 공개 범위는 유지한다. 기존 무료 생일 연차와 지급 기록은 삭제하지 않고 정산·보고에 반영한다.
- 직원 신청, 관리자 강제 추가, 발생 작업과 과거 기록 보존 회귀 검사를 추가했다.

## 199차: 모바일 공용 탐색 복구와 일정 보드 가독성 (2026-09-17)

- Android 앱이 회사 공용 웹 상단바를 강제로 숨기던 코드를 제거했다. 서비스명·현재 하위 페이지, 사이드바, 계정, 테마, 알림과 서비스 전환은 다시 한 공용 셸에서 관리하고 앱은 하단 빠른 이동만 유지한다.
- 공용 상단은 좁은 화면에서 현재 하위 페이지 이름을 별도 줄로 표시한다. 페이지 이름은 등록된 페이지 계약에서 읽고 SPA 경로 변경 시 갱신한다.
- 팀 일정의 모바일 보기·분류 버튼, 날짜 이동, 필터 및 보드 작업 버튼이 폭 부족으로 눌리지 않게 줄바꿈·전체 폭 배치를 적용했다. 모바일 일정 카드의 흰 배경도 공용 light/dark 표면 토큰으로 교체했다.
- Android 1.1.8 서명 APK와 Schedule 빌드를 만들고, 공용 탐색 단위 검사 및 Schedule 320/1440px 양 테마·CS/Statistics 320px 다크 브라우저 회귀를 통과했다. 운영 웹 배포와 실기기 확인은 별도다.

## 198차: 연차 달력 생일 아이콘 추가 (2026-09-16)

- 월간·연간 생일 칩과 날짜 상세의 생일 정보 앞에 장식용 케이크 아이콘을 추가했다. 아이콘은 접근성 이름에서 제외하고 기존 직원 이름과 생일 문구를 그대로 유지한다.
- 모바일 달력에서도 아이콘이 보이도록 보조 문구와 다른 내부 요소로 배치하고 실제 두 화면 크기·두 테마 브라우저 검사에 아이콘을 포함했다.

## 197차: 연차 달력 생일 표시 (2026-09-16)

- 월간·연간 연차 달력과 날짜 상세에 생일 칩을 추가했다. 일반 직원은 본인 생일만 보고, 관리자·마스터는 전체 보기에서 활성 실제 직원의 생일을 볼 수 있다. 관리자 자기것만 보기와 대신보기는 현재 선택 직원으로 제한한다.
- 공용 계정·회사 마스터·퇴사 직원의 생일은 관리자 전체 목록에서 제외하되 현재 관리자 본인은 유지한다. 2월 29일생은 기존 생일 연차 정책과 동일하게 평년 2월 28일에 표시하며 출생 연도는 렌더링하지 않는다.
- 생일 칩·범례·상세는 공통 violet 테마 토큰과 직원 프로필 매핑을 사용한다. 격리 DB/Razor 검사에서 직원·관리자·마스터 공개 범위, 자기것만 보기와 월간·연간 출력을 검증한다.

## 196차: 직원 생일 입력을 월·일 전용으로 전환 (2026-09-16)

- Portal 신규·기존 직원의 생일 입력을 연도가 없는 `MM-DD`로 변경하고 정확한 달력 월·일만 저장하도록 서버 검증과 HTML 초안 복구를 맞췄다. 2월 29일은 허용하고 연도가 포함된 값이나 존재하지 않는 날짜는 거부한다. Portal과 Leave DB의 기존 생일도 기동 시 윤일 기준연도 2000으로 정규화해 출생 연도를 더 이상 보존하지 않는다.
- Leave 전용 로그인·provision claim도 `MM-DD`만 전달한다. Leave는 기준연도 2000으로 정규화해 기존 생일 연차 계산을 유지하며, 순차 배포 중 기존 `yyyy-MM-dd` claim은 월·일만 취해 호환한다.
- 계정 공통 필드 계약, 신규/일괄 저장, 비공개 투영 통합 검사를 함께 갱신했다. 생일 공개 범위와 생일 연차 0일 차감·미사용 보상 정책은 변경하지 않았다.

## 195차: 비공개 직원 생일과 생일 연차 정책 (2026-09-15)

- Portal 공통 계정 필드에 선택 생일을 추가하고 신규·기존 직원 저장, 충돌 비교, 초안 복구와 Leave outbox 투영을 같은 계약에 연결했다. 생일은 직원 관리 화면에만 표시하고 Leave 전용 서명 토큰 이외의 서비스·직원 명단에는 노출하지 않는다.
- Leave는 생일 당일 일반 연차·오전/오후 반차를 0일 차감으로 기록한다. 승인 대기·승인·취소 대기는 사용으로 보며, 반려·취소되면 미사용으로 재평가한다. 2월 29일생은 평년 2월 28일을 적용한다.
- 재직 중 생일을 지난 해에 생일 연차가 없으면 다음 날 1일을 현재 연차년도 만료일로 자동 지급한다. 귀속 연도 고유 키로 중복을 막고 기존 연차 가불 상환과 연결한다. 상세 계약은 `packages/contracts/leave-birthday.md`다.

## 194차: 연차 대시보드 다크모드 본문 대비 보강 (2026-09-15)

- 날짜 상세의 신청 사유·업무 일정·외부 일정 메모에 남아 있던 반투명 흰 배경을 공통 raised 표면으로 바꾸고 text/muted 토큰을 적용했습니다. 월간 일정 칩 보조 문구, 가불 지표, 공휴일 날짜와 연간 공휴일명도 각 의미 토큰을 사용합니다.
- 링크형 달력 보기·이동·목록 버튼은 active/raised/hover 토큰을 사용해 밝은 다크모드 accent 위의 흰 글자 조합을 제거했습니다. 업무 상태와 기존 폼·모달·달력 동작은 변경하지 않았습니다.
- 실제 Razor fixture의 월간 상세와 연간 달력에서 PC/모바일·라이트/다크의 작은 글자 대비를 4.5:1 이상으로 검사합니다.

## 193차: 전 서비스 테마 팔레트 중앙 소유 전환 (2026-09-15)

- Portal, Leave, Schedule, CS, Statistics, Sheet의 앱별 light/dark 팔레트 블록을 제거하고 화면 기반색·상태색·주말/공휴일 색을 `packages/workspace-ui/src/company-workspace.css`의 43개 의미 토큰으로 중앙 관리한다. 앱에 남은 호환 별칭은 공통 토큰만 참조하며 프로젝트·부서·게임 데이터 자체를 구분하는 색은 별도 의미로 유지한다.
- 공통 스타일이 배경, 패널, 입력, hover, 선택, 성공·경고·오류·정보와 달력 상태를 두 모드에서 일관되게 적용한다. Statistics의 폭 변수처럼 이름이 겹치는 구조 변수는 팔레트 별칭으로 오인하지 않도록 분리했다.
- 테마 계약 검사는 모든 등록 서비스의 UI 소스를 순회해 앱별 `data-theme`, `.theme-dark/.theme-light`, `prefers-color-scheme` 팔레트와 기반 별칭의 리터럴 색 재도입을 실패시킨다. 따라서 새 페이지도 공통 팔레트를 우회해 별도 다크모드를 만들 수 없다.
- 공통 UI 388개, 일정·Portal·Leave 빌드와 일정 통합 196개, 나머지 네 서비스 구문/배포 빌드가 통과했다. 실제 Chrome 전 서비스 셸 606개 일괄 실행은 590개 통과 후 공통 버튼 우선순위 12개와 병렬 지연 4개를 드러냈고, 비활성/공통 버튼의 소유권을 보존하도록 수정한 뒤 해당 18개를 단일 worker로 모두 재검증했다. 48개 등록 페이지의 320/390/1440px·두 테마 화면에서 중성 배경과 선택 대비를 확인했다.

## 192차: 전 서비스 중성 다크 팔레트와 선택 대비 통일 (2026-09-15)

- 공통 canvas/surface/raised/hover를 검정·중성 회색 축으로 재정의하고, 라이트·다크 모두 페이지 배경·패널·입력·hover·선택 상태 사이의 명암 차이를 확대했다. 선택 상태는 별도 배경, accent 테두리와 AA 본문 대비를 갖는다.
- Portal, Leave, Schedule, CS, Statistics, Sheet, IAP에 남아 있던 앱별 파란 배경·패널·입력·선택 예외를 공통 토큰에 연결했다. 경고·성공·공휴일·게임 데이터처럼 업무 의미가 있는 색은 유지했다.
- 테마 계약 테스트에 두 팔레트의 surface 단계 거리, 일반/선택 본문 대비와 다크 surface의 중성도 검사를 추가했다. 생성 자산을 갱신하고 각 서비스의 라이트·다크 실제 화면에서 본문과 선택 상태를 확인한다.

## 191차: IAP 회사 프로젝트 선택 목록 수정 (2026-09-14)

- 상단 선택기의 원본을 IAP 연결 목록에서 서버가 반환한 회사 프로젝트 목록으로 변경했다. 연결이 0개여도 회사 프로젝트를 선택할 수 있으며, 미연결 프로젝트는 연결 안내와 동일 프로젝트가 선택된 설정 화면으로 이어진다.
- 공용 `data-company-picker="project"`의 이름·초성 검색을 사용한다. 회사 ID와 기존 IAP game ID를 분리하고 레거시 이력은 별도 선택지로 유지하며 이름으로 연결을 추측하지 않는다. 서버에 없는 프로젝트와 신규 보관 프로젝트는 선택지에 추가하지 않는다.
- 기존 연결의 상품 조회가 완료되기 전과 미연결 프로젝트 선택 시 이전 상품 화면을 제거하고, 늦은 상세 조회 응답을 적용하지 않는다. 목록 조회 실패는 빈 결과로 숨기지 않는다. 프로젝트 선택만으로 DB·시트·스토어 쓰기를 실행하지 않는다.
- IAP 단위 69개·타입/빌드, 공통 구조/정책·단위 386개, 합성 브라우저 5개가 통과했다. 390px 다크와 1440px 라이트에서 두 프로젝트 검색·선택·설정 연결 및 가로 넘침 없음을 확인했다. 운영 인앱 브라우저의 현재 테스트 계정은 IAP 권한이 없어 인증 후 실제 목록 검증과 구분한다.

## 190차: CS 상품 지급·회수 마일리지 지원 (2026-09-14)

- 게임 commit `bc3957cef42c3d8afa4f20763f669dc9d05406bb`의 UserReadOnlyData 명령 규격에 맞춰 CS 상품 지급·회수 화면에 `재화.마일리지` 입력을 추가했다. 0 이상의 정수만 허용하고 빈 값은 생략하며, 지급·회수 방향은 기존 명령 키가 결정한다.
- 여러 UID의 마일리지 총량과 최종 JSON을 확인창에 표시하고, 기존 동일 키에 마일리지가 있으면 다른 재화와 같이 합산한 병합 후 JSON을 운영자가 승인하도록 유지했다. 패키지의 가격 기반 마일리지는 게임이 자동 처리하므로 화면에는 추가 조정분만 직접 입력하라는 안내를 제공한다.
- CS 구문 검사와 단위 97개, 루트 구조·정책·단위 386개, 상품 명령 집중 단위 22개 및 실제 Chrome의 라이브/테스트·모바일/PC·두 테마·마일리지 회수 병합을 포함한 27개가 통과했다. 합성 PlayFab만 사용했으며 운영 데이터·컨테이너·환경은 변경하지 않았다.

## 189차: 업무 목표 인라인 수정 (2026-09-14)

- 업무 목표 카드에 한 번에 하나만 열리는 수정 폼을 추가했다. 목표 이름·연결 프로젝트·설명을 편집하고 취소하거나 저장할 수 있으며, 종료된 프로젝트가 기존 연결 대상이면 현재 값을 잃지 않도록 선택지에 유지한다.
- 저장은 기존 `PUT /api/work-goals/{id}`와 목표 버전을 사용해 다른 사용자의 변경을 덮어쓰지 않는다. 실패·충돌 시 초안을 유지하고 성공 시 Bootstrap을 다시 확인해 목표 카드와 일정의 목표별 드롭다운/그룹 제목을 함께 갱신한다.
- Schedule 프런트 단위 216개·타입 검사/빌드, 목표 서버 집중 2개와 실제 브라우저의 연속 등록·수정·목표별 필터 반영 및 다크모드 배치를 통과했다.

## 188차: 업무 목표 보드 분류·필터로 재배치 (2026-09-14)

- 목표 연결 업무 확인을 목표 관리창 내부의 별도 목록이 아니라 주간 일정의 정식 보기 방식으로 옮겼다. 상단 직원별·프로젝트별·부서별 옆에 `목표별`을 추가하고, 목표 드롭다운으로 전체 목표 또는 한 목표를 선택할 수 있다.
- 선택한 목표 ID는 기존 서버 `goalId` 조회 조건으로 전달하고, 반환 업무를 목표 제목 아래의 일정 행으로 그룹핑한다. 목표가 없는 업무는 목표별 보기에서 제외하며 종료된 목표도 명시적으로 선택할 수 있다.
- 목표 관리창은 등록·종료/재개만 담당하도록 되돌려 탐색 UI의 중복을 제거했다. 표시 기간 선택창은 같은 줄의 compact 버튼 높이에 맞췄다.
- Schedule 단위 216개, 타입 검사·배포 빌드와 실제 브라우저의 연속 목표 등록·목표별 필터·그룹 행·컨트롤 높이 검사를 통과했다.

## 187차: 업무 목표 연속 등록·모아보기 완성 (2026-09-14)

- 목표 창을 닫았다 다시 열면 공용 쓰기 세션의 이미 사용한 요청 키가 재사용되어 다음 목표 등록이 차단되던 문제를, 창 인스턴스별 요청 식별자로 분리해 수정했다.
- 목표 저장 직후 회사 정보 조회와 일정 목록 강제 조회가 서로 취소하던 중복 갱신을 제거했다. 목표 목록은 Bootstrap 한 번으로 갱신하고 현재 일정 보드는 불필요하게 다시 읽지 않는다.
- 목표 카드에 `업무 모아보기`를 추가했다. 서버의 가시성 범위를 유지한 `goalId` 필터로 연결 업무를 전부 페이지 조회하고 전체·예정·진행·완료 집계, 프로젝트·담당자·일정과 업무 상세 이동을 제공한다.
- Schedule Vitest 215개, 서버 통합 테스트 70개, 루트 구조·정책·단위 테스트 386개와 실제 브라우저 연속 등록·모아보기 시나리오를 통과했다.

## 186차: 업무 상세 대형 작업 공간 전환 (2026-09-14)

- 업무 상세만 좁은 오른쪽 drawer에서 최대 1180px의 중앙 작업창으로 전환했다. 목표·릴리스·설정 등 보조 패널의 기존 drawer 동작은 유지한다.
- 데스크톱 속성 영역은 3열, 중간 화면은 2열, 모바일은 전체 화면 1열로 재배치하고 닫기·링크 도구는 스크롤 중에도 접근 가능한 상단 도구막대로 묶었다.
- Schedule 단위 테스트 214개, 루트 구조·정책·단위 테스트 386개와 320/1440px 라이트·다크 실제 브라우저 4개 조합을 통과했다.

## 185차: IAP 상품 관리 원본 이력·공용 프레임·배포 경계 편입 (2026-09-14)

- `product-upload` main의 원본 commit/tree와 archive ref를 보존해 `apps/iap`로 가져왔다.
- 상품 목록·가격 프리셋·업로드 이력·프로젝트 연결을 공용 페이지 계약과 사이드바에 등록하고 공용 UI primitive 및 생성 자산을 적용했다.
- IAP 테스트·빌드·독립 이미지 health smoke와 GHCR 게시를 7개 서비스 CI matrix에 포함했다.
- 운영 Compose는 기존 컨테이너 식별자와 PostgreSQL `product-upload_iap-db` 볼륨 이름을 유지하고, connector 비밀 파일은 저장소 밖 `private/iap`을 계속 읽도록 명시했다.
- 전환 직전 PostgreSQL custom-format dump와 비밀값을 제외한 런타임 경계를 `.local/backups/iap-20260914-pre-workspace`에 보관하고 `pg_restore --list`로 복원 목록을 확인했다.
- 운영 앱 컨테이너만 `apps/iap` 기준으로 재생성했다. 컨테이너 health와 외부 `https://iap.example.com/api/health`가 모두 `ok`이고 기존 DB 볼륨 및 읽기 전용 connector mount가 유지됨을 확인했다.
- 구 checkout은 운영 경로에서 분리해 `C:/dev/docker/쓰레기통/legacy-company-folders-20260914-1548/product-upload`로 이동했다. GHCR 최초 게시는 별도 수동 승인 범위로 남긴다.

## 184차: 실제 회사 로고 공용 적용 (2026-09-14)

- 제공된 로고 원본 PNG 원본을 `packages/workspace-ui/assets/company-logo.png`로 보존하고 SHA-256 일치를 확인했다. 기존 임시 숫자 SVG 대신 공용 상단 브랜드에 실제 PNG를 표시한다.
- 생성기가 동일 바이너리를 Portal 정적 자산으로 복사하고 공용 셸의 데이터 URI 및 생성 버전 해시에 포함한다. Portal과 공용 셸을 사용하는 모든 서비스의 브라우저 탭 아이콘도 같은 원본을 사용한다.
- 흰색 투명 로고가 라이트 테마에서 사라지지 않도록 상단 아이콘에 짙은 받침색과 경계를 적용한다.

## 183차: 업무 상세 일정·공용 TODO 쓰기 세션 연결 수정 (2026-09-14)

- `usePlanningWrites`가 공통 문서 세션에서 소유자를 등록하지 않아 모든 목표·상세 일정·공용 TODO 쓰기가 요청 전에 `최신 내용을 다시 확인해 주세요`로 차단되던 원인을 수정했다.
- 훅 수명주기 동안 `schedule-planning-writes` 소유자를 등록하고 화면 해제 때 정리한다. 공용 TODO와 상세 일정을 같은 업무에서 차례로 추가해 실제 요청·ACK·상세 재조회가 이어지는 단위 및 브라우저 회귀를 추가했다.

## 182차: 일정 프로젝트 미지정 이중 확인 (2026-09-14)

- 신규 업무가 프로젝트 미지정이거나 기존 업무의 지정 프로젝트를 미지정으로 변경할 때, 일반 저장 확인 전에 누락 여부를 다시 묻는 별도 확인 단계를 추가했다.
- 사용자가 취소하면 네트워크 요청 없이 업무 초안과 프로젝트 선택을 유지한다. 실제 미지정 저장은 `미지정으로 계속`을 선택한 뒤 기존 저장 확인까지 마치면 허용한다.
- 이미 미지정인 업무의 다른 필드 수정과 상태 변경에는 경고를 반복하지 않는다. 집중 검증은 `useTaskWrites` 단위 테스트와 신규 업무 저장 브라우저 시나리오로 제한한다.

## 181차: 팀 일정 월간·목표·상세 계획 통합 및 회사 로고 (2026-09-14)

- 회사 공통 상단 로고를 전용 SVG로 교체하고 Portal favicon을 같은 자산으로 설정했다.
- Schedule에 월간 달력, 직원/프로젝트/부서/내 일정 분류, 기간 카드의 범위 내 sticky 텍스트, 프로젝트·부서 보드의 중복 업무명 열 제거를 적용했다.
- `WorkGoals`, `TaskScheduleItems`, `SharedTaskTodos`, `Tasks.GoalId`를 추가형 스키마로 도입했다. 업무 상세와 내 일정에서만 상세 계획을 표시하고 공용 TODO 등록자·완료자·완료 시각을 보존한다.
- 버전 기록 쓰기를 모든 활성 직원에게 열되 기존 프로젝트 가시성, 행 버전 충돌, `ReleaseRevision` 및 `ChangeLog` 감사 기록을 유지했다.
- 계약: `packages/contracts/schedule-work-planning.md`. 회귀 검증: Schedule Vitest/TypeScript 빌드와 `WorkPlanningTests`, `ReleaseTests`, `ReleaseWriteProtocolTests`.

## 180차: 게시 digest의 비실행 배포 후보 경계 (2026-09-13)

- `workspace-image-publication-set-v1` 완성본을 독립적으로 다시 검증하는 `validatePublicationSet`을 추가했다. 저장소·commit/tree·검증/게시 run과 attempt, source hash, 정확한 여섯 서비스, commit 태그·로컬 image ID·Linux 플랫폼·서비스별 GHCR repository digest·record hash 및 비승인 범위가 하나라도 다르면 거부한다.
- `deployment-candidate.mjs`는 승인된 게시 artifact 한 파일에서 여섯 `<app>.image.compose.json`과 `candidate.json`만 새 디렉터리에 생성한다. override에는 실제 Compose 서비스명과 `repository@sha256:...`만 담고, manifest는 입력 원문과 각 override hash·컨테이너 신원을 결합한다. 기존 Compose가 데이터 mount·포트·network·env·command를 계속 소유하며 생성기는 Docker·registry·GitHub·운영 환경을 호출하지 않는다.
- 입력/출력은 절대 경로, 입력은 256KB 이하 일반 파일, 출력은 기존 파일을 덮지 않는 새 디렉터리로 제한했다. 후보의 `deploymentApproved`는 항상 false이고 서명 provenance·환경/비밀·보안/리소스·백업/스키마·실제 인증/업무 조회·전환/롤백은 unverified로 유지한다. 기본 Compose의 build가 남으므로 실제 배포 전에 digest pull과 build 금지를 강제하는 별도 실행 경계가 필요하다.
- 게시 묶음 변조와 후보 생성/덮어쓰기/CLI·비실행 변이를 포함한 집중 10개와 루트 전체 구조·정책·단위 384개가 통과했다. 이전 commit `5371b52fdfcca31bb8fd92bafb0aaf95d24d026c`의 원격 전체 run `34703332199`는 16개 job, 브라우저 1,226개, artifact 8개와 annotation 0개로 성공했다. 첫 GHCR 게시와 운영 컨테이너·DB·볼륨·환경 변경은 하지 않았고 전체 목표는 계속 진행 중이다.

## 179차: 늦은 권한 스냅샷의 승인 배지 역행 방지 (2026-09-13)

- 178차 commit의 원격 `Workspace Verification` run `34701556396`에서 1,226개 브라우저 검사 중 1개가 실패했고 `required` 집계도 정확히 실패했다. 연차 사이드바의 실시간 승인 배지를 120건으로 바꾼 직후 먼저 시작된 권한 조회의 2건 스냅샷이 늦게 도착해 다시 덮는 실제 경쟁 조건이었다. 나머지 브라우저 1,225개와 다른 개별 job은 통과했지만 이 실행을 성공 증거로 사용하지 않는다.
- 공통 navigation은 권한 조회 시작 시 badge별 로컬 revision을 캡처한다. 조회 중 `CompanyNavigation.setBadge`가 더 최신 값을 적용한 badge만 늦은 스냅샷에서 보존하며, 그 갱신 이후 새로 시작한 권한 조회는 서버의 새로운 값을 적용할 수 있다. 계정·역할·서비스 범위 변경과 로그아웃에서는 revision도 기존 메뉴/배지와 함께 제거한다.
- 지연된 서버 2건 응답과 실시간 120건 갱신을 순서대로 제어하는 단위 회귀를 추가했다. 집중 navigation 18개, 루트 구조·정책·단위 378개, 실제 Razor 격리 통합 196개와 원격에서 실패했던 Chromium 시나리오 1개가 로컬에서 통과했다. 새 main의 원격 전체 결과는 push 뒤 별도로 확인하며 운영 checkout·컨테이너·DB·볼륨·환경과 GHCR은 변경하지 않았다.

## 178차: 검증된 main의 수동 GHCR 게시 경계 (2026-09-13)

- `.github/workflows/publish-images.yml`을 수동 `workflow_dispatch` 전용으로 추가했다. 실행 시점의 실제 `main`과 동일한 commit에 성공한 `Workspace Verification` main push run을 GitHub API에서 선택하고, 정확한 run/attempt 이름의 전체 검증 artifact 두 개를 내려받아 현재 workflow/policy hash와 commit/tree를 다시 확인한 뒤에만 게시 source를 만든다. 이전 성공 run, PR run, 다른 저장소·branch·commit, 손상·누락 artifact는 거부한다.
- 여섯 서비스는 검증된 commit SHA만 태그로 사용해 각각 빌드하고 기존 격리 health smoke를 통과한 동일 로컬 이미지만 GHCR에 push한다. push 뒤 Docker가 반환한 정확한 repository digest를 source·서비스·로컬 image ID·플랫폼과 결합하고, 여섯 matrix가 모두 성공한 경우에만 `workspace-image-publication-set-v1`을 만든다. 어떤 게시 기록도 `deploymentApproved`를 true로 만들지 않는다.
- 게시 workflow 자체도 `publication-policy.json`과 `publication-workflow.mjs`로 봉인했다. 자동 trigger, 서비스 matrix 축소, 다른 checkout ref, 가변 이미지 태그, smoke/push/기록 누락, 실패 무시, artifact 완화와 승인되지 않은 action 버전은 구조/변이 검사에서 실패한다. 루트 전체 구조·정책·단위 377개가 통과했다.
- GitHub 공식 `attest-build-provenance` 문서를 확인한 결과 비공개 저장소의 Artifact Attestation은 Enterprise Cloud가 필요하고 현재 조직은 Free이므로, 작동하지 않는 서명 단계를 넣지 않았다. 게시 묶음은 `provenanceSigned:false`를 명시한다. 이 단계는 registry digest 연결을 준비한 것이며 workflow를 아직 수동 실행하지 않았고 GHCR package·운영 컨테이너·DB·볼륨·환경도 변경하지 않았다.

## 177차: 비공개 모노레포 원격과 첫 전체 CI (2026-09-12)

- 사용자 승인 후 비공개 `https://github.com/company-org/company-workspace`를 생성해 로컬 `origin`으로 연결하고 main `c57e995`와 21개 `archive/*` 원본 보존 브랜치를 게시했다. 기존 여섯 원본 저장소의 remote/branch와 운영 checkout은 변경하지 않았다.
- 첫 main push의 Workspace Verification run `34696048728`은 공통 UI, CS/통계, Portal/Leave, Schedule/Sheet, 일정 통합, 여섯 Docker 이미지 빌드·격리 health와 전체 브라우저 회귀를 모두 통과했다. GitHub의 실제 check 이름 `required`와 여섯 이미지 record, 전체 verification 및 browser artifact를 확인했다.
- `required`를 strict 필수 check로 두고 PR을 요구하며 관리자 우회·force push·branch 삭제를 막는 보호 요청을 했지만, `company-org`가 Free 요금제인 비공개 저장소라 GitHub가 HTTP 403으로 거부했다. repository ruleset 조회도 같은 제약으로 거부됐다. 공개 전환이나 보호 완료를 주장하지 않는다.
- 첫 실행의 Node 20 강제 호환 경고를 해소하기 위해 GitHub 공식 최신 release를 확인하고 checkout/setup-node/upload-artifact를 v7, setup-dotnet을 v6, download-artifact를 v8로 갱신했다. 검증 정책과 변이 검사도 같은 major를 요구한다. 후속 원격 run `34697550113`은 16개 job이 모두 성공했고 artifact 8개와 annotation 0개를 확인했다.
- CI는 이미지를 빌드·기동했지만 registry에 게시하지 않았고 운영 배포를 승인하지 않는다. 운영 컨테이너·DB·볼륨·환경은 변경하지 않았으며 전체 목표는 계속 진행 중이다.

## 176차: 여섯 운영 Compose 데이터 경계 재대조 (2026-09-12)

- `deployment-preflight.mjs`의 읽기 전용 `inspect`로 현재 Docker daemon의 Portal, Leave, Schedule, CS, Statistics, Sheet 컨테이너가 모두 실행 중임을 확인했다. healthcheck가 정의된 CS·통계·시트는 healthy였고, healthcheck가 없는 세 서비스는 null을 healthy로 오인하지 않았다.
- 모노레포의 서비스별 Compose를 기존 운영 project name, 환경 파일과 원래 project directory로 해석해 현재 컨테이너와 대조했다. 여섯 서비스 모두 Compose 프로젝트, 데이터 mount 원본/대상/읽기 전용 여부, loopback 고정 포트와 network가 정확히 일치했다. Sheet의 기존 data 및 서비스 계정 파일 bind도 원래 절대 경로로 유지됐다.
- 각 후보의 유일한 차이는 `candidate-image-not-pinned`였다. 현재 Compose는 build context를 가리키며 신뢰된 registry digest가 없으므로 `boundaryCompatible`과 `deploymentApproved`는 false로 유지했다. 이미지 ID, 환경/비밀값, 백업·스키마, 운영 인증/업무 조회와 실제 전환·롤백은 승인 근거로 확대하지 않는다.
- 운영 컨테이너·볼륨·네트워크·환경·DB를 생성·재시작·변경하지 않았다. 모노레포 원격과 CI 이미지 게시/출처가 확정된 뒤 동일 검사를 다시 수행해야 하며 전체 목표는 계속 진행 중이다.

## 175차: 원본 GitHub main 비파괴 drift 검사 (2026-09-12)

- `source-drift.mjs`에 `npm run source:remote-check`를 추가했다. manifest에 기록된 여섯 GitHub HTTPS 원격의 `refs/heads/main`만 `git ls-remote`로 조회하며 fetch·checkout·merge·ref 쓰기나 원본 working tree 변경은 하지 않는다.
- 원격 응답은 서비스마다 정확히 하나의 40자리 commit과 정확한 main ref여야 한다. 조회 실패·응답 손상·누락과 수입 이후 원격 main 변경을 모두 닫힌 실패로 처리하고, 로그에는 자격 증명·원격 오류 본문·파일 내용을 출력하지 않는다.
- 2026-09-12 실제 조회에서 company-portal, LeaveManager, schedule, CS, statistics, sheet의 원격 main은 모두 `migration-sources.json`의 수입 commit과 정확히 일치했다. 집중 4개와 루트 구조·계약·CI 단위 366개, 로컬 원본 6개 exact 및 기존 import ancestry/tree/archive ref 21개도 통과했다.
- 원본 저장소·운영 checkout/컨테이너/데이터는 변경하지 않았다. 이 조회는 원본의 branch protection, 아직 없는 모노레포 원격과 필수 검사, registry 게시·운영 전환 승인을 증명하지 않으며 전체 목표는 계속 진행 중이다.

## 174차: 최초 수입 이후 원본 checkout drift 검사 (2026-09-12)

- 최초 import commit의 ancestry/tree/ref 보존만 확인하던 `verify-import.mjs`와 구분해, 현재 로컬 원본 여섯 checkout을 반복 판정하는 `source-drift.mjs`를 추가했다. `npm run source:inspect`는 비파괴 JSON 보고서, `npm run source:check`는 하나라도 정확히 같지 않으면 실패하는 전환 전 gate다.
- manifest는 정확한 여섯 서비스와 안전한 단일 폴더 이름, GitHub HTTPS remote, 40자리 commit/tree를 요구한다. 각 checkout의 존재, `main`, clean working tree, origin 일치, 현재 commit/tree와 수입 commit의 exact/descendant/diverged 관계를 읽기 전용 Git 명령으로 확인한다. 파일명이나 변경 내용을 출력하지 않는다.
- 실제 `C:/dev/docker`의 company-portal, LeaveManager, schedule, CS, statistics, sheet는 모두 clean main, origin 일치, 수입 commit/tree와 exact, ahead 0으로 통과했다. 따라서 현재 로컬 원본에서 누락된 후속 변경은 없지만 이 명령은 네트워크 fetch를 하지 않으므로 GitHub 원격 최신성의 증거가 아니다.
- drift 변이 집중 3개와 루트 구조·계약·CI 단위 365개가 통과했고 기존 import ancestry/tree/archive ref 21개도 재확인했다. 원본 checkout·remote·운영 컨테이너/데이터는 변경하지 않았으며 전체 목표는 계속 진행 중이다.

## 173차: 여섯 이미지 검증 기록의 단일 CI 묶음 (2026-09-12)

- aggregate job이 images matrix의 현재 run/attempt artifact 여섯 개를 정확한 pattern으로 내려받아 하나의 `workspace-image-verification-set-v1` 기록으로 묶도록 했다. 입력 디렉터리는 정확한 서비스 JSON 여섯 개만 허용하고 파일 누락·중복·추가·심볼릭 링크와 잘못된 크기를 거부한다.
- 묶음 생성기는 전체 `workspace-verification-v1` 영수증의 현재 workflow/policy hash, 일곱 job 성공, repository/commit/tree/run/attempt/event/ref를 다시 검증한다. 각 이미지 기록의 schema·서비스·검증 태그·content-addressed image ID·Linux 플랫폼·정렬된 registry digest·scope를 확인하고 전체 영수증과 source identity가 하나라도 다르면 실패한다. 원본 영수증과 이미지 record별 파일 SHA-256을 결과에 보존한다.
- registry digest가 여섯 서비스 모두 있으면 `registryPinned:true`만 기록할 뿐 `deploymentApproved`는 항상 false다. 현재 CI는 registry에 이미지를 게시하지 않으므로 보통 `missingRegistryDigests`에 여섯 서비스가 남는다. 이 묶음은 서명 provenance·승격 승인·운영 배포 입력이 아니다.
- 신규 묶음/CI 정책 집중 16개와 루트 구조·계약·CI 단위 362개가 통과했다. 제품 런타임·Dockerfile은 바꾸지 않아 서버/브라우저/이미지 전체 빌드를 다시 실행하지 않았다. 원본 저장소·운영 checkout/컨테이너/데이터·원격은 변경하지 않았으며 전체 목표는 계속 진행 중이다.

## 172차: Native POST 폼별 소비자 계약 봉인 (2026-09-12)

- 기존 파일별 폼 수 정책을 v2로 올려 각 native POST의 `asp-page`, handler, action, id와 안정적인 업무 marker 조합을 identity로 고정했다. 같은 파일에서 폼 수를 유지한 채 handler/action을 바꾸거나 동적 POST 표기를 바꾸는 경우도 검사가 실패한다.
- 31개 identity가 모두 범용 목록 문서가 아닌 구체 소비자 계약 하나를 가리키도록 했다. Leave 대시보드의 신청 1개, 관리자 강제 작업 2개, 외부 일정 2개를 각각 기존 실제 계약에 연결했다. Portal 직원 등록/일괄 변경에는 공통 필드·문자열 ID/64비트 버전·역할/계정 유형·트랜잭션·전체 영수증·미확정 초안을 명시한 `portal-account-writes.md`를 추가했다. SSO launch는 검증된 callback과 1분 HMAC token을 `sso-launch.md`에 분리했다.
- 새 폼·퇴역 identity·동일 개수의 handler 변경·중복 identity·범용 계약 사용·손상/비정렬 정책을 거부하는 집중 10개와 루트 구조·계약·CI 단위 357개가 통과했다. 제품 런타임 코드는 변경하지 않아 서버/브라우저 전체 회귀는 다시 실행하지 않았다. 정적 폼 identity는 실제 서버 인가·CSRF·트랜잭션·운영 저장 성공을 증명하지 않는다.
- 원본 여섯 저장소, 운영 checkout/컨테이너/DB·환경, 원격과 배포는 변경하지 않았다. 전체 목표는 계속 진행 중이다.

## 171차: CI 커밋과 검사 이미지 ID 기록 결합 (2026-09-12)

- 여섯 images matrix가 빌드·기동 검사를 마친 뒤 서비스별 `workspace-image-verification-v1` JSON을 생성하고 별도 artifact로 업로드하도록 했다. 기록은 저장소, 정확한 commit/tree/run/attempt, 검증 태그, content-addressed 로컬 image ID, Linux 플랫폼과 존재하는 registry digest를 결합한다.
- GitHub Actions 외 실행, 다른/dirty checkout, 잘못된 저장소·run 식별자, 서비스와 다른 태그, mutable image ID, 비-Linux/미지원 플랫폼과 손상된 registry digest를 거부한다. 기록의 범위는 `ci-image-build-and-health-only`, `deploymentApproved`는 항상 false다.
- CI 정책은 기록 생성 명령, artifact action, 서비스/run을 포함한 이름, 서비스별 정확한 경로와 `if-no-files-found: error` 중 하나라도 제거·변경·조건부 처리하면 실패한다. 집중 계약/정책 15개와 최종 루트 구조·계약·CI 단위 356개가 통과했다.
- 이 기록은 같은 CI job에서 검사한 로컬 이미지 신원을 남기지만 이미지를 registry에 게시하지 않는다. 서명된 provenance, manifest digest와 실제 배포 입력의 연결, 원격 branch 보호·승인·롤백은 계속 남는다. 원본 여섯 저장소와 운영 checkout/컨테이너/데이터는 변경하지 않았다.

## 170차: 여섯 배포 이미지의 격리 기동 검사 (2026-09-12)

- CI images matrix를 Dockerfile 빌드만 하는 상태에서 각 이미지 프로세스의 실제 기동과 health 응답까지 확인하도록 확장했다. Portal/Leave에는 인증·업무·DB 상태를 노출하지 않는 `/health`를 추가했고 기존 Schedule/Sheet `/api/health`, CS/Statistics `/health`와 서비스별 계약을 고정했다.
- `container-smoke.mjs`는 테스트 전용 값만 전달하고 운영 env 파일·비밀값·볼륨·운영 네트워크를 사용하지 않는다. 호스트에는 loopback 임의 포트만 게시하며 UUID 이름의 정확한 임시 컨테이너를 `finally`에서 정리한다. 서비스/이미지 입력, 단일 loopback 포트, 성공 JSON을 엄격히 검사하고 실패 시 제한된 컨테이너 로그를 남긴다.
- 워크플로 정책은 여섯 서비스 matrix, Docker build, 스모크 명령과 고정 Node 22 설정 중 하나라도 빠지거나 조건부가 되면 거부한다. 새 검증기/정책 변이 15개 및 최종 루트 351개가 통과했다.
- 여섯 앱 이미지는 운영 컨테이너와 별도 `workspace-*:verify` 태그로 빌드됐다. Leave/CS/Statistics는 검증기 완료 응답을 확인했고 Portal/Schedule/Sheet는 임시 loopback 포트에서 각각 200과 올바른 health JSON을 직접 확인했다. 로컬 승인 실행 래퍼가 일부 장기 Node 프로세스를 먼저 반환해 남은 UUID 임시 컨테이너는 이름을 대조해 즉시 삭제했다. 운영 컨테이너·DB·볼륨·포트·네트워크는 변경하지 않았다.
- 이 검사는 프로세스가 뜨고 최소 endpoint가 응답한다는 증거다. 실제 로그인·권한·업무 의존성·데이터 보존, 원격 CI 성공, 게시 이미지 digest/출처, 운영 전환과 롤백 승인을 대신하지 않는다. 전체 목표는 계속 진행 중이다.

## 169차: 동적 브라우저 네트워크 표기 봉인 (2026-09-12)

- 브라우저 네트워크 검사기가 dot 호출 외에 computed `fetch`/axios/sendBeacon, `fetch.call/apply/bind`, 전역 `XMLHttpRequest` 생성과 literal `Reflect.get` 호출을 같은 정책으로 계산하도록 확장했다. 현재 작성 소스 168개의 검토된 raw transport는 16개로 유지된다.
- HTML/JS 주석과 단순 문자열은 세지 않으면서 10개 우회 변형을 거부하는 변이 테스트를 추가했다. 집중 4개와 루트 구조·CI·단위 345개가 통과했다. 계산 문자열·eval·임의 런타임 반사, 응답 의미와 서버 인가는 이 정적 검사로 증명하지 않는다.

## 168차: 연차 대시보드 HTML 조회 transport 분리 (2026-09-12)

- 달력·내 신청목록 부분 조회의 raw `fetch`를 Razor 본문에서 `leave-dashboard-read.js`로 옮겼다. 페이지는 `CompanyReadSession` 채널, 폼 revision·현재 직원 대조와 원자적 영역 적용만 소유한다.
- transport는 동일 출처 `/Leave`·`/Leave/Index`, 알려진 필터별 단일 query 값, fragment 없음, same-origin/no-store/redirect 거부와 `text/html`을 검사한다. 응답 본문 뒤 AbortSignal도 다시 확인하며 외부·다른 경로·알 수 없는/중복 query는 요청 전에 거부한다.
- 집중 transport/구조/네트워크 7개, 루트 구조·CI·단위 344개, 실제 Razor/SQLite 서버 196개와 Chrome 연차 저장·부분조회 42개가 통과했다(`artifacts/browser-leave-dashboard-transport-phase168`). 운영 DB·원본 checkout·원격·배포는 변경하지 않았다.

## 167차: 동적 Native POST 우회면 봉인 (2026-09-12)

- literal `<form method="post">` 외에도 submitter의 `formmethod="post"`, JavaScript의 `.method`/`.formMethod = 'post'`, `setAttribute('method'|'formmethod', 'post')`를 같은 native POST 정책에 포함했다. 현재 작성 소스에는 추가 동적 POST 경로가 없고 검토된 목록은 31개로 유지된다.
- 주석·단순 비교식을 잘못 세지 않으며 HTML/JS의 대소문자와 JSX literal 변형을 검증하는 변이 테스트를 추가했다. 집중 4개와 루트 구조·CI·단위 341개가 통과했다. 계산 문자열·런타임 반사, 서버 인가·CSRF·트랜잭션과 운영 성공은 이 정적 검사로 증명하지 않는다.

## 166차: Native POST 변경 경계 봉인 (2026-09-12)

- 작성 HTML/Razor/React 소스 147개에서 literal native POST 31개를 찾아 16개 소유 파일과 기존 소비자 계약에 연결했다. 신규 페이지 폼, 기존 파일의 폼 수 증가와 퇴역/손상/비정렬 정책은 `check:ui`에서 실패한다.
- 새 업무 폼은 정책 예외를 추가하는 대신 공통 form/write transport와 현재 계정·대상·기준값·전체 영수증·범위/미확정 결과 계약을 먼저 갖춰야 한다. Portal SSO launch의 외부 `form_post`는 업무 데이터 저장과 구분해 명시적으로 기록했다.
- 정적 경계/변이와 생성기 집중 4개, 루트 구조·CI·단위 340개가 통과했다. 이 검사는 각 기존 폼의 실제 서버 인가·CSRF·DB 트랜잭션을 새로 증명하지 않으며 원본 checkout·운영 데이터·원격·배포는 변경하지 않았다.

## 165차: 연차 직원 필터 자동 이동 공통화 (2026-09-12)

- 연차 대시보드 대신보기와 관리자 사용 통계의 직원 select에서 inline `this.form.submit()`을 제거하고 `data-cw-auto-submit`을 선언했다. 표시용 회사 프로필 ID가 아니라 기존 local 직원 ID와 hidden query를 native GET으로 제출한다.
- 공통 navigation은 취소되지 않은 change의 GET 폼만 `requestSubmit()`한다. POST, disabled control, `aria-busy` 폼은 거부하고 JavaScript 실패 시 사용할 관리자 통계의 명시적 조회 버튼은 유지했다.
- 단위/구조 66개, Razor 서버 196개와 실제 두 화면 Chrome 2개가 통과했다(`artifacts/browser-automatic-navigation-phase165`). 운영 데이터·원본 checkout·원격·배포는 변경하지 않았다.

## 164차: 브라우저 네트워크 소유권 봉인 (2026-09-12)

- 작성 브라우저 소스 167개를 검사해 검토된 raw 호출 16개를 `network-boundaries.json`에 봉인했다. 신규 페이지의 `fetch`·`XMLHttpRequest`·axios·`sendBeacon`, 기존 transport 호출 증가, 퇴역/손상/비정렬 정책은 `check:ui`에서 실패한다.
- Portal 직원 충돌 비교 GET을 페이지의 직접 호출에서 `account-review.js`로 옮겼다. transport는 동일 출처, manual redirect, 전용 JSON media type, HTTP 오류와 AbortSignal을 확인하고, 페이지의 `CompanyReadSession`·전체 snapshot 계약·초안/64비트 기준 버전 대조는 유지한다.
- 구조/transport 단위 11개, Razor 서버 196개와 실제 Chrome 충돌·범위 변경 11개가 통과했다. 정적 네트워크 목록은 서버 인가나 동적 코드의 안전성 증명이 아니며, 원본 여섯 checkout·운영 서비스·DB·원격은 변경하지 않았다.

## 163차: 회사 계정 컨텍스트 조회 계약 연결 (2026-09-12)

- 공통 셸의 `/api/workspace/context` 전역 조회를 `CompanyReadSession`의 `workspace-context` 채널로 옮겼다. 10초 관찰 제한·최신 ticket·문서 해제를 공통 계층이 소유하며 취소·실패·늦은 응답은 마지막 정상 context를 덮지 않는다.
- `CompanyContextContract`를 생성 번들에 추가해 authenticated, 사용자 식별자/역할, 중복 없는 서비스, 선택적 권한·CSRF·프로필/프로젝트 아이콘 map과 프로젝트 배열을 적용 전에 검증한다. 원본 객체와 ID를 보정하지 않으며 손상된 개인 범위 응답은 계정/서비스 UI 전체에서 거부한다.
- 프로필·프로젝트 아이콘 저장 후 확인된 context는 같은 `applyContext`에서 revision을 증가시킨다. 더 일찍 시작한 전역 갱신은 늦게 도착해도 새 사진·아이콘을 되돌릴 수 없다. 알림 읽음·로그아웃·이미지 저장은 기존 별도 변경 수명주기를 유지한다.
- 계약/구조 변이·단위 28개, 루트 구조·CI·단위 327개와 실제 Chrome 집중 2개가 손상 응답과 해제 뒤 늦은 응답을 확인했다(`artifacts/browser-workspace-context-phase163`). 운영 SSO/DB/환경/배포는 변경하지 않았으며 전체 목표는 계속 진행 중이다.

## 162차: 공통 사이드바 권한 조회 수명주기 연결 (2026-09-12)

- Razor 서비스의 `/api/workspace/navigation` 권한 조회를 서비스별 `workspace-navigation-*` 채널과 공통 `CompanyReadSession`으로 옮겼다. 포커스·재시도는 같은 서비스의 이전 요청을 교체하고, 계정·역할·허용 서비스 범위 변경과 로그아웃은 진행 중인 모든 메뉴 조회를 취소한 뒤 이전 링크·badge·상태를 제거한다.
- same-origin/no-store/redirect 오류·JSON Accept를 유지하고 응답을 다 읽은 뒤 signal·최신 ticket·세대가 모두 현재일 때만 페이지와 badge를 적용한다. pages는 해당 서비스의 등록 메뉴만 허용하고 badges envelope가 객체가 아니면 전체를 거부한다. 등록/권한 밖 badge와 잘못된 count는 표시하지 않으며 401/403/일반 실패의 기존 UI 구분과 초안·키보드 포커스를 보존했다.
- 공통 생성 순서에서 read session을 navigation보다 먼저 배치하고 생성된 여섯 앱 asset/version을 갱신했다. 단위 17개와 루트 구조·CI·단위 324개가 통과했고, 실제 회사 홈 Chrome 122개가 320/390/1440px·두 테마·역할·권한 실패/복구·계정 폼을 확인했다(`artifacts/browser-navigation-reads-phase162`, 약 2.8분).
- `navigation-reads.md`와 공통 읽기·구조/개발/완료 판정 문서를 갱신했다. 이 단계는 서버 인가나 SSO 갱신을 대체하지 않으며 남은 본문 raw 읽기/쓰기, 원격 보호·운영 이관은 계속 미완료다.

## 161차: 통계 overview 중첩 응답 계약 연결 (2026-09-12)

- `overview-contract.js`의 `readStatisticsOverview`를 추가하고 `/api/analytics/overview` JSON을 상태에 넣기 전에 검증한다. 최상위 기간/mode/publication, summary/trend/outcomes/versions/dimensions, 빌드의 재생 시간·버전·구성·추천/노드 조합·무기 파츠/룬·컬렉션, 보스 조우/처치와 하위 빌드, schema/stats의 타입·범위를 확인한다.
- 검증기는 payload를 보정하거나 숫자를 변환하지 않는다. optional 필드도 존재하면 검사하며 하나라도 손상되면 새 payload 전체를 거부하고 이전 완료본을 유지한다. 실제 서버가 제공하는 빈 code/imageCode와 데모 추천 조합의 생략 가능한 버전 이력처럼 현재 두 응답 형식의 의도적 차이는 테스트로 고정했다.
- 통계 서버·집계·UI 단위 74개와 앱 구문 검사, 루트 구조·CI·단위 322개가 통과했다. 실제 통계 Chrome 63개도 모두 통과했다(`artifacts/browser-statistics-overview-phase161`). 데모 전체 payload뿐 아니라 실제 `aggregateEvents` 결과도 계약을 통과하고, 브라우저는 손상된 깊은 구성요소를 그리기 전에 거부한다. 운영 Azure/PlayFab/DB/환경/Docker는 변경하지 않았다.
- `statistics-reads.md`와 앱 README·구조/개발/완료 판정 문서를 갱신했다. 남은 앱별 raw 읽기·폼과 원격 보호·출처·배포/롤백·운영 이관은 미완료다. 전체 목표는 계속 진행 중이다.

## 160차: 통계 갱신 조회와 쓰기 불확실성 경계 분리 (2026-09-12)

- `refresh.js`의 갱신 전 context와 접수 뒤 status GET을 공통 `CompanyReadSession`의 `statistics-refresh-context`·`statistics-refresh-status` 채널로 옮겼다. 개별 read sequence/AbortController를 제거하고 동일 채널 교체·명시 취소·30초 제한·최신 ticket·계정/문서 해제를 공통 계층이 소유한다.
- 실제 갱신 POST의 별도 AbortController/timeout race와 미확정 잠금은 `requestMutation`에만 남겼다. 전송 뒤 관찰 중단을 서버 롤백이나 확정 실패로 처리하지 않으며, 미확정 상태에서 GET 성공만으로 재실행 잠금을 풀지 않는 기존 안전 경계를 보존했다. GET과 POST는 같은 checked JSON transport의 same-origin/no-store/manual redirect·Content-Type·JSON 검사를 통과한다.
- 통계 서버·집계·UI 단위 70개와 앱 구문 검사, 루트 구조·CI·단위 321개가 통과했다. 실제 통계 Chrome 62개도 모두 통과했다(`artifacts/browser-statistics-refresh-reads-phase160`). 운영 Azure/PlayFab/DB/환경/Docker는 변경하지 않았다.
- `statistics-refresh.md`·`statistics-reads.md`·공통 읽기 계약과 앱 README·구조/개발/완료 판정 문서를 갱신했다. `/api/analytics/overview`의 모든 중첩 업무 필드 스키마, 남은 앱별 raw 읽기·폼과 원격 보호·출처·배포/롤백·운영 이관은 미완료다. 전체 목표는 계속 진행 중이다.

## 159차: 통계 설정·본문 조회의 공통 수명주기 연결 (2026-09-12)

- 통계 `app.js`의 초기 `/api/config`와 필터별 `/api/analytics/overview`를 공통 `CompanyReadSession`의 `statistics-bootstrap`·`statistics-overview` 채널로 옮겼다. 개별 lifecycle/request AbortController와 sequence를 제거하고 새 필터·갱신 경계·계정 변경·비지속 해제의 취소, 30초 관찰 제한과 최신 ticket 판정을 공통 계층이 소유한다.
- 기존 마지막 완료 payload 유지, 425 읽기 poll, 필터 debounce, 집계 완료 publication 대조와 refresh POST/미확정 잠금은 유지했다. 일반 transport는 same-origin/no-store/manual redirect·JSON Content-Type과 파싱을 확인하고 취소된 signal을 JSON 뒤 다시 확인한다. HTML 로그인 문서와 손상 JSON을 빈 객체로 처리하지 않는다.
- 통계 서버·집계·UI 단위 70개와 앱 구문 검사, 루트 구조·CI·단위 320개가 통과했다. 실제 통계 Chrome 62개도 모두 통과했다(`artifacts/browser-statistics-read-phase159`, 약 1.2분). 기존 PC/모바일·두 테마·필터/상세·갱신 경계에 non-JSON bootstrap과 계정 변경 뒤 늦은 overview JSON을 추가했다. 운영 Azure/PlayFab/DB/환경/Docker는 변경하지 않았다.
- `statistics-reads.md`와 공통 읽기·앱 README·구조/개발/완료 판정 문서를 갱신했다. `/api/analytics/overview`의 모든 중첩 업무 필드 스키마, `refresh.js`의 별도 읽기 수명주기, 남은 앱별 경로·폼과 원격 보호·출처·배포/롤백·운영 이관은 미완료다. 전체 목표는 계속 진행 중이다.

## 158차: 시트 본문 조회의 공통 수명주기 연결 (2026-09-12)

- `useSheetData`의 초기 설정·분석·스냅샷 묶음, 재분석과 한국어 비교를 생성된 `WorkspaceReadSession`의 `main`·`preview` 채널로 옮겼다. 개별 AbortController/Promise.race/timeout을 제거하고 동일 채널 교체·명시 취소·30초 관찰 제한·최신 ticket·해제를 공통 계층이 소유한다. 로컬 owner는 오래된 finally가 새 로딩 상태를 해제하지 못하게 하는 UI 책임만 유지한다.
- 기존 `api.ts`의 단일 same-origin/no-store/manual redirect checked JSON transport와 `sheetReads.ts`의 전체 응답·대상 검증을 유지했다. 계정 범위 변경, non-persisted pagehide, 화면 이탈, StrictMode 해제와 취소를 무시하는 늦은 fetch/JSON 뒤 이전 본문이 복원되지 않는다. 설정·분석·스냅샷은 원자적으로 표시하고 비교 화면만 독립 취소한다.
- 시트 단위 39개, 타입 검사와 클라이언트/서버 배포 빌드, 루트 구조·CI·단위 319개가 통과했다. 실제 Chrome 번들 52개도 모두 통과했다(`artifacts/browser-sheet-read-phase158`, 약 1.2분). 320/390/1440px·두 테마, 기존 쓰기 확인, 손상/권한 응답, 계정 변경 뒤 늦은 JSON과 비교 중 화면 이동을 포함한다. 운영 Google/DB/환경/Docker는 변경하지 않았다.
- 새 구조/변이 검사는 공통 session marker와 채널, 취소·최신 판정·해제, 단일 checked transport를 강제하고 로컬 controller/timeout 경쟁 복귀를 거부한다. `sheet-reads.md`와 공통 읽기·구조/개발/완료 판정 문서를 현재 구현으로 갱신했다. 이전 네비게이션 테스트의 렌더 시점 할당은 TypeScript definite-assignment로 명시해 실제 실행 순서를 바꾸지 않고 타입 검사를 복구했다.
- `useSheetActions`의 실제 쓰기 및 쓰기 후 묶음 읽기는 기존 별도 수명주기를 유지한다. 서버 expected actor/revision, 남은 앱별 읽기/폼, 원격 보호·출처·독립 배포/롤백·운영 이관은 미완료이며 전체 목표는 계속 진행 중이다.

## 157차: CS 플레이어 데이터 조회의 공통 수명주기 연결 (2026-09-12)

- 플레이어 데이터 화면의 최초 회사/PlayFab 설정, 세 저장소 전체 조회, 권한 범위 복구와 변경 완료 후 목록 재확인을 공통 `CompanyReadSession`의 `player-bootstrap`·`player-lookup` 채널로 옮겼다. 새 조회·계정 범위 변경·비지속 해제에서 읽기를 취소하고 취소를 무시한 늦은 JSON도 설정·편집 토큰·키 목록·편집기에 반영하지 않는다.
- 실제 데이터 변경인 save/add/delete는 읽기 세션과 분리된 변경 허용 목록과 기존 scope/CSRF/45초 관찰 경계를 유지한다. 하나의 same-origin checked JSON transport를 공유하면서 세 저장소별 edit token, 환경·UID·키·전체 초안, gzip SaveData와 64비트 숫자 원문, 미확정/충돌 뒤 반복 쓰기 잠금을 보존했다. 확인된 변경 뒤 조회 실패는 변경을 실패로 바꾸거나 쓰기를 반복하지 않고 명시적인 목록 복구만 허용한다.
- 신규 `cs-player-data-reads.md`와 구조 변이 검사는 두 채널·해제/최신 판정·읽기/변경 분리·단일 transport 누락을 거부한다. CS 단위 97개, 루트 구조·CI·단위 318개와 실제 Chrome 플레이어 데이터 회귀 59개가 PC/모바일·두 테마, 라이브/테스트, 세 저장소, 압축 데이터, 초안/펼치기, 읽기 timeout·늦은 lookup 및 변경 acknowledgement를 확인했다(`artifacts/browser-cs-player-reads-phase157`). 운영 PlayFab·배포는 수행하지 않았고 원격은 미설정이며 전체 목표는 계속 진행 중이다.

## 156차: CS 상품 명령 읽기와 변경 경계 분리 (2026-09-12)

- 상품 지급·회수 화면의 최초/실행 직전 설정 확인, 기존 명령 미리보기, 현재 지급·회수 명령 조회와 삭제 후 상태 확인을 공통 `CompanyReadSession`의 `product-bootstrap`·`product-preview`·`product-lookup` 채널로 옮겼다. 새 작업·계정 범위 변경·비지속 해제에서 읽기를 취소하고 취소를 무시한 늦은 JSON도 설정·미리보기·명령 목록에 반영하지 않는다.
- 실제 명령 작업인 execute와 delete는 읽기 세션과 분리된 변경 허용 목록과 기존 operation/CSRF/45초 관찰 경계를 유지한다. Dry Run도 서버 미리보기 토큰과 요청 ID를 소비하므로 변경 경계에 남겼다. 하나의 same-origin checked JSON transport를 공유하면서 기존 미리보기 만료·입력 서명·DataVersion 재검증, UID별 요청 ID, 부분 실패 재시도와 미확정 쓰기 잠금을 보존했다.
- 신규 `cs-product-command-reads.md`와 구조 변이 검사는 세 채널·해제/최신 판정·읽기/변경 분리·단일 transport 누락을 거부한다. CS 단위 97개, 루트 구조·CI·단위 317개와 실제 Chrome 상품 회귀 26개가 PC/모바일·두 테마, Dry Run/실행/삭제, 읽기 timeout, 늦은 preview/lookup 및 execute 응답을 확인했다(`artifacts/browser-cs-product-reads-phase156`). 운영 PlayFab·배포는 수행하지 않았고 원격은 미설정이며 전체 목표는 계속 진행 중이다.

## 155차: CS Steam 설정·거래 조회의 공통 수명주기 연결 (2026-09-12)

- Steam 환불 화면의 최초/실행 직전 설정 확인과 거래 조회·실행 직전 재검증·환불 후 상태 확인·수동 복구를 공통 `CompanyReadSession`의 `steam-config`·`steam-query` 채널로 옮겼다. 새 작업·계정 범위 변경·비지속 해제에서 읽기를 취소하고 취소를 무시한 늦은 JSON도 거래나 환불 가능 상태에 반영하지 않는다.
- 실제 금전 변경인 환불은 읽기 세션과 분리된 변경 허용 목록과 기존 operation/CSRF/45초 관찰 경계를 유지한다. 읽기와 환불은 하나의 same-origin checked JSON transport를 공유하며 설정·거래·환불 응답은 기존 도메인 validator를 통과해야 한다. 환불 응답이 불확실하면 같은 주문을 잠그고 상태 재확인만 허용하는 정책도 유지했다.
- 신규 `cs-steam-refund-reads.md`와 구조 변이 검사는 두 채널·해제/최신 판정·읽기/변경 분리·단일 transport 누락을 거부한다. CS 단위 97개와 루트 구조·CI·단위 316개가 통과했고 실제 Chrome Steam 회귀 28개가 PC/모바일·두 테마, 확인/초안, 읽기 timeout·늦은 거래 JSON, 금전 요청 단일 전송을 확인했다(`artifacts/browser-cs-steam-reads-phase155`). 운영 Steam API·환불·배포는 수행하지 않았고 원격은 미설정이며 전체 목표는 계속 진행 중이다.

## 154차: CS 로그 설정·상태 조회의 공통 수명주기 연결 (2026-09-12)

- CS 로그 검색의 회사/저장소 설정 확인과 저장된 작업 이어받기·실행 상태 폴링을 공통 `CompanyReadSession`의 `log-bootstrap`·`log-status` 채널로 옮겼다. 새 작업·계정 범위 변경·비지속 해제에서 읽기 ticket을 취소하고, timeout이나 취소를 무시한 늦은 JSON body도 현재 작업에 반영하지 않는다.
- 검색 시작과 취소는 서버 상태를 바꾸는 요청이므로 공통 읽기 세션에 넣지 않았다. 읽기와 변경 경로를 각각 명시적 허용 목록으로 제한하고 하나의 same-origin checked JSON transport를 공유한다. 기존 45초 관찰, CSRF, 저장된 작업 ID, 시작 미확정 시 자동 재전송 금지와 수동 상태 재확인 정책은 유지했다.
- 신규 `cs-log-search-reads.md`와 구조 변이 검사는 두 공통 채널·해제/최신 판정·읽기/변경 분리·단일 transport 누락을 거부한다. CS 단위 97개와 루트 구조·CI·단위 315개가 통과했고, 실제 Chrome 로그 회귀 21개가 장기 검색·상태 재시도·계정 변경·해제·timeout·늦은 status body를 확인했다(`artifacts/browser-cs-log-reads-phase154`). 운영 Azure/Parquet와 배포는 사용하지 않았고 원격은 미설정이며 전체 목표는 계속 진행 중이다.

## 153차: Leave 달력·신청 목록 부분 조회의 공통 수명주기 연결 (2026-09-12)

- 연차 메인 화면의 달력 이동/보기 설정과 내 신청 목록 표시 개수/페이지 이동이 각각 직접 수행하던 GET을 하나의 checked HTML transport와 공통 `CompanyReadSession`의 `leave-calendar`·`leave-request-list` 채널로 옮겼다. 두 영역은 독립적으로 최신 요청을 판정하며 계정 범위 변경·pagehide에서 함께 취소하고 비지속 해제에서는 세션을 dispose한다.
- 요청은 같은 출처의 `/Leave`·`/Leave/Index`만 허용하고 text/html·no-store·redirect 거부를 확인한다. 응답은 정확히 하나의 대상 영역, script 부재와 현재 로컬 직원 ID를 검증한 뒤에만 교체한다. 기존 공통 폼 revision과 관리자/외부 일정/취소 초안 차단을 함께 유지해 확인된 쓰기 전의 늦은 성공·실패가 화면을 덮거나 fallback 이동을 일으키지 않는다.
- 신규 `leave-dashboard-reads.md`와 구조 변이 검사는 두 공통 채널·계정/응답·폼 revision·단일 fetch 경계를 고정하고 자체 timeout/cancellation 복원을 거부한다. 루트 구조·CI·단위 314개와 실제 생성 fixture를 사용하는 Leave 달력/외부 일정/공통 폼/취소 Chrome 135개가 통과했다(`artifacts/browser-leave-dashboard-reads-phase153`). 운영 연차 데이터·서버·DB·배포는 변경하지 않았고, 원격은 미설정이며 전체 목표는 계속 진행 중이다.

## 152차: Leave 발생분 기준 조회의 공통 수명주기 연결 (2026-09-12)

- 연차 보정·발생분 추가·삭제 화면의 직원별 Baseline GET에서 전용 `AbortController`/`Promise.race`/timer를 제거하고 공통 `CompanyReadSession`의 `leave-grant:{employeeId}` 채널로 옮겼다. 같은 직원의 동시 조회는 기존 promise를 공유하고 다른 직원은 독립 채널로 읽으며, 15초 관찰 제한과 취소·최신 ticket 판정을 공통 런타임이 맡는다.
- 기존 직원별 catalog/행 DOM 캐시, 삭제 사유와 보정·추가 날짜 초안, 공통 쓰기 revision, 읽는 동안 쓰기 차단을 유지했다. 계정 범위 변경·문서 해제는 모든 읽기 채널과 작업 확인을 폐기하고, 응답은 전체 발생분 계약을 검증한 뒤에만 캐시·표에 반영한다.
- `leave-grants.md`와 구조 변이 검사는 공통 read session·직원별 현재 요청·dispose·늦은 JSON 검증 누락 및 화면 전용 읽기 timeout/cancellation 복원을 거부한다. 루트 구조·CI·단위 313개와 실제 생성 fixture/Chrome 발생분 49개가 통과했다(`artifacts/browser-leave-grant-reads-phase152`). 운영 연차 데이터·서버·DB·배포는 변경하지 않았고, 원격은 미설정이며 전체 목표는 계속 진행 중이다.

## 151차: Leave 감사 로그 조회의 공통 수명주기 연결 (2026-09-12)

- 관리자 감사 로그의 검색·표시 개수·페이지 이동 GET에서 화면 전용 `AbortController`/timer를 제거하고 공통 `CompanyReadSession`의 `leave-audit` 채널로 옮겼다. 새 조회·검색 조건 변경·계정 범위 변경·pagehide는 진행 요청을 취소하고, 15초 관찰 제한과 현재 ticket 판정은 공통 런타임이 맡는다.
- 같은 출처/경로와 검색 조건, 현재 로컬 직원, 단일 결과 영역·필수 폼/표·script 부재를 모두 확인한 뒤에만 목록을 교체한다. 실패·timeout에는 마지막 정상 목록과 입력을 유지하고 GET만 다시 시도하며, 401/403·소유자 변경은 이전 계정 내용을 제거하는 기존 경계를 유지했다.
- `leave-audit.md`와 신규 구조 변이 검사는 공통 read session·취소·dispose·늦은 body 판정과 전체 응답 검증 누락 및 자체 timeout/cancellation 복원을 거부한다. 루트 구조·CI·단위 313개와 실제 생성 fixture/Chrome 감사 로그 21개가 통과했다(`artifacts/browser-leave-audit-reads-phase151`). 운영 감사 데이터·서버·DB·배포는 변경하지 않았고, 원격은 미설정이며 전체 목표는 계속 진행 중이다.

## 150차: Leave 승인 목록 조회의 공통 수명주기 연결 (2026-09-12)

- 관리자 승인 화면의 대기열 summary와 전체 목록 GET에서 자체 `Promise.race`/`AbortController`/timer를 제거하고 공통 `CompanyReadSession`의 `approval-summary`·`approval-lists` 채널로 옮겼다. 기존 3초 감시와 15초 관찰 제한은 유지하며, 승인 확인 시작·명시적 목록 조회·계정 범위 변경·문서 해제에서 해당 조회를 취소하고 현재 ticket이 아닌 늦은 결과를 배제한다.
- 전체 목록은 현재 계정과 두 목록 영역을 모두 검증한 뒤에만 교체하고, summary는 문자열 version과 두 대기 건수를 모두 검증한다. 강제 삭제 사유 초안이 있으면 자동 갱신하지 않고, 확인된 승인 저장과 후속 GET 실패를 구분하며, 권한 거부나 계정 변경에는 이전 계정 목록을 숨기는 기존 경계를 유지했다.
- `leave-approvals.md`와 구조 변이 검사는 공통 read session·채널 취소·dispose·최신 요청 판정이 빠지거나 자체 timeout/cancellation이 복원되면 실패한다. 루트 구조·CI·단위 312개와 실제 생성 fixture/Chrome 승인 24개가 통과했다(`artifacts/browser-leave-approval-reads-phase150`). 운영 연차 데이터와 서버·DB·배포는 변경하지 않았고, 원격은 미설정이며 전체 목표는 계속 진행 중이다.

## 149차: Schedule 범용 raw 전송 우회로 제거 (2026-09-12)

- Schedule 화면의 읽기·쓰기가 공통 세션과 전송으로 모두 연결된 뒤에도 `api.ts`에 남아 있던 범용 `api()` fetch와 전역 CSRF 저장소를 제거했다. bootstrap은 CSRF를 검증된 `Bootstrap` 값으로만 보유하고 각 쓰기 hook이 저장 직전 재확인한 토큰을 공통 transport에 명시적으로 전달한다.
- 업무 작업 단위 검사는 폐기된 `api()` mock 대신 주입된 `readDetail`을 직접 격리한다. 레거시 204 검증 함수의 설명도 특정 transport 이름에 의존하지 않게 정리했다.
- `checkScheduleReads`와 변이 검사는 Schedule 유틸리티에 raw fetch/범용 `api()`/전역 `setCsrf`가 다시 생기면 실패한다. 일정 집중 단위 20개, 전체 단위 210개, 구조/생성기 49개, 루트 구조·CI·단위 312개와 배포 빌드가 통과했다. 서버·화면 동작은 이 단계에서 변경하지 않았으며 운영 배포 완료 근거가 아니다.

## 148차: Schedule 개인 TODO의 공통 저장 수명주기 연결 (2026-09-12)

- 개인 TODO 추가·수정·완료/되돌리기·순서 변경·삭제의 raw writer를 공통 `workspaceDocumentFormSession`/`createWorkspaceWriteTransport`로 옮겼다. 저장 직전 회사 계정과 `/api/personal-todos/editing`의 정확한 행 또는 탭 전체 목록을 함께 확인하고, 초안·actor·탭·Version·순서가 달라지면 전송하지 않는다.
- 서버 `PersonalTodoWriteProtocol`은 opt-in 요청에 actor·TODO 전체 기준 토큰을 요구하고, 기준 읽기·첫 쓰기·저장 결과 재조회·ACK를 같은 DB 트랜잭션에 둔다. 다섯 작업은 operation·이전/새 토큰과 저장 행 또는 전체 목록을 `workspace-form-v1`으로 반환하며 레거시 JSON/204 응답은 유지한다. 삭제는 query와 전송 JSON의 Version도 서로 대조한다.
- 클라이언트는 보낸 전체 JSON과 전체 ACK를 검증한 뒤에만 성공/초안 정리를 적용한다. 첫 쓰기 뒤 통신·응답 오류는 같은 문서에서 재전송하지 않고, 성공 뒤 목록 조회만 실패하면 쓰기를 반복하지 않은 채 GET만 복구한다. `schedule-todo-writes.md`와 구조 변이는 raw writer, actor/상태, 트랜잭션, lease/`markSent`, 전체 ACK 누락을 거부한다.
- Schedule 단위 210개, 서버 68개, 구조/생성기 49개, 루트 구조·CI·단위 312개와 TypeScript/배포 빌드가 통과했다. 실제 번들 Chrome TODO 14개도 모바일/PC·라이트/다크에서 CRUD·완료·정렬·삭제 확인, 오류/충돌·계정 변경과 저장 후 조회 실패를 통과했다(`artifacts/browser-todo-write-phase148`). 합성 브라우저/SQLite 검증은 운영 배포 증거가 아니며 원격은 미설정이다.

## 147차: Schedule 업무 본문 참조 제목의 공통 조회 연결 (2026-09-12)

- 업무·댓글 본문의 다른 업무 링크 제목 raw GET을 `TaskLinkProvider` 안의 `WorkspaceReadSession`/`scheduleGet`으로 옮겼다. 같은 provider와 업무 ID는 요청을 공유하지만 회사 계정 범위·상세 identity 무효화·언마운트에서는 진행 요청과 캐시를 모두 폐기한다.
- `taskReferenceResponse`가 요청 ID, 제목, nullable 프로젝트 ID와 보관 상태 전체를 확인한 뒤에만 링크 라벨을 표시한다. 취소·늦은 결과·권한 또는 응답 오류는 이전 계정 제목을 유지하지 않고 확인 불가 링크로 되돌리며, 기존 초안 확인과 실제 업무 이동 흐름은 분리해 유지한다.
- `schedule-task-reference-reads.md`와 구조/변이 검사는 raw GET, 공통 세션·업무별 채널·scope·dispose·상세 identity 연결과 응답 parser 누락을 거부한다. Schedule 전체 단위 207개, 구조/생성기 49개, 루트 구조·CI·단위 311개와 TypeScript/배포 빌드가 통과했다. 실제 번들/Chrome 5개도 모바일/PC·라이트/다크의 JSON 요청, 제목 표시, scope 뒤 제목 폐기와 초안·URL 유지, 승인 후 대상 상세 이동을 통과했다.
- 서버 API·DB·인가·업무 쓰기는 변경하지 않았다. 원격은 미설정이며 다음 raw 쓰기 전환, 원격 보호·독립 배포/롤백·운영 이관은 남아 있고 전체 목표는 진행 중이다.

## 146차: Schedule 일정 관리·보관함 목록의 공통 조회 연결 (2026-09-12)

- `Settings`의 관리자/읽기 전용 주요 일정 목록과 관리자 보관함·더 보기 raw GET을 `WorkspaceReadSession`/`scheduleGet`으로 옮겼다. 탭·조회 시작일·회사 계정 범위·화면 수명 변경에서 이전 `settings-milestones`/`settings-archive` 요청을 취소하고 현재 generation/ticket만 적용한다.
- 관리자 주요 일정은 편집 기준을 포함한 `milestonePageResponse`, 일반 직원은 `milestoneResponse`, 보관함은 모든 행의 archived 상태를 확인하는 `archivedTaskPageResponse`를 사용한다. 더 보기는 total 고정·비어 있지 않은 다음 페이지·업무 ID 비중복·전체 집계와 합친 길이를 검증한 뒤 목록을 한 번에 교체한다.
- `schedule-settings-reads.md`와 구조/변이 검사는 raw 목록 GET, 공통 세션·scope·dispose·parser와 안전한 페이지 병합 누락을 거부한다. Schedule 전체 단위 206개, 구조/생성기 48개, 루트 구조·CI·단위 310개와 TypeScript/배포 빌드가 통과했다. 실제 번들/Chrome 관리 화면 4개와 보관함 페이지 1개도 모바일/PC·라이트/다크의 기존 편집 흐름, JSON 요청과 안정된 다음 페이지 병합을 통과했다.
- 주요 일정 쓰기의 독립 사전/사후 조회와 생성·수정·삭제, 업무 복원, 서버 API·DB·인가는 변경하지 않았다. 원격은 미설정이며 다른 raw 읽기/쓰기, 원격 보호·독립 배포/롤백·운영 이관은 남아 있고 전체 목표는 진행 중이다.

## 145차: Schedule 읽기 전용 업무 열기 도구의 공통 조회 연결 (2026-09-12)

- `open_schedule_task`가 화면 이동 전에 직접 수행하던 업무 상세 GET을 `WorkspaceReadSession`/`scheduleGet`의 `webmcp-task-open` 채널로 옮겼다. `taskDetailResponse`로 요청 ID와 업무·댓글·첨부·변경 기록 전체를 검증한 뒤에만 기존 공통 화면 이동을 요청한다.
- 같은 도구의 연속 실행과 회사 계정 범위 변경은 앞선 요청을 취소하고, 등록 해제·앱 수명 종료는 세션을 dispose한다. 취소됐거나 현재 ticket이 아닌 결과, 조회/권한/검증 실패와 사용자가 거부한 초안 이동은 `opened: true`로 보고하지 않는다.
- `schedule-tool-reads.md`와 구조/변이 검사는 raw 사전 GET, 공통 세션·채널·scope·dispose·전체 상세 검증 누락을 거부한다. Schedule 전체 단위 205개, 구조/생성기 47개, 루트 구조·CI·단위 309개와 TypeScript/배포 빌드가 통과했다. 실제 번들/Chrome 1개는 성공 조회의 JSON Accept·상세 이동과 404 실패의 기존 화면 유지를 확인했다.
- TaskPanel의 자체 상세 관찰, 서버 API·DB·인가·쓰기는 변경하지 않았다. 원격은 미설정이며 다른 raw 읽기/쓰기, 원격 보호·독립 배포/롤백·운영 이관은 남아 있고 전체 목표는 진행 중이다.

## 144차: Schedule 날짜 선택기 공휴일 조회의 공통 수명주기 연결 (2026-09-12)

- 업무·날짜 이동의 `DatePicker`가 직접 호출하던 공휴일 GET을 `WorkspaceReadSession`/`scheduleGet`의 `date-picker-holidays` 채널로 옮겼다. 달력 닫기·월 변경·재시도·회사 계정 범위 변경·언마운트에서 이전 요청을 취소하고 현재 ticket이 아닌 늦은 결과는 적용하지 않는다.
- 6주 42일의 `from`·`to`와 기존 지원 날짜 경계를 유지한다. 응답은 `absencesResponse`로 전체 구조를 검증한 뒤 공휴일을 표시하며, 실패하거나 공휴일 가용성이 없으면 주말 표시와 명시적 재시도를 유지한다. 조회 요청은 JSON Accept·same-origin credential·no-store와 HTTP/리디렉션/content-type 검사를 공통으로 사용한다.
- `schedule-date-picker-reads.md`와 구조/변이 검사는 raw 공휴일 GET, 공통 세션·채널·취소·dispose·전체 응답 검증 누락을 거부한다. Schedule 전체 단위 205개, 구조/생성기 46개, 루트 구조·CI·단위 308개와 TypeScript/배포 빌드가 통과했다. 실제 번들/Chrome 달력 4개도 모바일/PC·라이트/다크에서 성공·실패·재시도와 JSON 요청을 통과했고 모바일 다크 정상/실패 화면을 직접 확인했다.
- 날짜 선택과 업무 쓰기, 서버 API·DB·인가를 변경하지 않았다. 원격은 미설정이며 다른 raw 읽기/쓰기, 원격 보호·독립 배포/롤백·운영 이관은 남아 있고 전체 목표는 진행 중이다.

## 143차: Schedule 개인 TODO 목록의 공통 조회 연결 (2026-09-12)

- 개인 TODO의 할 일·보관함, 삭제 전 재확인과 저장 후 목록 GET을 `WorkspaceReadSession`/`scheduleGet`의 `personal-todos` 채널로 옮겼다. 계정 scope·탭 전환은 요청을 취소하고 언마운트는 세션을 dispose해 늦은 결과가 이전 계정의 목록을 되살리지 못하게 했다.
- TODO 행은 요청 시점 ownerId와 다시 확인한 회사 계정을 모두 대조하고 ID·버전·순서·제목·시각·중복을 검증한 뒤 표시한다. 자동 polling은 편집 초안을 교체하지 않고, 저장 후 GET 실패는 확인된 쓰기를 반복하지 않는 기존 경계를 유지했다.
- `schedule-todo-reads.md`와 구조/변이 검사는 raw TODO GET, 공통 세션·채널·취소·dispose·검증 GET 누락을 거부한다. Schedule 전체 단위 205개, 구조/생성기 45개, 루트 구조·CI·단위 307개와 TypeScript/배포 빌드가 통과했다. 실제 번들/Chrome TODO 전체 14개도 모바일/PC·라이트/다크에서 통과했다.
- POST/PUT/PATCH/DELETE 쓰기, 서버 API·DB·인가가 이 단계에서는 변경되지 않았다. 원격은 미설정이며 TODO 쓰기와 다른 raw 읽기/쓰기, 원격 보호·독립 배포/롤백·운영 이관은 남아 있고 전체 목표는 진행 중이다.

## 142차: Schedule 버전 기록 조회의 공통 수명주기 연결 (2026-09-12)

- 버전 시리즈·마이너·구형 목록과 편집 상세의 롤백/해결 참조·참조 페이지·변경 이력 raw GET을 공통 `WorkspaceReadSession`/`scheduleGet`으로 옮겼다. URL·편집 대상·Version·계정 scope 변경은 채널을 취소하고, 언마운트는 세션을 dispose해 늦은 응답이 현재 행·초안을 바꾸지 못하게 했다.
- 목록·참조·revision snapshot parser는 안전한 ID, 중복, total, 현재 프로젝·기본 버전 범위와 변경 이력 JSON을 표시 전에 검증한다. 첫 실패를 빈 성공으로 보이지 않고 재조회 실패에는 직전 정상 행을 유지하며, 401/403·scope 변경은 이전 행을 제거한다. 재시도는 GET만 반복한다.
- 계약 `schedule-release-reads.md`와 구조/변이 검사는 raw release GET, 공통 세션·취소·dispose, 정확한 parser 연결이 다시 빠지는 경우를 거부한다. Schedule 단위 205개, 구조/생성기 45개, 루트 구조·CI·단위 307개와 TypeScript/배포 빌드가 통과했다. 실제 번들/Chrome의 release 전체 48개도 모바일/PC·라이트/다크에서 통과했고 모바일 다크 목록 화면을 직접 확인했다(`artifacts/browser`).
- 서버 API·DB·인가·쓰기 계약과 운영 checkout·Docker는 변경하지 않았다. 원격은 미설정이며 다른 raw 읽기/쓰기, 원격 보호·독립 배포/롤백·운영 이관은 남아 있고 전체 목표는 진행 중이다.

## 141차: Schedule 버전 기록 생성·수정의 공통 저장 연결 (2026-09-12)

- 버전 기록 편집기의 raw POST/PUT를 `useReleaseEditor`의 공통 확인·JSON transport·문서 lease로 통합했다. 저장 직전 현재 회사 계정과 `/api/releases/editing`의 대상 또는 프로젝트 전체 기준을 다시 읽고, 프로젝트·영구 버전 번호·전체 초안과 opaque 기준 토큰을 고정한 뒤에만 요청한다.
- 서버 `ReleaseWriteProtocol`은 opt-in `workspace-form-v1` envelope를 추가하면서 기존 bare `ReleaseRecord` 응답을 유지한다. actor·관리 권한·프로젝트 범위·Version·기준 토큰을 대조하고 기준 읽기, 변경·revision·감사 기록, 전체 ACK 캡처를 한 트랜잭션에 둔 뒤 커밋 성공 후 반환한다.
- 클라이언트는 operation·actor·이전/새 기준 토큰, 전송 JSON과 생성·수정된 전체 Release 행을 확인한 뒤에만 편집 기준을 교체한다. 확인 취소와 사전 충돌은 전송하지 않고, scope 변경이나 전송 뒤 malformed/네트워크 미확정은 같은 문서에서 재전송하지 않는다. 저장 ACK 뒤 목록 조회 실패는 읽기만 다시 시도한다.
- 구조 검사는 raw release writer와 actor·기준·트랜잭션·확인·`markSent`·전체 ACK·문서 세션 누락을 거부한다. Schedule 단위 204개, 서버 66개, 루트 구조·CI·단위 307개, 실제 Razor/TestServer 통합 218개와 TypeScript/배포 빌드가 통과했다. 실제 번들/Chrome Schedule 전체 198개도 모바일/PC·라이트/다크에서 통과했고 모바일 다크 변경 비교 화면을 직접 확인했다(`artifacts/browser`).
- 원격은 미설정이며 원본 저장소·운영 checkout·DB·환경·Docker와 배포는 변경하지 않았다. 다른 raw 쓰기와 다른 앱의 남은 UI, 원격 보호·독립 배포/롤백·운영 이관은 남아 있고 전체 목표는 진행 중이다.

## 140차: Schedule 업무 보관·복원·댓글 삭제의 공통 저장 연결 (2026-09-12)

- 업무 상세의 보관·복원과 댓글 삭제를 `useTaskActions`의 공통 확인·JSON transport·문서 lease로 통합했다. 화면에 보인 업무/댓글·본문 첨부, actor, Version과 opaque 기준 토큰 및 정확한 `{version}` 본문을 고정하고 최신 회사 계정과 상세를 다시 읽은 뒤에만 요청한다.
- 서버는 기존 `TaskWriteProtocol`/`CommentWriteProtocol`을 세 작업에도 적용했다. actor·권한·기준·Version을 대조하고 기준 읽기, 변경·감사, 전체 ACK 캡처를 한 트랜잭션에 둔 뒤 커밋 후 반환한다. 공통 호출은 보관/복원의 전체 Task·본문 첨부와 삭제된 전체 Comment·첨부 해제를 확인하며 레거시 Task/204 응답은 유지한다.
- 확인 취소·사전 변경·권한 거부는 요청하지 않는다. scope 변경의 미전송 의도는 현재 계정과 상세를 명시적으로 다시 확인해야 복구하며, 전송 뒤 malformed/네트워크 미확정은 같은 문서에서 다시 보낼 수 없다. 유효한 ACK 뒤 목록 GET 실패는 읽기만 재시도한다.
- 구조 검사는 raw 작업 writer와 actor·기준·트랜잭션·확인·markSent·전체 ACK·문서 세션 누락을 거부한다. Schedule 단위 201개, 서버 63개, 루트 구조·CI·단위 306개, 실제 Razor/TestServer 통합 218개와 TypeScript/배포 빌드가 통과했다. 실제 번들/Chrome 집중 5개와 Schedule 전체 197개도 모바일/PC·라이트/다크에서 통과했다(`artifacts/browser-schedule-task-actions-final`, `artifacts/browser-schedule-task-actions-all`). 모바일 다크 확인창을 직접 확인했다.
- 원격은 미설정이며 원본 저장소·운영 checkout·DB·환경·Docker와 배포는 변경하지 않았다. 다른 raw 쓰기와 다른 앱의 남은 UI, 원격 보호·독립 배포/롤백·운영 이관은 남아 있고 전체 목표는 진행 중이다.

## 139차: Schedule 주요 일정 생성·수정·삭제의 공통 저장 연결 (2026-09-12)

- 일정 관리 `Settings`의 주요 일정 POST/PUT/DELETE를 `useMilestoneWrites`로 통합했다. 편집 중인 제목·상세·날짜·프로젝트·타입·Version과 원본 행을 고정하고 최신 회사 계정과 생성용 전체 목록 또는 대상 행의 opaque 기준을 다시 읽은 뒤 공통 확인창·JSON transport·문서 lease를 사용한다.
- 서버 `MilestoneWriteProtocol`은 opt-in 공통 envelope를 추가하고 일반 직원의 기존 배열 조회, 레거시 생성·수정 단일 Milestone과 삭제 204를 유지한다. actor·관리 권한·프로젝트 공개 범위·Version과 기준 토큰을 대조하고 기준 읽기부터 DB 쓰기·ACK 캡처까지 트랜잭션 안에 둔 뒤 커밋 성공 후 반환한다. 첫 쓰기 뒤 오류는 unknown이다.
- 클라이언트는 전송 JSON, operation·actor·이전/새 기준 토큰, 생성·수정된 전체 행 또는 삭제 직전 전체 행을 검증한 뒤에만 초안과 목록을 갱신한다. 확인 취소와 사전 충돌은 쓰지 않고 작성 중인 초안을 유지하며, 성공 ACK 뒤 목록 GET 실패는 쓰기를 반복하지 않는다. 삭제는 고정한 Version만 보낸다.
- 구조 검사는 raw 주요 일정 writer와 actor·기준·트랜잭션·확인·markSent·전체 ACK·문서 세션 누락을 거부한다. Schedule 단위 200개, 서버 60개, 루트 구조·CI·단위 305개, 실제 Razor/TestServer 통합 218개와 TypeScript/배포 빌드가 통과했다. 실제 번들/Chrome의 생성·수정·삭제 집중 4개와 Schedule 전체 197개도 모바일/PC·라이트/다크에서 통과했다(`artifacts/browser-schedule-milestone-writes-final4`, `artifacts/browser-schedule-milestone-writes-all`). 모바일 다크 삭제 확인창과 PC 라이트 편집 화면을 직접 확인했다.
- 원격은 미설정이며 원본 저장소·운영 checkout·DB·환경·Docker와 배포는 변경하지 않았다. 다른 앱과 Schedule의 남은 읽기/쓰기/UI, 원격 보호·독립 배포/롤백·운영 이관은 남아 있고 전체 목표는 진행 중이다.

## 138차: Schedule 댓글 생성·답글·수정의 공통 저장 연결 (2026-09-12)

- `CommentComposer`와 `TaskPanel`의 raw 댓글 POST/PUT를 `useCommentWrites`로 통합했다. 본문·parent·version·첨부 ID 원문을 고정하고 최신 회사 계정과 업무 상세의 opaque 댓글 기준을 다시 읽은 뒤 공통 확인창·JSON transport·문서 lease를 사용한다. 업무 편집 가능 여부와 댓글 작성자 권한은 계속 분리한다.
- 서버 `CommentWriteProtocol`은 opt-in 공통 envelope를 추가하고 기존 bare Comment 응답과 API 본문을 유지한다. 새 댓글 기준은 전체 댓글/첨부, 루트 댓글 기준은 해당 답글/첨부까지 포함해 연속 등록은 허용하면서 오래된 생성·답글·수정은 첫 쓰기 전에 거부한다. 기준 읽기부터 전체 ACK 캡처까지 트랜잭션 안에 두고 커밋 뒤 반환하며 첫 쓰기 뒤 오류는 unknown이다.
- 클라이언트는 operation·actor·이전/새 기준 토큰, 전송 JSON, 저장된 댓글 전체와 연결 첨부 전체를 검증한 뒤에만 초안을 비운다. scope 변경의 미전송 작업은 원래 actor의 명시적 상세 조회로만 복구하고 sent/unknown은 같은 문서에서 다시 보내지 않는다. 성공 ACK 뒤 목록 GET 실패는 댓글을 다시 쓰지 않는다.
- 구조 검사는 raw 댓글 writer와 계정/기준·확인·markSent·전체 ACK·세션 누락을 거부한다. Schedule 단위 192개, 서버 57개, 루트 구조·CI·단위 304개, 실제 Razor/TestServer 통합 218개와 TypeScript/배포 빌드가 통과했다. 실제 번들/Chrome의 생성·답글·수정 집중 9개가 모바일/PC·라이트/다크에서 통과했다(`artifacts/browser-schedule-comment-writes`).
- 첫 Schedule 전체 검사는 기존 합성 상세 응답 1곳에 새 `commentEditing` 기준이 없어 복구 시나리오 4개가 실패했다. 실제 서버와 같은 응답으로 fixture를 보완하고 해당 4개를 집중 재검증한 뒤 전체 197개가 통과했다(`artifacts/browser-schedule-comment-writes-all-final`, 2.1분). 모바일 다크 비교창과 PC 라이트 편집 화면을 직접 확인했다.
- 원격은 미설정이며 원본 저장소·운영 checkout·DB·환경·Docker와 배포는 변경하지 않았다. 주요 일정과 다른 앱의 남은 쓰기/UI, 원격 보호·독립 배포/롤백·운영 이관은 남아 있고 전체 목표는 진행 중이다.

## 137차: Schedule 이미지 업로드의 공통 저장 연결 (2026-09-12)

- 업무 본문·새 댓글·답글·댓글 수정의 공통 Editor에서 `api('/api/images')`로 직접 보내던 선택/붙여넣기/드롭을 `useImageUploads`로 통합했다. 최신 회사 계정과 첨부 목록을 확인하고 파일 이름·크기·SHA-256을 고정한 뒤 공통 확인창·multipart transport·문서 lease를 사용한다. 확인 취소 전 요청은 없고 처리 중 편집기와 바깥 업무/댓글 저장을 잠근다.
- 같은 순간의 두 번째 파일 선택을 동기 batch lock으로 막고 여러 파일은 확인된 한 묶음 안에서 순차 처리한다. 각 파일의 operation·actor·digest와 전송 FormData, 서버 Attachment 전체를 검증한 뒤에만 초안 목록에 넣는다. malformed/timeout/scope/pagehide는 자동 재전송하지 않으며 앞에서 확인된 일부 첨부는 유지한다.
- 서버 `ImageWriteProtocol`은 opt-in 공통 envelope만 추가하고 기존 단일 Attachment 응답, multipart 경로, 10MB/10개·magic bytes·임시 용량/24시간 정리와 최종 업무·댓글 연결 정책을 유지한다. 실제 파일을 쓰면서 SHA-256을 계산하고 DB 저장 후 ACK하며 첫 파일 쓰기 뒤 예외는 정리 시도와 무관하게 unknown으로 분류한다.
- 새 서버 검사 3개를 포함한 Schedule 서버 53개, 새 hook 단위 5개를 포함한 단위 179개, 실제 격리 Razor/서버 통합 196개와 루트 303개, 구조/변이·TypeScript/배포 빌드가 통과했다. 모바일 다크·PC 라이트 집중 Chrome 2개와 Schedule 전체 197개도 통과했다(`artifacts/browser-schedule-image-upload`, `artifacts/browser-schedule-image-upload-all`, 최종 2.1분). 확인창과 첨부 완료 화면을 직접 확인했다.
- React 공통 transport 타입에 이미 런타임이 지원하던 FormData 요청을 노출하고 Schedule/Sheet generated 파일을 재생성했다. JS 런타임·CSS는 바꾸지 않았으므로 다른 다섯 서비스 전체 브라우저 회귀를 이번 단계의 증거로 주장하지 않는다. 원격은 미설정이며 원본 저장소·운영 checkout·DB·환경·Docker와 배포는 변경하지 않았다. 댓글/주요 일정 전송과 다른 앱의 남은 UI/쓰기, 원격 보호·독립 배포/롤백·운영 이관은 남아 있고 전체 목표는 진행 중이다.

## 136차: Schedule 칸반 상태 변경의 공통 저장 연결 (2026-09-12)

- 칸반의 상태 드롭다운과 드래그가 `App.tsx`에서 직접 PATCH하던 경로를 `useTaskQuickStatus`로 옮겼다. 화면 행의 업무 ID·버전·현재 상태를 고정하고 전송 직전 회사 계정과 상세 GET을 다시 확인한 뒤 공통 확인창을 거쳐 기존 `TaskWriteProtocol`의 전체 ACK를 검증한다. 확인 전 행 이동은 없으며 처리 중에는 상태 선택과 드래그를 잠근다.
- 확인 중 행·필터·계정이 바뀌면 전송하지 않는다. 검증된 ACK 뒤에만 보드를 새로 읽어 열을 이동하고, 저장 뒤 GET만 실패하면 PATCH를 반복하지 않는다. malformed ACK·timeout·scope/pagehide의 미확정 전송은 같은 문서 세션을 잠근다. 서버 API·DB 계약은 바꾸지 않고 기존 enhanced 상태 저장 경로를 재사용했다.
- 구조/변이 검사는 raw App PATCH와 hook의 raw fetch/api 재도입, 공통 확인·transport·전체 ACK·수명주기 연결 누락을 거부한다. 새 hook 단위 5개를 포함한 Schedule 단위 174개, 서버 50개, 실제 격리 Razor/서버 통합 196개, 루트 302개와 TypeScript/배포 빌드가 통과했다.
- 합성 HTTP와 실제 번들/Chrome의 모바일 다크·PC 라이트 집중 2개 및 Schedule 전체 195개가 통과했다(`artifacts/browser-schedule-quick-status`). Escape 취소 시 원래 열 유지, 확인 전 쓰기 없음, 저장 중 잠금, 정확한 state 헤더·본문과 ACK 뒤 열 이동을 검사하고 두 화면을 직접 확인했다.
- 원격은 미설정이며 원본 저장소·운영 checkout·DB·환경·Docker와 배포는 변경하지 않았다. 이미지 업로드·댓글/주요 일정 전송 및 다른 앱의 남은 쓰기/화면, 원격 보호·독립 배포/롤백·운영 이관은 계속 남아 있다. 전체 목표는 진행 중이다.

## 135차: Leave 구형 상단 알림 UI 제거 (2026-09-12)

- 공통 셸 도입 뒤 Razor/JS 어디에서도 생성되지 않고 CSS에만 남아 있던 Leave 전용 종 버튼, 상단 숫자 배지, 알림 팝오버와 후속 색·반응형 보정을 제거했다. 구형 모바일 인증 표시의 중복 override도 함께 정리했다.
- 알림 페이지의 목록·읽지 않음 점·작업 버튼·모바일 2열 배치는 유지했다. 구조 검사는 공통 셸 경계와 실제 알림 목록 스타일을 요구하고 퇴역한 상단 알림 selector 재도입을 거부한다.
- 구조 변이 44개, 전체 통합 서버 218개와 실제 Razor fixture 서버 196개, 알림센터·Leave 셸 Chrome 156개가 통과했다. 모바일 다크와 PC 라이트 알림 화면을 직접 확인했다. 운영 알림·DB·Docker·원본 checkout에는 연결하지 않았으며 운영 반영 증거로 확대하지 않는다.

## 134차: Sheet 준비 상태 pill 공통화 (2026-09-12)

- 시트 운영 개요의 `READY` 준비 상태를 success `cw-state-pill`에 연결했다. 준비 상태 문구와 화면 배치는 유지하고 공통 의미 점도 함께 사용한다.
- 시트 전용 `.live-label`의 7px 글꼴, 배경·글자색·padding·모서리와 점 skin을 제거했다. 구조 검사는 실제 JSX와 공통 success/dot primitive를 요구하고 전용 palette·geometry 재도입을 거부한다.
- 구조 변이 43개, 시트 단위 39개와 프로덕션 빌드, 320/390/1440px·라이트/다크 집중 Chrome 6개와 시트 전체 Chrome 52개가 통과했다. 모바일 다크와 PC 라이트 화면을 직접 확인했다. 합성 시트 응답만 사용했으며 Google Sheets·운영 서버·Docker·전 서비스 회귀나 운영 반영 증거로 확대하지 않는다.

## 133차: Schedule 버전 상태 pill 공통화 (2026-09-12)

- 버전 기록의 안정 상태와 해결 완료 문구를 success, 불안정·롤백·건너뜀을 danger, 상태 미기재를 neutral `cw-state-pill`에 연결했다. 상태 판정·문구, 버전 목록/편집·충돌·이력·공통 펼치기 동작은 변경하지 않았다.
- 일정 전용 `.release-status`의 배경·글자색·테두리·padding·크기와 상태별 팔레트를 제거했다. 구조 검사는 세 의미 tone과 공통 primitive를 요구하고 전용 geometry/palette 재도입을 거부한다.
- 구조 변이 43개, 일정 단위 169개와 프로덕션 빌드, 320/1440px·라이트/다크 집중 Chrome 4개와 일정 전체 Chrome 193개가 통과했다. 모바일 다크와 PC 라이트 화면을 직접 확인했다. 합성 일정 API만 사용했으며 운영 DB·Docker·전 서비스 회귀나 운영 반영 증거로 확대하지 않는다.

## 132차: CS 변경 요약 상태 pill 공통화 (2026-09-11)

- 플레이어 JSON 편집기의 `수정/추가/삭제 N줄` 요약을 각각 warning/success/danger `cw-state-pill`에 연결했다. 실시간 diff 계산, 줄 배경·삭제 위치, 이전/다음 변경 이동과 원문 복원·저장 동작은 변경하지 않았다.
- CS 전용 `.diff-chip`의 배경·글자색·padding·모서리·글자 크기를 제거했다. 구조 검사는 세 의미 tone과 공통 primitive를 요구하고 전용 geometry/palette 재도입을 거부한다.
- 구조 변이 43개, CS 단위 97개, 라이브/테스트·320/1440px·라이트/다크 집중 Chrome 8개와 CS 플레이어 데이터 전체 Chrome 59개가 통과했다. 모바일 다크와 PC 라이트 화면을 직접 확인했다. 합성 PlayFab fixture만 사용했으며 운영 데이터·Docker·전 서비스 회귀나 운영 반영 증거로 확대하지 않는다.

## 131차: Portal 서비스 사용 가능 요약 공통화 (2026-09-11)

- 회사 홈 업무 도구 제목 옆의 `N개 서비스 사용 가능` 요약을 success `cw-state-pill`에 연결했다. 각 서비스 카드의 `사용 가능`과 같은 의미·색 체계를 쓰며 서버의 권한별 `AvailableSystems` 계산과 서비스 링크는 변경하지 않았다.
- Portal 전용 `.service-count`와 내부 점의 색·크기·그림자를 제거했다. 구조 검사는 요약과 일반/관리자 카드의 공통 tone, 공통 의미 점을 함께 요구하고 전용 palette·dot·geometry 재도입을 거부한다.
- 구조 변이 43개, 실제 격리 Razor·서버 통합 196개, 회사 홈 320/390/1440px·라이트/다크 집중 Chrome 6개와 Portal 전체 Chrome 122개가 통과했다. 모바일 다크와 PC 라이트 화면을 직접 확인했다. 운영 계정·권한 DB·Docker에는 연결하지 않았으며 다른 앱이나 운영 반영 증거로 확대하지 않는다.

## 130차: Sheet 상태 pill 의미 점 공통화 (2026-09-11)

- 전환 가능/확인 필요, 한국어 갱신 상태와 Google/데모 연결 상태가 사용하는 `cw-state-pill` 내부 의미 점의 크기·원형·축소 방지를 공통 primitive로 옮겼다. 앱이 소유하던 `.status-pill i, .sync-pill i` 규칙은 제거했다.
- 구조 검사는 연결 상태뿐 아니라 세 Sheet 상태 계열의 전용 점 skin 재도입을 거부하고, 공통 원본에 점의 필수 geometry가 있는지도 확인한다. 기존 상태 판정·문구·tone과 연결/쓰기 정책은 변경하지 않았다.
- 구조 변이 43개와 Sheet 프로덕션 빌드, 대표 화면 320/390/1440px·라이트/다크 6개, Sheet 전체 Chrome 52개가 통과했다. 대표 모바일 다크와 PC 라이트 화면을 직접 확인했다. 외부 Google Sheets나 운영 서버·Docker에는 연결하지 않았으며 다른 앱의 장식 아이콘이나 운영 반영 증거로 확대하지 않는다.

## 129차: Leave 승인 대기 개수 배지 공통화 (2026-09-11)

- 승인 대기와 취소 승인 대기 제목 옆 숫자를 상태 pill과 구분되는 공통 `cw-count-badge`에 연결했다. 서버가 계산하는 두 목록의 개수와 승인 처리·알림 갱신 흐름은 변경하지 않았다.
- Leave의 `.section-count`는 제목과의 배치 여백만 소유하고, 크기·정렬·색·타이포그래피·라이트/다크 처리는 공통 primitive가 소유한다. 구조 검사는 두 실제 Razor 소비 위치, 함께 로드되는 `site.css`/`approval-forms.css`와 공통 원본을 대조해 전용 skin 재도입을 거부한다.
- 구조 변이 43개, 새 페이지 생성 격리 검사 1개, 실제 격리 Razor·서버 통합 196개, 승인 전체 Chrome 24개가 통과했다. 320/1440px·라이트/다크에서 class와 계산 색을 확인했고 모바일 다크·PC 라이트 화면도 직접 검사했다. 운영 신청·DB·Docker에는 연결하지 않았으며 다른 숫자·알림 배지나 전 서비스 운영 반영 증거로 확대하지 않는다.

## 128차: Leave 상태 pill 잔여 스타일 정리 (2026-09-11)

- 실제 Razor 소비자가 더는 사용하지 않는 `.status-pill` 전용 규칙과 감사 작업 배지에 남아 있던 색·테두리 규칙을 제거했다. 공통 primitive의 높은 선택자 우선순위로 화면상 가려졌던 이중 소유권도 함께 없앴다.
- 모바일 미리보기의 승인·사용 완료 표시를 실제 화면과 같은 success/neutral `cw-state-pill`로 바꿨다. 구조 검사는 감사 화면이 로드하는 `audit-logs.css`와 `site.css`를 함께 검사하고, 미리보기에 오래된 상태 skin이 다시 들어오는 것도 거부한다. 생성기 격리 fixture에도 새 검사 입력을 복사한다.
- 구조 변이 42개, 감사·자기 신청 집중 Chrome 8개와 두 흐름의 전체 Chrome 48개, 최종 루트 검사 299개가 모두 통과했다. 이 단계는 CSS 소유권과 개발 미리보기 정합성만 다루며 운영 데이터·Docker·전 서비스 화면의 완료 증거로 확대하지 않는다.

## 127차: Leave 사용 완료 상태 pill 공통화 (2026-09-11)

- 직원의 내 신청 내역에서 과거 사용일을 가진 승인 건의 `사용 완료` 보조 상태를 neutral `cw-state-pill`로 표시한다. 승인 상태 pill과 한 줄 배치는 유지하고 서버의 승인/날짜 판정·취소 가능 정책·신청 처리 흐름은 변경하지 않았다.
- `.request-complete-label`의 별도 배경·테두리·padding·글자 크기/굵기를 제거했다. 구조 검사는 공통 class/tone과 neutral primitive를 요구하고 전용 skin 재도입을 거부한다. 격리 Razor에는 과거 승인 건을 추가해 실제 서버 출력도 확인한다.
- 구조 변이 41개와 실제 격리 Razor·서버 통합 196개, 최종 루트 검사 298개가 통과했다. 320/1440px·라이트/다크 집중 Chrome 4개에서 class/tone·계산 색과 문서 폭을 확인했고 자기 신청 전체 Chrome 27개도 실패 없이 통과했다. 모바일 다크 카드와 PC 라이트 표의 실제 화면을 직접 확인했다. 운영 계정/연차 DB·Docker에는 연결하지 않았으며 다른 상태나 전 서비스 회귀·운영 반영 증거로 확대하지 않는다.

## 126차: Leave 가불 상태 pill 공통화 (2026-09-11)

- 관리자 승인 대기열·최근 신청 내역, 직원의 내 신청 내역과 달력 날짜 상세에서 가불 종류/일수를 warning `cw-state-pill`로 표시한다. 서버의 `IsAdvance`·월차/연차 가불 계산과 문구, 승인·반려·취소·강제 삭제 및 달력 상세 생성 흐름은 변경하지 않았다.
- Leave 전용 `.advance-badge`의 색·테두리·padding·글자 크기·다크 보정을 제거하고 행 안 여백만 남겼다. 구조 검사는 네 Razor 소비 경로와 공통 warning primitive를 요구하며 전용 skin 재도입을 거부한다. 승인 테스트의 격리 Razor에는 실제 가불 신청을 포함해 서버 출력도 확인한다.
- 구조 변이 40개와 실제 격리 Razor·서버 통합 196개, 최종 루트 검사 297개가 통과했다. 320/1440px·라이트/다크 집중 Chrome 4개에서 class/tone·계산 색, 모바일 카드/PC 표와 문서 폭을 확인했고 승인 전체 Chrome 24개도 실패 없이 통과했다. 모바일 다크와 PC 라이트의 실제 승인 확인 화면을 직접 확인했다. 운영 계정/연차 DB·Docker에는 연결하지 않았으며 다른 Leave 상태나 전 서비스 회귀·운영 반영 증거로 확대하지 않는다.

## 125차: Leave 감사 작업 종류 pill 공통화 (2026-09-11)

- 관리자 감사 로그의 작업 종류를 info `cw-state-pill`에 연결하고 기존 `status-pill`/전용 `audit-action-pill` 팔레트를 제거했다. 감사 작업 라벨 판정, 관리자 GET·검색/페이지·상세 원문과 큰 정수 보존은 변경하지 않았다.
- 구조 검사는 공통 class/tone과 info primitive를 요구하고 감사 전용 배지 색·크기 재도입을 거부한다. 구조 변이 39개와 실제 격리 Razor·서버 통합 196개, 최종 루트 검사 296개가 통과했다. 320/1440px·라이트/다크 집중 Chrome 4개에서 계산 색, 모바일 카드/PC 표, 단일 상세 펼치기와 문서 폭을 확인했고 감사 전체 Chrome 21개도 실패 없이 통과했다. 모바일 다크와 PC 라이트 상세 화면을 직접 확인했다.
- 실제 운영 감사 DB를 읽거나 쓰지 않았고 합성 로그/프로필만 사용했다. 다른 Leave 화면이나 전 서비스 회귀·운영 반영 증거로 확대하지 않는다.

## 124차: Portal 회사 홈 서비스 상태 pill 공통화 (2026-09-11)

- 회사 홈의 허용 서비스 카드 `사용 가능`을 success, 관리자 카드 `관리자`를 warning `cw-state-pill`에 연결했다. 서버가 계산하는 허용 시스템 목록·관리자 역할, 서비스 진입 링크와 카드 본문은 변경하지 않았다.
- 홈 전용 `.system-status` padding·글자 크기·라이트/다크 팔레트 및 장식 점을 제거했다. 구조 검사는 두 의미 tone과 공통 primitive를 요구하고 전용 skin 재도입을 거부한다. 공통 UI 지침과 primitive 표에도 읽기 전용 상태·분류의 소유권을 명시했다.
- 구조 변이 38개와 실제 격리 Razor·서버 통합 196개, 최종 루트 검사 295개가 통과했다. 320/390/1440px·라이트/다크의 회사 홈 집중 Chrome 6개에서 실제 계산 색, 카드 배치와 문서 폭을 확인했고 최종 Portal Chrome 전체 122개도 실패 없이 통과했다. 첫 집중 명령은 PowerShell 정규식 인자 때문에 테스트를 찾지 못했고 단순 이름 필터로 다시 실행해 6개를 모두 통과했다. 제품 실패로 기록하지 않는다. 운영 서비스·계정·DB·Docker에는 연결하지 않았으며 전 서비스 회귀나 운영 반영 증거로 확대하지 않는다.

## 123차: Portal 활성·비활성 상태 pill 공통화 (2026-09-11)

- 직원 권한표의 읽기 전용 활성 상태를 success, 비활성 상태를 neutral `cw-state-pill`에 연결했다. 서버의 `IsActive` 판정, 마스터·비공개 직원의 업무 명단 제외 문구와 편집 가능한 상태 select·일괄 저장은 변경하지 않았다.
- Portal 전용 `.status` 크기·배경·글자색과 별도 다크 보정 및 장식 점을 제거했다. 구조 검사는 success/neutral 동적 tone과 공통 primitive를 요구하고 `.status` 전용 색·크기 재도입을 거부한다. 122차에서 전환한 계정 유형·기본/전체·연차 제외 결과와 동일한 공통 소유권을 사용한다.
- 구조 변이 37개와 실제 격리 Razor·서버 통합 196개, 최종 루트 검사 294개가 통과했다. 관리자/마스터·320/1440px·라이트/다크 집중 Chrome 8개에서 관리자에게만 보이는 읽기 전용 활성 pill의 class/tone·계산 색과 기존 편집 흐름을 확인했다. 최종 Portal Chrome 전체 122개도 실패 없이 통과했다. 데스크톱 라이트·다크 viewport에서 네 종류의 결과 배지 정렬과 대비를 직접 확인했고 모바일은 기존 요약 카드 정책을 유지했다. 운영 계정/DB·Docker에는 연결하지 않았으며 전 서비스 회귀나 운영 반영 증거로 확대하지 않는다.

## 122차: Portal 읽기 전용 계정·권한 상태 pill 공통화 (2026-09-11)

- 직원 권한표에서 수정할 수 없는 마스터 행의 직원 유형과 기본/전체 권한을 info `cw-state-pill`에 연결했다. 편집 행을 공용 계정으로 바꿀 때 나타나는 연차 제외 결과는 neutral tone을 사용한다. 기존 역할/권한 판정, 공용 계정 전환과 일괄 저장·되돌리기 의미는 변경하지 않았다.
- Portal의 `account-type-badge`/`permission-result` 전용 padding·글자 크기·라이트/다크 팔레트를 제거했다. 공통 pill의 display 우선순위가 공용 계정 제외 표시를 항상 노출하지 않도록 표 범위의 숨김/표시 선택자를 명시했다. 구조 검사는 네 공통 marker와 info/neutral primitive를 요구하고 전용 skin 재도입을 거부한다.
- 실제 격리 Razor·서버 통합 196개와 구조 변이 37개, 최종 루트 검사 294개가 통과했다. 관리자/마스터·320/1440px·라이트/다크 집중 Chrome 8개에서 읽기 전용 결과의 계산 색과 공용/직원 전환에 따른 제외 pill 표시·숨김을 확인했다. 첫 집중 실행에서 마스터 화면에도 관리자와 같은 읽기 전용 행이 있다고 잘못 가정한 4개가 실패했으며, 실제 서버 역할 차이에 맞춰 읽기 전용 단언만 관리자 범위로 한정했다. 제품 권한을 테스트에 맞춰 바꾸지 않았다.
- 최종 Portal Chrome 전체 122개가 실패 없이 통과했다. 모바일 다크와 데스크톱 라이트의 실제 계정 편집 화면에서 입력·카드·고정 저장 바 대비와 문서 폭을 확인했다. 운영 계정/DB·Docker에는 연결하지 않았고, 이번 단계는 Portal 내부 UI 전환이지 전 서비스 브라우저 회귀나 운영 반영 증거가 아니다.

## 121차: Schedule 예시·오늘 상태 pill 공통화 (2026-09-11)

- 팀 일정의 예시 데이터는 warning, 오늘 문구는 info `cw-state-pill`에 연결했다. 앱은 문구와 반응형 노출 정책만 유지하고 크기·배경·글자색·모서리와 라이트/다크 의미 색은 공통 primitive가 소유한다. 오늘 열의 기존 테두리 및 주말·공휴일 의미 색과 일정 데이터/API는 변경하지 않았다.
- `style.css`·`timeline.css`·`theme.css`의 전용 demo/today 크기·팔레트·다크 보정을 제거했다. 모바일의 기존 demo 숨김은 공통 pill 선택자보다 높은 레이아웃 선택자로 보강했고, 데스크톱 밀집 보드에서 중복 오늘 문구를 숨기는 기존 정책은 유지했다. 구조 검사는 공통 class/tone과 warning/info primitive를 요구하며 전용 skin 재도입을 거부한다.
- 첫 실제 브라우저 검사는 공통 `display:inline-flex`가 모바일의 약한 demo 숨김을 이기는 문제와, 데스크톱 오늘 문구가 의도적으로 숨겨진 기존 동작을 드러냈다. 숨김 선택자를 보강하고 테스트를 실제 정책에 맞춘 뒤 320/1440px·라이트/다크 집중 4개와 Schedule 전체 193개가 통과했다. 일정 단위 169개·배포 빌드, 구조 변이 36개와 최종 루트 검사 293개도 통과했다. 320px 다크와 1440px 라이트 화면에서 pill·오늘 열·주말/공휴일·문서 폭을 직접 확인했다. 운영 반영은 이 단계 범위가 아니다.

## 120차: Statistics 집계 상태 pill 공통화 (2026-09-11)

- 통계 상단의 데모·확인 중·집계 중·완료·오류를 `cw-state-pill`의 warning/neutral/info/success/danger tone으로 연결했다. 상태 판정과 문구·최소 폭은 통계 앱이 유지하고 크기와 라이트/다크 색상은 공통 primitive가 소유한다.
- Statistics 전용 `source-badge.live` 및 라이트/다크 팔레트를 제거했다. 구조 검사는 공통 초기 class/tone, 런타임 다섯 tone 매핑과 전용 live·색·크기 skin의 재도입을 거부한다. 집계·갱신 API와 worker 수명주기는 변경하지 않았다.
- 구조 변이 35개, 통계 앱 단위 70개, 통계 Chrome 46개와 최종 루트 검사 292개가 통과했다. 첫 브라우저 실행에서는 한 줄로 압축된 전용 CSS 규칙을 제거하며 같은 줄의 기본 CSS까지 작업 트리에서 함께 빠진 편집 오류가 모바일 32px 넘침으로 드러났고, HEAD의 기본 CSS를 복원한 뒤 해당 두 규칙만 제거했다. 색 토큰 검사는 CSS 원문(hex)과 계산값(rgb)을 직접 비교한 오류를 실제 계산값끼리 비교하도록 고쳤다. 320/390px 집중 4개와 전체 46개가 통과했으며, 320px 다크와 1440px 라이트·다크 화면에서 상태 pill·가로 폭·본문 대비를 직접 확인했다. 운영 반영은 이 단계 범위가 아니다.

## 119차: Sheet 연결 상태 pill 공통화 (2026-09-11)

- 시트 상단의 Google 연결됨/데모 모드를 `cw-state-pill`의 success/warning tone으로 연결했다. 연결 문구와 모바일 숨김은 앱이 유지하고 점·크기·간격·라이트/다크 색은 공통 primitive가 소유한다.
- Sheet 전용 `connection-badge.google/demo` 팔레트와 공통 셸의 서비스별 다크 보정을 제거했다. 구조 검사는 공통 class/tone, 두 문구와 전용 mode·점·크기·색 skin의 재도입을 거부한다. 서버 설정·인증·Google API·쓰기 허용 수명주기는 변경하지 않았다.
- 구조 변이 34개, 시트 단위 39개·타입 검사·배포 빌드·격리 런타임 2개와 실제 Razor·서버 통합 196개가 통과했다. 기존 React navigation 단위 검사가 비동기 `navigate()`를 동기 렌더/동기 예외로 취급하던 문제도 `act`와 Promise 결과를 정확히 기다리도록 고쳐 경고·후속 테스트 간섭을 제거했다. 첫 시트 Chrome 52개 중 모바일 마이그레이션 4개는 새로 추가된 숨김 상단 pill을 기존 표 좌표 검사가 먼저 선택해 실패했으며, 표 내부 pill로 대상을 한정한 뒤 집중 4개와 최종 시트 전체 52개가 통과했다. 나머지 다섯 서비스 교차 셸 519개와 최종 루트 검사 291개도 모두 통과했다. 1440px 라이트·다크 대표 화면에서 연결 pill과 본문 대비를 직접 확인했다. 운영 반영은 이 단계 범위가 아니다.

## 118차: CS 업무 상태 pill 공통화 (2026-09-11)

- Steam 환경·거래·ID 검증, 플레이어 환경, 로그 환경·검색 작업, 상품 환경·미리보기의 초기 마크업과 동적 갱신을 `cw-state-pill`/`data-tone`으로 통일했다. 초기 설정 확인은 neutral, 실제 결과는 기존 업무 판정에 따른 success/warning/danger를 유지한다.
- CS 전용 `.badge`/`badge-*` 크기·점·라이트/다크 팔레트를 제거했다. 구조 검사는 여덟 정적 상태의 공통 초기값, 네 업무 모듈의 동적 tone 갱신과 구형 class/CSS 재도입을 거부한다. 설정·거래·검색 job·상품 명령 API와 쓰기 수명주기는 변경하지 않았다.
- 구조 변이 33개와 실제 Razor·서버 통합 196개가 통과했다. 네 CS 업무의 Chrome 153개 중 상품 fixture의 두 환경이 모두 Mock인데 운영 write tone을 기대하도록 새 단언을 잘못 작성해 8개가 실패했고, 제품 코드를 바꾸지 않고 Mock=warning 의미로 바로잡았다. 상품 전체 23개와 최종 CS 전체 153개, 최종 루트 검사 290개가 모두 통과했다. 320px 다크·1440px 라이트 대표 화면에서 pill 대비와 문서 폭도 직접 확인했다. 운영 반영은 이 단계 범위가 아니다.

## 117차: Portal compact 권한 switch 공통화 (2026-09-11)

- 기존 직원 권한표의 수정 가능한 시스템 권한과 고정 연차 기본 접근을 `cw-switch-control`/`cw-switch`/`cw-switch-track`에 연결했다. native checkbox·권한 field name/value, 관리자 전체 상속, 허용/차단 문구 갱신과 dirty/reset/save 의미는 변경하지 않았다.
- 공통 계층이 34×20px track, 최소 42px 클릭 영역, off/accent/success 색과 focus·reduced-motion을 소유한다. Portal CSS에서는 track/knob/색/포커스의 라이트·다크 복제를 제거하고 표의 최소 열 폭과 문구만 유지했다. 구조/계정/조직 집중 단위 37개와 실제 격리 Razor·서버 통합 196개, `dotnet test` 빌드가 통과했다.
- 관리자/마스터·320/1440px·라이트/다크 집중 Chrome 8개에서 키보드 전환, 계산 색, 실제 크기와 기존 dirty/reset 흐름을 확인했다. 모바일 다크와 데스크톱 다크 화면에서 비활성·활성·기본 접근 상태를 직접 확인했다. 전 서비스 Chrome 1,202개 중 1,201개가 첫 실행에서 통과했고, Schedule 재조회 카드가 5초 안에 나타나지 않은 PC 다크 1개만 실패했다. 같은 조합을 단독 재실행해 통과한 뒤 Schedule 전체 189개를 다시 실행해 모두 통과했다. 제품 코드를 타이밍에 맞춰 완화하지 않았다. 새 공통 knob 토큰을 포함하도록 라이트/다크 테마 불변식도 21개로 갱신했고 최종 루트 검사 289개가 모두 통과했다. 운영 반영은 이 단계 범위가 아니다.

## 116차: Portal 계정·조직 checkbox 공통화 (2026-09-11)

- 신규/기존 계정의 비공개 설정과 펼친 권한 카드를 `cw-check-control`/`cw-checkbox`에 연결했다. 조직 프로젝트의 비공개·보관도 같은 primitive를 사용하며 직원·프로젝트 복수 선택 fieldset은 `cw-choice-group`으로 고정했다. 기존 hidden false fallback, 필드 이름, 권한 저장·충돌 비교와 compact 권한 switch 의미는 변경하지 않았다.
- Portal CSS에서 checkbox 크기·accent·focus, 권한 카드 배경/테두리/선택 skin과 조직 선택 목록의 중복 테마를 제거했다. 구조 검사는 공통 class 누락과 앱별 skin 재도입을 거부한다. 구조/계정/조직 집중 단위 37개, 실제 격리 Razor·서버 통합 196개와 `dotnet test` 빌드가 통과했다.
- 계정 집중 Chrome 8개, 조직 집중 8개 및 최종 Portal 122개·조직 22개 전체 회귀가 통과했다. 첫 조직 집중 실행의 8개 실패는 Razor checkbox와 hidden false가 같은 name을 쓰는 기존 정상 구조를 단일 locator로 잡은 테스트 문제였으며, checkbox type으로 대상을 한정한 뒤 제품 의미 변경 없이 모두 통과했다. 모바일 다크 계정/조직과 데스크톱 라이트 기존 계정 화면을 직접 확인했고 최종 루트 검사 289개도 통과했다. compact 권한 switch, 전 서비스 브라우저 회귀와 운영 반영은 이 단계 범위가 아니다.

## 115차: 개인 TODO 완료 checkbox 공통화 (2026-09-11)

- 개인 TODO 각 행의 완료/되돌리기 입력을 `cw-check-control`/`cw-checkbox`에 연결했다. 완료 API와 응답 확인, 72시간 보관, 편집/충돌/계정 범위 및 드래그 순서는 변경하지 않았다.
- 앱 전용 19px 크기·accent·focus 스타일을 제거하고 공통 18px 입력과 최소 42px 클릭 영역, 선택·focus·disabled 테마를 사용한다. 모바일 작업 버튼의 들여쓰기는 새 클릭 영역 폭에 맞춰 조정했다. 구조 변이 31개, 일정 단위 169개·배포 빌드와 집중 Chrome 4개가 통과했다. 320/1440px·라이트/다크의 미선택/선택 캡처를 직접 확인했다.
- 일정 브라우저 전체 189개와 최종 루트 검사 288개도 실패 없이 통과했다(`artifacts/browser-schedule-todo-checkbox-regression`, 2.1분). 전 서비스 브라우저 회귀와 운영 반영은 이 단계 범위가 아니다.

## 114차: 팀 일정 보드 설정 checkbox 공통화 (2026-09-11)

- 주간/칸반의 `주말 표시`·`선택한 주만`과 보기 설정의 `목표 일정`·`실현 일정`·`상세 보기`를 `cw-check-control`/`cw-checkbox`에 연결했다. 기존 query·날짜 열 계산과 세 switch 의미, 날짜 기준·상세 밀도·행 높이 선호, 공통 disclosure 및 다른 페이지 왕복 상태는 변경하지 않았다.
- `style.css`/`overview.css`/`timeline.css`의 label display·gap·글자색·cursor·16px 입력 크기/accent 중복 소유를 제거하고 일정 앱에는 compact 글자 크기와 줄바꿈 기하만 남겼다. 구조 변이 31개, 일정 단위 169개·배포 빌드와 집중 Chrome 4개가 통과했다. 320/1440px·라이트/다크의 보기 설정과 주간/칸반 선택 캡처에서 18px 입력·선택 대비·줄바꿈·문서 폭을 직접 확인했다.
- 첫 일정 전체 실행은 189개 중 183개가 통과하고 6개가 실패했다. 두 미확정 저장 검사는 현재 공통 초안 닫기 확인창을 예전 native dialog로 취급했고, 네 충돌 비교 검사는 열린 비교창이 라우팅을 차단하는 현재 계약과 반대로 즉시 이동을 기대했다. 제품의 초안 보호를 약화하지 않고 공통 확인 승인 및 비교창 종료 후 이동을 명시하도록 보정해 여섯 집중 검사를 통과시킨 뒤 최종 전체 189개를 실패 없이 통과했다(`artifacts/browser-schedule-checkbox-final`, 2.1분). 최종 루트 검사 288개도 통과했다. 개인 TODO 완료 checkbox, 전 서비스 브라우저 회귀와 운영 반영은 이 단계 범위가 아니다.

## 113차: 통계 필터 checkbox 공통화 (2026-09-11)

- 진행도 `afterFirstMiddleBoss`, 완성 조합 `combinationNodes`, 보스 연계 `bossLinked`를 `cw-check-control`/`cw-checkbox`에 연결했다. 기존 필터 값·조회와 완성 조합에서만 보이는 hidden 의미는 유지하고 앱의 `check-label`에는 정렬과 조건부 숨김만 남겼다.
- 모바일 필터바의 전체 입력 폭 보정이 공통 checkbox를 덮어 13px로 축소하거나 116px로 늘리던 실제 충돌을 재현했다. 일반 입력 selector에서 checkbox를 제외하고 레거시 checkbox 보정도 공통 class를 제외해 18px 공통 크기를 복구했다.
- 구조 변이 30개, 통계 앱 전체 69개와 통계 Chrome 회귀 46개가 통과했다. 320/1440px·라이트/다크의 세 선택 상태 캡처에서 크기·선택 배경·조건부 노출과 문서 폭을 직접 확인했다. 최종 루트 검사는 287개를 대상으로 한다. 공통 CSS 변경의 전 서비스 브라우저 회귀와 운영 반영은 이 단계 범위가 아니다.

## 112차: CS 로그 장기 검색 checkbox 공통화 (2026-09-11)

- 24시간을 넘는 로그 검색의 실행 확인을 `cw-check-control`/`cw-checkbox`에 연결하고 전용 경고 배경·테두리·글자색과 17px 입력 skin을 제거했다. 제목·설명 크기와 줄바꿈만 로그 화면에 남겼다.
- 장기 검색 판정·미확인 실행 차단과 요청의 `confirmLongRange` 값은 유지했다. 구조 변이 29개, 로그 검색 전체 Chrome 회귀 20개와 최종 루트 검사 286개가 통과했고 모바일 다크·데스크톱 라이트의 선택/미선택 캡처에서 안내 대비와 문서 폭을 직접 확인했다. 전 서비스 브라우저 회귀와 운영 반영은 이 단계 범위가 아니다.

## 111차: CS 상품 명령 checkbox 공통화 (2026-09-11)

- 상품 명령의 Dry Run과 기존 명령 병합 승인을 `cw-check-control`/`cw-checkbox`에 연결하고 구형 CS 공통 `.confirm-check` 테마·17px 입력 skin을 제거했다. 상품/플레이어 화면에는 긴 문구 정렬과 간격만 남겼다.
- 기존 Dry Run 실행 값·읽기 전용 강제/disabled, 병합 미리보기와 스냅샷·DataVersion 변경 시 승인 무효화는 유지했다. 구조 변이 29개, 상품 명령 전체 Chrome 회귀 23개, 플레이어 확인란 교차 회귀 8개와 최종 루트 검사 286개가 통과했다. 모바일 다크·데스크톱 라이트의 선택/미선택과 긴 병합 승인 캡처를 직접 확인했다. 전 서비스 브라우저 회귀와 운영 반영은 이 단계 범위가 아니다.

## 110차: CS 플레이어 변경 확인 checkbox 공통화 (2026-09-11)

- 플레이어 데이터 저장·키 추가·영구 삭제의 세 확인을 `cw-check-control`/`cw-checkbox`에 연결했다. 기존 checked 기반 버튼 활성화, 요청의 `confirmed`, 초안·대상·토큰·계정 범위와 저장 응답 검증은 변경하지 않았다.
- 플레이어 전용 CSS에서는 긴 문구 줄바꿈과 배치만 유지하고 배경·테두리·색·accent 중복 소유를 제거했다. `checkPlayerMutations`는 세 공통 템플릿·공통 CSS와 전용 skin 재도입을 변이 검사한다. 구조 변이 29개, CS 플레이어 데이터 전체 Chrome 회귀 59개와 최종 루트 검사 286개가 통과했다. 모바일 다크·데스크톱 라이트 캡처에서 선택/미선택 상태, 긴 확인 문구 줄바꿈과 문서 폭을 직접 확인했다. 전 서비스 브라우저 회귀와 운영 반영은 이 단계 범위가 아니다.

## 109차: Discord 개인 알림 checkbox 공통화 (2026-09-11)

- 개인 DM 활성화와 역할별 수신 유형 템플릿을 `cw-check-control`/`cw-checkbox`에 연결했다. 기존 `discordDmEnabled` hidden false fallback, `selectedTypes` 다중 값, 미연동 disabled와 Save/Unlink/Test/OAuth·초안/응답 검증은 유지한다.
- 앱 CSS에서는 옵션 제목·설명과 반응형 grid만 유지하고 선택·hover·focus·disabled 색과 checkbox 크기/accent의 중복 소유를 제거했다. `checkLeaveDiscord`는 공통 markup/CSS와 앱별 skin 재도입을 변이 검사한다. 구조/Discord 집중 단위 31개, 격리 Razor·서버 196개와 Discord 전체 Chrome 회귀 21개가 통과했다. 모바일 다크·데스크톱 라이트의 전용 checkbox 캡처에서 1열/2열, 선택/비선택 상태, 줄바꿈과 문서 폭을 직접 확인했고 최종 루트 검사 286개도 통과했다. 운영 Discord/DB, 전 서비스 브라우저 회귀와 운영 반영은 이 단계 범위가 아니다.

## 108차: 공휴일 덮어쓰기 checkbox 공통화 (2026-09-11)

- 온라인/JSON 공휴일 가져오기의 `Import.OverwriteExisting` 두 컨트롤을 `cw-check-control`/`cw-checkbox`에 연결하고 `.holiday-overwrite-check`의 개별 글자·배치 skin을 제거했다. 동일한 POST 이름, 고유 DOM ID와 두 양식의 독립 체크 의미는 유지한다.
- `checkHolidayProtocol`은 공통 markup/CSS와 앱별 skin 재도입을 변이 검사한다. 구조 단위 28개, 격리 Razor·서버 196개, 공휴일 UI 4개와 가져오기 요청 회귀 5개가 통과했고 모바일 다크·데스크톱 라이트 캡처에서 두 선택 상태와 가로 넘침이 없음을 직접 확인했다. 최종 루트 검사 285개도 통과했다. Discord 수신 유형 등 다른 checkbox, 전 서비스 브라우저 회귀와 운영 반영은 이 단계 범위가 아니다.

## 107차: Leave 달력 선호의 공통 checkbox 전환 (2026-09-11)

- 관리자 `SelfOnly`와 직원 `ShowOthers`의 월간·연간 네 checkbox를 `cw-check-control`/`cw-checkbox`에 연결했다. 공통 CSS가 라이트·다크 배경, 선택·hover·focus·disabled 상태와 실제 18px 입력 크기를 소유한다. Leave의 중복 일반/다크 skin은 제거하고 도구막대·모바일 열 배치는 앱 책임으로 남겼다.
- 기존 `SaveCalendarPreference=true`, 역할별 name/value, 같은 이름의 hidden `false`, 관리자 미리보기 비노출과 변경 시 전체 GET 저장은 변경하지 않았다. 구조 변이 검사는 공통 class와 shared CSS 상태 선택자가 빠지면 실패하도록 확대했다.
- 구조/primitive 집중 단위 18개와 격리 Razor·서버 196개가 통과했다. 첫 Chrome 실행은 모바일 앱 CSS가 checkbox에도 `width:100%!important`를 적용해 실제 83px가 된 것을 잡아 2개 모두 실패했다. 해당 selector에서 checkbox를 제외한 뒤 선택 상태 계산 색을 포함한 관리자·직원 모바일 다크 2개가 모두 통과했다(`artifacts/browser-leave-calendar-checkbox-final`, 3.0초). 두 캡처에서 공통 테마와 문서 가로 폭을 직접 확인했다. 최종 루트 구조·생성·CI 정책·단위 285개도 모두 통과했다. 모든 checkbox/radio 소비자 이관이나 전체 서비스 회귀·운영 배포 완료로 확대하지 않는다.

## 106차: 공통 UI 부채 0 상태 봉인 (2026-09-11)

- `ui-primitive-debt.json`을 `sealed: true`로 봉인했다. 실제 저장소 검사는 봉인 해제를 거부하고, 봉인된 목록에 파일 정책·규칙·서명·개수 예외가 하나라도 복원되면 위반으로 처리한다.
- 과거 부채 감소 알고리즘의 단위 검증은 `sealed: false` 합성 목록으로 유지하되 실제 저장소와 새 페이지 생성기의 복제 환경은 반드시 봉인 상태여야 한다. 감소 명령도 봉인이 해제된 목록을 수정하지 않고 즉시 실패한다.
- 집중 단위/생성기 14개에서 새 native 버튼, 봉인 해제, 유효한 모양의 예외 복원을 각각 거부하고 정상 봉인 상태를 통과시켰다. 루트 `npm run check`도 285개 전체 단위와 137개 앱 소스의 부채 0을 확인했다.
- 이 봉인은 새 예외를 추가해 AI·개발자가 검사를 우회하는 경로를 막는다. 정적 검사가 다루지 않는 UI와 실제 화면의 전 서비스 회귀·운영 반영은 별도 완료 조건이다.

## 105차: Leave 월간 선택 달력의 공통 표 계약 (2026-09-11)

- Leave 월간 선택 달력을 `cw-calendar-table`의 `month` 레이아웃에 연결했다. 연도·월·용도의 접근 가능한 이름, 요일 `scope="col"`, 실제 날짜/표시용 날짜 메타데이터와 공통 상세 버튼을 계약으로 고정했다.
- 기존 셀 클릭·연차 범위 선택·공휴일/주말·상태·상세 모달 로직은 재작성하지 않았다. 공통 CSS는 전체 폭·고정 7열·기본 글자색을 소유하고, 월간 달력의 별도 테두리·셀 높이·모바일 표시 규칙은 서비스에 남겼다.
- 구조 단위 13개, 실제 Razor fixture/서버 196개, 320/1440px·라이트/다크의 구조·프로필·상세 8개와 모바일 다크 시각 재확인 1개가 통과했다. 모바일 캡처에서 요일/날짜 격자, 주말·현재일·이벤트와 문서 폭을 직접 확인했다.
- 감소 전용 prune으로 마지막 기록 부채를 제거해 `ui-primitive-debt.json`은 0회/0개 서명이다. 이는 검사에 등록된 native primitive 이관 완료이며, 검사 밖 UI 조사·여섯 서비스 전체 브라우저 회귀·운영 반영 완료를 뜻하지 않는다.

## 104차: Leave 연간 미니 달력의 공통 표 계약 (2026-09-11)

- Leave 연간 보기의 12개 미니 달력을 별도 `cw-calendar-table` 계약에 연결했다. 일반 업무 표의 모바일 카드 변형은 적용하지 않고 날짜 격자를 유지하며, 공통 원본이 폭·고정 열 배치·테두리 병합·기본 글자색을 소유한다.
- 각 달력에 연도·월·용도를 포함한 접근 가능한 이름과 요일 `scope="col"`을 추가했다. 구조 검사는 허용된 연간 레이아웃, native table 역할, 이름, 모든 열 범위와 표 중첩 금지를 확인하므로 클래스만 붙인 우회는 실패한다.
- 구조 단위 13개, 실제 Razor fixture/서버 196개와 320/1440px·라이트/다크 Chromium 4개가 통과했다. 모바일 다크 캡처에서 날짜 격자, 주말 색, 현재일, 직원 사진과 문서 폭을 직접 확인했다.
- 감소 전용 prune으로 연간 표 부채 1회를 제거해 월간 선택 달력 1회/1개 서명만 남았다. 여섯 서비스 전체 브라우저 회귀와 운영 반영은 이 단위의 증거가 아니다.

## 103차: Leave 달력 선호 폼의 서버 렌더링 소유권 (2026-09-11)

- Leave 공통 레이아웃이 `SaveCalendarPreference` hidden input과 역할별 fallback/toggle을 생성하던 코드를 제거했다. `calendarMoveForm`이 관리자 `SelfOnly` 또는 일반 직원 `ShowOthers`, 같은 이름의 `false` fallback과 저장 표식을 Razor에서 완전하게 렌더링하며 레이아웃은 변경 이벤트만 연결한다.
- 레이아웃의 중복 직원 선호 DB 조회도 제거했다. 기존 전체 페이지 GET, 캘린더 부분 갱신보다 우선하는 change 처리와 서버의 역할별 선호 저장 분기는 유지한다.
- 구조/primitive 집중 15개, 실제 Razor fixture/서버 196개와 320px 다크 Chromium의 관리자·직원 정확한 GET 2개가 통과했다. 첫 브라우저 실행은 form 내부 grid 여유 폭을 문서 overflow로 잘못 판정해 실패했으며, 실제 완료 기준인 document 폭으로 정정한 최종 실행만 통과 근거로 삼는다.
- 감소 전용 prune으로 Leave 동적 input 부채 1회를 제거해 잔여는 달력 표 2회/2개 서명이다. 여섯 서비스 전체 브라우저 회귀와 운영 반영은 이 단위의 증거가 아니다.

## 102차: 직원 관리의 동적 프로젝트 선택 공통화 (2026-09-11)

- 직원 일괄 수정의 충돌 비교에서 서버에 새로 나타난 프로젝트를 페이지가 직접 checkbox DOM으로 만들던 구현을 제거하고 `CompanyEntityChoices.upsertCheckbox`에 연결했다. 공통 소유자가 정확한 name/value, 프로젝트 ID·아이콘, 표시 문자열과 disabled 상태를 적용하며 기존 선택값은 명시 없이 덮어쓰지 않는다.
- 공통 선택기 단위 11개, 실제 Razor fixture/서버 196개와 320px 다크 Chromium의 충돌 비교·프로젝트 추가·명시적 재저장 경로 1개가 통과했다. 구조 검사는 직원 관리가 공통 선택 소유자를 우회하면 실패한다.
- 감소 전용 prune으로 Portal의 동적 native checkbox 부채 1회를 제거해 잔여는 3회/3개 서명이다. 다른 native 달력/선호 입력, 여섯 서비스 전체 브라우저 회귀와 운영 반영은 이 단위의 증거가 아니다.

## 101차: CS JSON 복사의 공통 클립보드 소유권 (2026-09-11)

- CS 상품 명령의 앱 전용 `navigator.clipboard`/fallback textarea 구현을 제거하고 생성 자산의 `CompanyClipboard.copyText`에 연결했다. 구형 브라우저용 textarea는 공통 원본 한 곳에서만 만들고 성공·실패 뒤 항상 제거한다.
- JSON은 parse/stringify하지 않고 원문 문자열 그대로 복사한다. 최신 Clipboard API가 거부되면 성공으로 오인하거나 fallback으로 자동 재시도하지 않으며, fallback은 기존 포커스·문서 선택을 복원한다.
- 공통 단위 4개, 구조/생성기 29개와 실제 Chromium의 최신 API·fallback·64비트 정수 원문·서버 쓰기 없음 검사가 통과했다. CS 앱이 직접 클립보드 API나 textarea를 복원하면 구조 검사가 실패한다.
- native primitive 잔여는 4회/4개 서명이다. 공통 런타임 변경의 여섯 서비스 전체 브라우저 회귀와 운영 반영은 이 단위의 증거가 아니며 후속 완료 조건으로 남긴다.

## 100차: TODO 페이지 이탈의 공통 초안 확인 (2026-09-11)

- 개인 TODO 페이지의 사이드바·링크 이동과 브라우저 이전·다음을 공통 `useWorkspaceNavigationRequest`/`confirmWorkspaceAction`에 연결했다. 확인창은 새 TODO와 수정 TODO 초안, 원문·버전, 이동 위치·방식을 구분해 표시한다.
- 취소하면 URL과 두 초안을 그대로 유지하고, 승인한 경우에만 실제 라우트를 적용한다. 대기 중 초안·계정·탭 변경과 scope 변경/해제는 이전 승인을 무효화한다. 새로고침·탭 닫기의 `beforeunload`는 유지했다.
- Schedule 빌드, 구조/생성기 검사 29개와 320/1440px·라이트/다크 및 기존 충돌 시나리오 브라우저 5개가 통과했다. 모바일 다크 확인창을 직접 확인했다.
- Schedule의 literal native confirm은 0개가 되었고, 전체 native primitive 잔여는 5회/5개 서명이다. 이 단계를 여섯 서비스 전체 회귀나 운영 반영으로 확대하지 않는다.

## 99차: TODO 목록 탭 전환의 공통 초안 확인 (2026-09-11)

- 개인 TODO 수정 중 할 일·보관함 탭 전환을 browser confirm에서 공통 `confirmWorkspaceAction`으로 전환했다. 수정 초안이 실제 원문과 다를 때만 확인하며 현재 초안·이동할 목록·원래 TODO·버전을 표시한다.
- 확인 취소 시 기존 탭·수정 초안·클릭한 탭 포커스를 유지하고 승인 후에만 편집기를 닫고 목록을 바꾼다. 별도로 작성 중인 새 TODO 입력은 탭 왕복 후에도 유지한다. 초안·계정 범위·현재/대상 탭을 승인 직전 다시 대조하며 scope 변경과 해제는 확인을 중단한다.
- 최신 Schedule 빌드, 루트 구조·CI·단위 279개와 320/1440px·라이트/다크 실제 브라우저 4개가 통과했다(`artifacts/browser-todo-tab-switch`). 모바일 다크에서 확인창의 폭·대비·초안/목록 구분을 직접 확인했다.
- 실제 native confirm 1회만 제거해 잔여는 6회/6개 서명이며, 남은 literal confirm은 `usePersonalTodos.ts`의 페이지 이탈 1회다. 여섯 서비스 전체 회귀나 운영 반영으로 확대하지 않는다.

## 98차: TODO 편집 대상 전환의 실제 연결 (2026-09-11)

- 개인 TODO 편집 중 다른 행의 수정 버튼이 모두 비활성이라 기존 전환 confirm이 사용자에게 도달할 수 없던 문제를 확인했다. 현재 편집 행만 수정 버튼을 잠그고 다른 행의 수정은 허용하되 완료·삭제·순서 변경은 계속 잠근다.
- 다른 TODO 수정 진입을 browser confirm에서 공통 `confirmWorkspaceAction`으로 전환했다. 현재 초안·이동할 TODO·두 버전을 표시하고, 취소하면 초안과 대상 버튼 포커스를 유지하며 승인 후에만 새 편집기로 전환한다. 초안·두 TODO·계정 범위·탭은 승인 직전 다시 대조한다.
- 최신 Schedule 빌드, 루트 구조·CI·단위 279개와 320/1440px·라이트/다크 실제 브라우저 4개가 통과했다(`artifacts/browser-todo-edit-switch`). 모바일 다크에서 실제 전환 확인창의 폭·대비·정보 구분을 직접 확인했다.
- 실제 native confirm 1회만 제거해 잔여는 7회/6개 서명이며, 남은 literal confirm은 `usePersonalTodos.ts`의 페이지 이탈과 목록 탭 전환 2회다. 여섯 서비스 전체 회귀나 운영 반영으로 확대하지 않는다.

## 97차: TODO 편집 취소의 공통 초안 확인 (2026-09-11)

- 개인 TODO 수정 폼의 취소 경로 1곳을 browser confirm에서 공통 `confirmWorkspaceAction`으로 전환했다. 수정 초안·원래 내용·버전을 표시하고, 확인 취소 시 입력과 취소 버튼 포커스를 유지하며 승인 후에만 편집기를 닫는다.
- TODO 대상·초안·계정 범위·목록 탭을 승인 직전 다시 대조한다. scope 변경과 컴포넌트 해제는 대기 중 확인을 중단하며 새 TODO 입력이나 서버 쓰기는 건드리지 않는다. 구조 검사는 이 연결 또는 현재성 검증을 제거하거나 옛 confirm을 복원하면 실패한다.
- 최신 Schedule 빌드, 루트 구조·CI·단위 279개와 320/1440px·라이트/다크 실제 브라우저 4개가 통과했다(`artifacts/browser-todo-edit-cancel`). 모바일 다크에서 확인창의 실제 초안·원문·버전, 폭과 대비를 직접 확인했다.
- 실제 native confirm 1회만 제거해 잔여는 8회/6개 서명이며, 남은 literal confirm은 `usePersonalTodos.ts` 3회다. 다른 TODO 이탈 경로나 여섯 서비스 전체 회귀·운영 반영으로 확대하지 않는다.

## 96차: 업무 창 닫기의 공통 초안 확인 (2026-09-11)

- Schedule 업무 상세 창의 닫기 버튼·Escape·외부 닫기를 마지막 browser confirm에서 공통 `beforeCloseRequest`/`confirmWorkspaceAction`으로 전환했다. 중첩 날짜 창은 먼저 닫히며, 취소하면 업무·댓글 초안과 현재 창을 그대로 유지한다.
- 업무 폼·첨부, 댓글 변경 번호, 업무 ID·버전·권한과 계정 범위를 승인 직전 다시 대조한다. 확인창에는 서버 원문이 아니라 실제 수정 중인 업무명과 프로젝트·초안 종류를 표시한다. 테스트에서 원래 제목이 표시되는 문제를 발견해 수정했다.
- 최신 Schedule 빌드, 루트 구조·CI·단위 279개와 320/1440px·라이트/다크 실제 브라우저 4개가 통과했다(`artifacts/browser-task-close-discard`). 모바일 다크에서 확인창의 배치·대비·실제 초안 표시를 직접 확인했다.
- 실제 native confirm 1회만 제거해 잔여는 9회/6개 서명이다. `TaskPanel.tsx`의 literal confirm은 0회이고 남은 동기 확인은 `usePersonalTodos.ts` 4회다. 여섯 서비스 전체 회귀나 운영 반영으로 확대하지 않는다.

## 95차: 업무 본문 링크 전환의 공통 초안 확인 (2026-09-11)

- Schedule 업무 본문·댓글의 다른 업무 링크를 누를 때 남은 업무/댓글 초안을 버리는 경로 1곳을 browser confirm에서 공통 `confirmWorkspaceAction`으로 전환했다. 링크가 가리키는 업무·댓글 ID와 현재 업무/프로젝트·초안 종류를 표시하며 승인 전 URL과 기존 패널을 유지한다.
- 업무 폼·첨부, 댓글 변경 번호, 업무 ID·버전·권한 및 계정 범위를 승인 직전 다시 대조한다. 확인 취소·scope 변경에는 원문과 현재 URL을 유지하고, 승인 후에는 `openId`의 실제 `Promise<boolean>` 결과를 기다려 이동 실패를 초안 폐기로 오인하지 않는다.
- 최신 Schedule TypeScript/배포 빌드, 루트 구조·CI·단위 279개와 320/1440px·라이트/다크 전환 4개 및 scope 중단 1개가 통과했다(`artifacts/browser-task-reference-discard`). 실제 업무 #202 상세까지 열리는 것, native dialog·쓰기 없음도 검사했고 320px 다크 확인창을 직접 확인했다.
- 실제 native confirm 1회만 제거해 잔여는 10회/7개 서명이며, 남은 literal confirm은 `TaskPanel.tsx`의 업무 창 닫기 1회와 `usePersonalTodos.ts` 4회다. 여섯 서비스 전체 회귀나 운영 반영으로 확대하지 않는다.

## 94차: 업무 history 이탈의 공통 초안 확인 (2026-09-11)

- Schedule 업무 편집·댓글 초안을 둔 채 브라우저 뒤로 이동하는 경로 1곳을 동기 browser confirm에서 공통 `useWorkspaceNavigationRequest`와 `confirmWorkspaceAction`으로 전환했다. 일반 앱 내 이동은 기존 동작을 유지하고 history 이동만 이 확인을 거친다.
- 업무 폼·첨부, 댓글 초안 종류와 변경 번호, 업무 ID·버전·권한·프로젝트 및 계정 범위를 승인 직전 다시 대조한다. 확인 중 컨트롤을 잠그며 취소·scope 변경·늦은 승인은 URL과 기존 초안을 유지한다. 신규 업무 취소에서 이미 승인한 일회성 이동 허가도 유지한다.
- 최신 Schedule TypeScript/배포 빌드, 루트 구조·CI·단위 279개와 320/1440px·라이트/다크 실제 브라우저 4개가 통과했다(`artifacts/browser-task-history-discard`). 취소 후 URL/초안 보존, 승인 후 이동, native dialog 및 쓰기 없음도 검사했다. 320px 다크 확인창의 폭·대비·프로젝트 표시와 잠긴 배경을 직접 확인했다.
- 실제 native confirm 1회만 제거해 잔여는 11회/7개 서명이며, 남은 literal confirm은 `TaskPanel.tsx` 2회와 `usePersonalTodos.ts` 4회다. 업무 창 자체 닫기와 다른 업무 링크 전환은 별도 경로로 남는다.

## 93차: 상위 댓글 초안 전환 공통화 (2026-09-11)

- Schedule 업무 상세에서 새 댓글 또는 답글·댓글 수정 초안을 버리고 업무 수정으로 진입하거나 변경 이력을 여는 두 경로를 브라우저 confirm에서 공통 `confirmWorkspaceAction`으로 전환했다. 자식 편집기의 dirty 알림마다 단조 증가 번호를 기록해 확인 중 내용이 바뀌면 적용하지 않는다.
- 확인은 업무 ID·제목·버전·편집 권한·프로젝트와 계정 범위, 두 댓글 초안 종류와 변경 번호를 승인 직전 다시 대조한다. 확인 중에는 업무 상세 컨트롤을 잠그며 취소·scope 변경·늦은 승인은 기존 댓글 초안을 유지한다. 읽기 권한이 무효해진 상세에서는 전환을 시작하지 않는다.
- 최신 Schedule TypeScript/배포 빌드, 루트 구조·CI·단위 279개와 320/1440px·라이트/다크 실제 브라우저 4개가 통과했다(`artifacts/browser-task-comment-transitions`). 내부 댓글 편집기 전환 회귀, 상위 두 전환의 취소 후 포커스·초안 보존과 승인, 쓰기 없음도 함께 검사했다. 320px 다크 확인창의 폭·대비·프로젝트 아이콘과 배경 잠금을 직접 확인했다.
- 실제 native confirm 2회만 제거해 잔여는 12회/7개 서명이며, 남은 literal confirm은 `TaskPanel.tsx` 3회와 `usePersonalTodos.ts` 4회다. 여섯 서비스 전체 브라우저·운영 배포를 이번 단계에서 실행한 것으로 확대하지 않는다.

## 92차: 업무 편집 취소의 공통 확인 연결 (2026-09-11)

- Schedule 업무 수정·신규 등록 폼의 취소 1곳을 브라우저 confirm에서 공통 `confirmWorkspaceAction`으로 전환했다. 업무 원문·첨부·담당자·프로젝트·계정 범위를 승인 직전 다시 대조하며, 확인 중에는 기존 초안을 잠근다. 취소·scope 변경·늦은 승인은 초안을 유지한다.
- 기존 업무는 승인 후 편집 모드만 종료한다. 신규 업무는 승인된 요청에만 일회성 탐색 허가를 부여하고 `closeTask`의 실제 이동 성공을 기다린다. 다른 탐색 가드가 거부하면 창과 초안을 유지한다. 업무 상세 창 닫기·이력 전환 등 다른 확인 경로는 이번 범위에 포함하지 않았다.
- 최신 Schedule TypeScript/배포 빌드, 루트 구조·CI·단위 279개와 320/1440px·라이트/다크 실제 브라우저 4개가 통과했다(`artifacts/browser-task-edit-cancel`). 확인 취소 후 포커스와 원문 보존, scope 중단, 기존/신규 업무 승인 흐름 및 쓰기 없음도 검사했다. 320px 다크 확인창의 폭·대비·엔티티 표시와 배경 잠금을 직접 확인했다.
- 실제 native confirm 1회만 제거해 잔여는 14회/7개 서명이며, 남은 literal confirm은 `TaskPanel.tsx` 5회와 `usePersonalTodos.ts` 4회다. 여섯 서비스 전체 브라우저·운영 배포를 이번 단계에서 실행한 것으로 확대하지 않는다.

## 91차: 댓글 편집기 초안 전환 공통화 (2026-09-11)

- Schedule 업무 논의에서 댓글 수정 취소, 답글 취소, 작성 중 다른 답글/댓글 수정으로 이동하는 세 경로를 브라우저 confirm에서 공통 `confirmWorkspaceAction`으로 전환했다. 확인 중 원래 편집기와 초안을 유지하며 댓글 원문·대상·초안 변경 횟수·업무 버전·계정 범위를 적용 직전에 다시 대조한다. 취소와 scope 변경은 초안을 보존한다.
- 구조 검사는 `Discussion`에 브라우저 확인이 돌아오거나 공통 확인·변경 횟수·scope 현재성 연결이 빠지면 실패한다. 320/1440px·라이트/다크 실제 브라우저 4개가 수정/답글 취소, 취소 후 포커스·초안 보존, 다른 댓글 이동과 scope 중단을 통과했다(`artifacts/browser-comment-draft-transitions`). 320px 다크 확인창의 폭·대비·버튼 배치를 직접 확인했다.
- 실제 native confirm 3회만 제거해 잔여는 15회/7개 서명이다. 업무 상세 닫기·상위 화면 전환 6회와 TODO 4회는 이번 범위에 포함하지 않았다.

## 90차: 직원 행 높이 range 공통화 (2026-09-11)

- Schedule 보기 설정의 직원 행 높이 슬라이더를 전용 공통 `cw-range`로 전환했다. 공통 CSS가 라이트/다크의 트랙·핸들·포커스·비활성과 현재 값 배치를 소유하고, 앱은 기존 36~100px/4px 단위·행 계산과 `schedule.rowHeight` 저장을 유지한다.
- 정적 primitive 검사에 `native-range`를 추가해 일반 텍스트 필드 클래스로 우회할 수 없게 했다. 320/1440px·라이트/다크의 실제 브라우저 시나리오 4개가 클래스·범위·44px 조작 영역·output 연결·키보드 End·선호 저장·가로 넘침을 확인하며 통과했다(`artifacts/browser-schedule-range-final`). 320px 다크 화면도 직접 확인했다.
- 실제 range 부채 1회만 제거해 잔여는 18회/7개 서명이다. checkbox/switch나 다른 업무 컨트롤은 이번 범위에 포함하지 않았다.

## 89차: 주요 일정 초안 이탈의 공통 확인 연결 (2026-09-11)

- Schedule 일정 관리의 native 초안 확인 2회를 공통 `confirmWorkspaceAction`과 비동기 탐색 요청으로 전환했다. 닫기·Escape·외부 close, 다른 주요 일정/신규 일정/보관함 선택과 메뉴·브라우저 뒤로가기가 같은 초안 소유자를 사용한다. 확인 중에는 기존 편집기를 유지·잠그고 일정 제목·프로젝트·날짜를 보여주며, 계정 범위·초안·탭·대상이 바뀐 늦은 승인은 적용하지 않는다. 브라우저 탭 닫기의 `beforeunload`는 유지했다.
- 최신 Schedule TypeScript/빌드와 320/1440px·라이트/다크 관리 흐름 4개, 뒤로가기 취소/계정 범위 중단/승인 1개가 통과했다(`artifacts/browser-schedule-settings-draft-final`). 모바일 다크 확인창의 폭·대비·프로젝트 아이콘·버튼 배치를 직접 확인했다. 공통 modal/탐색·현재성 대조·로컬 전환 연결을 제거하는 변이는 구조 검사에서 거부한다. 실제 감소분 2회만 prune해 native 부채는 19회/8개 서명, 남은 Schedule 동기 confirm은 업무·댓글 9회와 TODO 4회다.

## 88차: 주요 일정 삭제의 공통 확인 연결 (2026-09-11)

- Schedule 일정 관리의 주요 일정 DELETE 1건을 native confirm에서 공통 `confirmWorkspaceAction`으로 전환했다. 현재 계정의 프로젝트 표시와 일정 제목·버전을 확인창에 보여주며, 확인 중 대상 ID/버전/제목/프로젝트가 바뀌면 실행하지 않는다. 취소 포커스와 기존 CSRF·서버 버전 충돌·목록 갱신은 유지했다.
- 최신 Schedule TypeScript/빌드와 320/1440px·라이트/다크 관리 흐름 4개가 통과했다. 모바일 다크 확인창에서 프로젝트·일정·버전과 위험 버튼을 직접 확인했다(`artifacts/browser-schedule-milestone-delete-final`). 공통 확인·현재성 검증·버전/프로젝트 표시를 제거하는 변이도 구조 검사에서 거부한다. 실제 감소분 1회만 prune해 native 부채는 21회/9개 서명, 남은 Schedule 동기 confirm은 15회다. 다른 초안 이탈/댓글/TODO 확인은 이번 범위에 포함하지 않았다.

## 87차: 시트 관리 모바일 소개 제목 정리 (2026-09-11)

- Sheet 운영 개요의 소개 제목이 320px에서 `확실하`/`게.`로 어색하게 갈라지는 문제를 실제 화면에서 확인했다. 360px 이하에서 카드 가로 여백과 제목 크기·자간만 조정하고 강조 문장을 한 줄로 유지했다. 문구·업무 기능·공통 셸은 변경하지 않았다.
- 제목의 실제 inline rect가 한 줄인지 검사에 추가했다. 최신 Sheet 빌드와 320/390/1440px·라이트/다크 운영 개요 6개가 통과했고, 최종 320px 다크 화면에서 제목과 카드 폭을 직접 확인했다(`artifacts/browser-sheet-mobile-title-final`). 앱 전용 CSS 변경이므로 다른 다섯 앱 전체 회귀를 실행한 것으로 보고하지 않는다.

## 86차: 비동기 편집창 닫기와 일정 전환 (2026-09-11)

- 공통 owned modal에 `beforeCloseRequest`/`requestCloseAsync`를 추가했다. 기존 동기 `canClose`는 유지한다. 비동기 hook은 적용 직전 초안을 재검증하는 함수를 반환해야 하며 단순 true/예외는 거부한다. 확인 중 기존 native 창·초안을 유지하고 중복/직접 동기 우회, scope·abort·해제·분리·다른 최상위 창 뒤의 늦은 승인을 차단한다. React generated 어댑터는 최신 callback과 같은 DOM 소유권을 유지한다.
- Schedule 버전 편집창의 버튼·Escape·외부 native close를 실제 연결했다. 원문/기준 버전/계정·프로젝트를 승인 전후 대조하고 확인 중 입력/저장/중복 닫기를 잠근다. 프로젝트 이름·아이콘은 공통 entity 표시를 소비한다. 닫기 확인 중과 실제 저장 중을 별도로 표시하며 기존 저장/비교/미확정 처리와 beforeunload는 유지한다.
- 공통 dialog 단위 23개, React modal 5개와 버전 편집 hook 17개가 통과했다. 루트 279개도 통과했다(10.7초). 초기 집중 Chrome 26개는 통과했으나 모바일 캡처에서 뒤쪽 저장 진행 표시의 의미 혼동을 발견해 closing 상태를 분리했다. 추가 테스트의 TypeScript Promise 추론 오류로 빌드가 실패한 실행은 중단했고 오래된 번들의 결과를 완료 근거로 사용하지 않았다. 명시적 Promise 타입을 고쳐 일정 빌드를 통과한 뒤 새 실행 26개가 통과했다(`artifacts/browser-release-async-close-final`, 19.7초).
- 수정된 PC 라이트·모바일 다크 확인창 캡처에서 저장 스피너 제거를 확인했다. 이후 프로젝트 entity 연결을 더해 일정 빌드와 React/hook 22개가 다시 통과했다. 이 마지막 변경의 집중 Chrome 26개도 통과했다(`artifacts/browser-release-async-close-entities`, 19.4초). 최종 모바일 다크에서 공통 프로젝트 폴백과 닫기 확인창을 직접 확인했다.
- 공통 React 라우터에 `useWorkspaceNavigationRequest`를 추가했다. 메뉴 이동은 승인 전 URL/화면을 유지하고, 브라우저 뒤로/앞으로는 원래 history 항목으로 복구해 확인한 뒤 승인된 대상 항목을 재생한다. scope·가드 해제·초안 변경·예외의 늦은 승인은 거부한다. `App.openId`·`closeTask`·`closeSettings`도 이동 성공 후에만 로컬 편집 상태를 정리한다.
- 공통 생성 버전은 `f22aeffa778b99e8`다. 버전 편집의 native confirm 1회를 제거해 당시 native 부채는 22회/9개 서명, 남은 Schedule 동기 confirm은 16회였다. 이후 수치는 최신 차수 기록을 따른다.
- 최신 소스로 Schedule TypeScript/빌드와 React 29개, Sheet 타입 검사/빌드, 루트 구조·CI·단위 279개가 통과했다. 메뉴·다단계 뒤로/앞으로·취소/승인·scope 중단을 포함한 집중 Chrome 34개도 통과했다(`artifacts/browser-release-navigation-final`, 28.0초). 여섯 앱 전체 1,179개 실행에서는 1,166개가 통과하고 13개가 실패했다. 이 중 일정 보관함 4개는 관리창을 먼저 닫던 실제 순서 회귀를 고쳐 재실행에서 통과했다. 연차/알림 2개는 재실행에서 통과했고, Portal 조직 폼 7개는 두 번째 저장의 문서 이동 전에 DOM을 읽던 검사 경쟁 상태를 고친 뒤 PC/모바일·두 테마 8개가 통과했다. 이 분할 재검증을 하나의 최종 전체 통과로 과장하지 않는다.
- 실제 연결을 복원하지 못하도록 구조/변이 검사를 갱신했다. PC 라이트·모바일 다크의 버전 초안 확인창을 직접 확인했고 diff 공백과 여섯 원본 ancestry/exact import tree·21개 보관 ref를 확인했다. 원격/푸시·운영 환경·DB/Docker는 변경하지 않았다.

## 85차: CS 초안 폐기 확인과 공통 비동기 상세 전환 (2026-09-11)

- `CompanyDisclosure`에 명시적인 `beforeRequest`/`requestOpen`을 추가했다. 기존 `setOpen`/`beforeChange` 동기 계약은 유지한다. 확인 중 중복 전환을 차단하고 승인 뒤 패널 노드·표시 상태·현재 요청을 다시 대조한다. refresh·계정 범위 변경·해제·직접 전환은 대기 요청을 취소하며 취소를 무시하는 hook의 늦은 승인도 적용하지 않는다.
- CS 플레이어 데이터의 상세 키·서버 변경, 조회/새로고침, 원래 값 복원, 키 추가/삭제와 저장 후 최신 목록 확인을 공통 초안 확인창으로 연결했다. 확인 당시 전체 편집 원문·사유·확인값·서버/UID/키·조회 객체와 계정 범위를 승인 직후 재검증한다. 취소는 초안과 원래 서버를 보존하고 추가/삭제 입력창은 최초 실행 버튼으로 포커스를 돌려준다. native beforeunload와 세 저장소·압축/큰 정수·쓰기 계약은 유지한다.
- 공통 disclosure 단위 17개, CS 구문 검사/단위 97개 및 루트 268개가 통과했다(루트 11.34초). 생성기 회귀의 부채 제거 대상은 실제로 남아 있는 Schedule 확인 코드의 격리 사본으로 옮겼으며 새 위반 거부/부분 변경 금지 검사는 유지했다. 생성 자산 버전은 `01501e57609e39e6`, primitive 잔여는 23회/10개 서명이다. 실제 전환한 CS 두 표기만 제거했고 예외는 늘리지 않았다.
- 초기 CS 37개 검사에서 포커스 복귀 4건과 확인창을 잘못 기대한 테스트 1건이 실패했다. 최초 opener 보존과 정상 무초안 경로를 수정한 뒤 전체 CS 59개가 통과했다(`artifacts/browser-cs-discard-verified`, 2.1분). 모바일 캡처의 버튼 줄바꿈을 확인해 문구를 `버리기`로 다듬고 한 줄 검사를 추가했으며 추가 22개가 통과했다(`artifacts/browser-cs-discard-polish`, 48.2초).
- 최종 추가 실행의 320px 다크·1440px 라이트 확인창을 직접 확인했다. 실제 공통 자산/CS 화면과 합성 계정·요청을 사용했으며 운영 플레이어 데이터를 조회·수정하지 않았다. 두 React 배포 빌드와 격리 Razor fixture 서버 검사 196개도 통과했다(서버 1분 16초).
- 같은 앱/fixture를 고정한 여섯 서비스 전체 Chrome **1,160개가 모두 통과**했다(`artifacts/browser-shared-draft-transitions-all`, 16.7분). 동일 실행 세션 `10360`의 exit 0까지 직접 관찰했으며 출력 제한/대기 시간 만료를 이유로 재시작하지 않았다.
- 최종 문서 정리 뒤 생성 자산/137개 소스/44개 페이지·diff 공백과 여섯 원본 ancestry/exact import tree·21개 보관 ref를 다시 확인했다. 수입 검사는 실제 `node tooling/verify-import.mjs`로 통과했으며 존재하지 않는 npm alias의 실패를 검사 통과로 간주하지 않았다.
- 최종 루트 검사도 268개 모두 다시 통과했다(15.3초). 별도의 전체 브라우저 실행 종료 결과도 위와 같이 확인했다.
- 전체 실행을 기다리는 동안 Schedule의 남은 17개 확인을 실제 소스와 대조했다. 주요 일정 DELETE 실행 확인 1개와 초안 폐기를 구분했고, App의 라우트 승인 전 상태 초기화·동기 history 복구·owned modal 종료·TODO/버전 잠금 경계를 `draft-transitions.md`에 기록했다. 실행 중 앱/생성 자산/브라우저 테스트는 변경하지 않았다.
- 같은 전체 실행에서 CS 플레이어 데이터 PC 라이트·초안 폐기 확인 모바일 다크, Leave 신청 폼 모바일 다크, Portal 알림센터 PC 다크, Schedule 펼친 보드 모바일 다크, Sheet 운영 개요 모바일 다크, Statistics 대시보드 PC 라이트를 직접 확인했다. 최종 확인 버튼 줄바꿈과 모바일 본문 폭을 확인했다. Sheet 소개 제목의 기존 어색한 줄바꿈(`확실하`/`게.`)은 남은 시각 개선 항목이며 자동 폭 검사 통과를 모든 화면의 완성으로 확대하지 않는다.
- `draft-transitions.md`와 루트 지침·구조/개발·CS 문서·완료 판정표를 갱신했다. Schedule 동기 닫기/라우팅과 나머지 UI·요청 경계는 후속 대상이다. 원격 설정·푸시·원본 checkout·운영 환경/DB/Docker는 변경하지 않았다.

## 84차: 계정·개인 설정·알림 작업 버튼의 공통화 (2026-09-11)

- Portal 서비스 진입·개인 설정·통합 알림과 Leave 로그인·알림·Discord 설정·정산의 native 버튼 15개를 기존 `cw-button`으로 전환했다. 사진 프레임의 별도 버튼 색·모서리·disabled opacity 규칙을 제거하고 배치만 남겼다. 프로젝트 아이콘 버튼도 같은 프레임의 기존 공통 primitive를 계속 사용한다.
- 기존 form/action/hidden/CSRF·disabled·계정/사진 버전·읽음 식별자와 저장/확인/미확정 수명주기는 유지했다. 정산 버튼은 조회가 아니라 정산 POST다. Leave 로그인 handler는 정상 흐름에서 redirect하므로 fallback Razor 버튼의 정상 화면 노출까지 검증했다고 주장하지 않는다. 링크·file·checkbox 및 초안 이탈 확인은 별도 경계다.
- 루트 검사 259개가 통과했다(17초). 두 React 배포 빌드와 격리 Razor fixture 서버 검사 196개도 통과했다(서버 1분 17초). 공통 생성 자산 버전은 `fecdb0d120b0d7b5`다. 감소 전용 prune으로 실제 전환한 15회만 제거해 primitive 부채는 25회/11개 서명이며 예외를 늘리지 않았다.
- 사진·Portal/Leave 알림·Discord·정산의 집중 Chrome 95개가 통과했다(`artifacts/browser-account-action-controls`, 1.1분). 새 공통 스타일 helper는 실제 소비자의 이름·클래스·계산된 색·모서리·44px/compact 32px·부모 폭·비활성 opacity를 검사한다. 사진 준비/삭제와 전송 중 fieldset disabled도 기존 업무 회귀 안에서 확인한다.
- 모바일 다크 개인 설정의 사진 미리보기/작업 버튼, PC 라이트 Leave 읽음 처리 후 목록, 모바일 다크 Discord 저장 후 연결 상태를 직접 확인했다. 합성 계정·HTTP와 실제 Razor/공통 자산이며 운영 OAuth/DM/사진/알림/정산을 실행하지 않았다. 이동 링크와 보조 문구 등 남은 시각 요소를 완료로 확대하지 않는다.
- 같은 앱/fixture를 고정한 여섯 서비스 전체 Chrome **1,138개가 모두 통과**했다(`artifacts/browser-shared-account-actions-all`, 16.8분). 같은 실행을 새 출력으로 관찰해 exit 0까지 확인했고 관찰 timeout이나 출력 제한을 이유로 재시작하지 않았다. 집중 검사 결과나 이전 83차 전체 통과로 이번 종료 증거를 대신하지 않았다.
- 전체 실행의 CS 플레이어 데이터 PC 라이트, Leave 신청 폼 모바일 다크, Portal 통합 알림 PC 다크, Schedule 펼친 보드 모바일 다크, Sheet 운영 개요 모바일 다크, Statistics 대시보드 PC 라이트를 직접 확인했다. 사진 프레임의 공통 CSS 제거에 영향을 받는 Portal 프로젝트 아이콘 편집 모바일 다크의 저장/삭제 버튼도 확인했다. 전체 페이지의 모든 장식·링크 전환이나 운영 연계까지 완료했다는 뜻은 아니다.
- 기록 정리 후 루트 259개를 다시 통과했다(21.4초). `check:ui`의 생성 자산/137개 소스/44개 페이지와 여섯 원본 ancestry·exact import tree·21개 보관 ref 및 diff 공백도 다시 확인했다. 후속 초안 확인 전환의 CS 상세/서버/조회 및 Schedule 팝업/라우팅 동기 가드를 실제 소스와 대조해 완료 판정표에 남겼다. 해당 비동기 전환은 아직 구현하지 않았다.
- `account-action-controls.md`와 필드/Portal 계약·구조/개발·앱 문서 및 완료 판정표를 갱신했다. 원격은 미설정이며 푸시·원본 checkout/운영 환경·DB·Docker는 변경하지 않았다. 남은 공통 UI/동작과 원격 보호·산출물·독립 배포/롤백·운영 전환은 계속 진행 대상이다.

## 83차: CS 정적 안내의 공통화와 대비 검증 (2026-09-11)

- CS 네 업무 화면의 정적 안내 아홉 개를 `cw-callout`으로 연결했다. 기존 `.notice.success`의 밝은 고정 글자색과 10px 본문을 제거하고 공통 의미 토큰·제목/본문·inline code를 사용한다. 업무 설명과 실제 요청 성공/실패 상태를 구분하며 업무 API·실행 확인은 유지한다.
- JavaScript로 본문을 다시 만들지 않는다. literal 소유자·tone·제목/본문과 live 상태 혼용·중첩 안내 등을 검사한다. 초기 aside 구현과 잘못된 sidebar 닫기 태그는 기존 구조 검사로 발견해 수정했으며 검사나 부채 예외를 완화하지 않았다.
- CS 구문 검사와 단위 97개, 최종 루트 검사 259개가 통과했다(루트 12.1초). 공통 생성 바이트·137개 UI 소스·44개 페이지 및 CI 정책을 확인했다. 기존 primitive 부채는 40회/26개 서명이다.
- 실제 CS HTML/CSS·공통 JS의 집중 25개가 통과했다(`artifacts/browser-cs-callouts-verified`, 22.7초). 모바일/PC·두 테마에서 제목/본문/code의 계산 대비 4.5:1 이상·글자 크기·폭을 검사했다. PC 라이트 플레이어 데이터와 모바일 다크 상품 캡처를 직접 확인했다.
- JavaScript 비활성 native 8개도 통과했다(`artifacts/browser-callouts-native`, 4초). 네 tone·네 너비·두 테마, 긴 제목·공백 없는 코드 원문·다음 카드 경계를 검사하고 모바일 다크 캡처를 직접 확인했다. html 테마값은 명시하며 native 자동 테마 초기화 검증으로 확대하지 않는다.
- 두 React 배포 빌드와 Razor fixture 서버 검사 196개가 통과했다(서버 1분 23초). 이후 앱/fixture를 고정한 여섯 앱 전체 Chrome **1,138개가 모두 통과**했다(`artifacts/browser-shared-callouts-all`, 17.2분). 같은 실행을 종료까지 관찰했으며 중간 대기/출력 제한을 이유로 재시작하지 않았다.
- 전체 실행의 CS 환불 PC 라이트, Leave 대시보드 모바일 다크, Portal 계정 등록/일괄 관리 PC 다크, Schedule 보드 모바일 다크, Sheet 운영 개요 모바일 다크, Statistics 대시보드 PC 다크 캡처를 직접 확인했다. 기존 작은 보조 문구·앱별 장식/버튼 등까지 모두 전환한 것으로 확대하지 않는다.
- 남은 primitive 40회를 실제 소스와 대조해 버튼 15·초안 이탈 확인 19·달력 표 2·range 1·동적 생성 3으로 구분했다. 비시각적 선호 입력·clipboard fallback과 실제 프로젝트 checkbox를 같은 UI 전환으로 취급하지 않도록 완료 판정표에 기록했다.
- `static-guidance.md`, AGENTS·구조/개발·CS 계약/README를 갱신했다. 여섯 원본 ancestry/exact import tree·21개 archive ref와 diff 공백을 확인했다. 원격은 미설정이며 푸시·배포·운영 환경/DB/Docker는 변경하지 않았다. 다른 서비스의 남은 안내/장식·폼/읽기/쓰기와 운영 이관은 미완료다.

## 82차: 공통 반응형 업무 표 전환 (2026-09-11)

- Leave 신청 내역·승인/취소 대기와 최근 신청·직원 현황·개인/관리자 사용 통계·보안 현황을 공통 cards/key-value 표로 연결했다. PC 비교 표와 모바일 카드가 같은 값/프로필/폼을 유지한다. 실제 header scope·서버 레이블·value wrapper를 명시하고 현재 연차년도는 aria-current로 강조한다.
- 처음의 절대 위치 모바일 레이블을 같은 grid 행으로 보완해 긴 제목이 행 높이에 반영되도록 했다. 승인/반려/강제 삭제 버튼과 사유 입력도 공통 native primitive를 사용하며 기존 업무 handler·CSRF·기준값·확인/초안 수명주기는 유지한다. Leave에는 열 너비와 메모 읽기 면적을 남겼다.
- literal 표의 role·scope·레이블·첫 value wrapper 및 미지원 변형을 검사하고 누락 변이 검사를 추가했다. 실제 제거분만 prune하여 기존 부채는 40회/26개 서명이다. 달력/감사 상세 표와 이동 링크, 아직 미전환 소비자의 예외를 늘리거나 완료로 처리하지 않았다.
- 첫 Leave 서버 검사 143개가 통과했다(1분 40초). 초기 실제 Razor Chrome 28개도 통과했다(22.1초). 최종 grid/value wrapper 이후 두 React 앱 빌드와 Razor fixture 서버 검사 196개가 통과했다(1분 20초). 루트 검사 258개도 최종 검사 규칙으로 다시 통과했다(24.1초).
- 최종 집중 Chrome 28개가 통과했다(`artifacts/browser-leave-record-tables-final`, 37.3초). 실제 열/셀 대응·wrapper·모바일 레이블 높이·문서 폭을 확인했다. 모바일 다크 승인/보안 카드와 PC 라이트 승인·취소 대기 표를 직접 확인했다. 합성 계정/HTTP와 실제 Razor·공통 자산이며 운영 계정/업무를 사용하지 않았다.
- 같은 최종 앱 코드로 JavaScript 비활성 native 보강 첫 8개가 통과했다(`artifacts/browser-leave-record-tables-native`, 7.9초). 캡처 확인에서 시스템 dark 지정만으로는 JavaScript 테마 해석기가 실행되지 않아 기본 light로 표시됨을 확인했다. 두 테마 CSS 검증이 되도록 html 테마값을 명시한 최종 8개도 통과했다(`artifacts/browser-leave-record-tables-native-final`, 8.9초). 실제 table/header 역할·폼 전송값·긴 합성 제목의 높이와 다음 셀 경계·key-value 순서를 확인하고 최종 모바일 다크 캡처도 직접 확인했다. 추가 테스트는 이미 시작한 전체 1,122개 실행과 별도로 수행했으며 앱 자산을 바꾸지 않았다. native 기본 문서의 자동 테마/전역 링크 전체를 검증한 것으로 확대하지 않는다.
- 전체 여섯 앱 Chrome **1,122개가 모두 통과**했다(`artifacts/browser-shared-record-tables-all`, 16.7분). npm 인자 전달로 첫 browser 단계가 'No tests found'로 종료된 것을 확인하고 이미 성공한 빌드/fixture를 반복하지 않은 채 직접 Playwright를 실행했다. 같은 최종 앱 코드의 추가 native 8개는 별도 종료 결과로 구분한다.
- 최종 중첩 표 우회 거부 변이까지 추가한 루트 검사 258개도 통과했다(22.5초). 전체 실행의 CS 플레이어 라이트·회사 계정 다크·팀 일정/시트 모바일 다크·통계 대시보드 다크 캡처를 직접 확인했다. 기존 안내 카드의 낮은 대비 등 남은 시각 전환은 별도로 기록하며 광범위한 테스트 통과를 전체 목표 완료로 확대하지 않는다.
- 계약/AGENTS·구조/개발·Leave 문서를 갱신했다. 여섯 원본 ancestry/exact import tree와 21개 보관 ref 및 diff 공백을 다시 확인했다. 원격은 미설정이며 푸시·운영 checkout/환경/DB/Docker는 변경하지 않았다. 원격 보호/독립 배포·롤백과 전체 목표 완료 감사는 계속 남아 있다.
- 여섯 원본 로컬 checkout의 현재 HEAD도 최초 수입 commit과 모두 같고 미커밋 경로가 없음을 확인했다. 이는 로컬 읽기 전용 대조이며 원격 fetch/최종 운영 이관 시점의 최신성 증거는 아니다. 전체 캡처 확인 중 CS 라이트 안내 카드의 개별 밝은 글자색이 남아 있는 것도 확인해 완료 판정표의 후속 작업으로 기록했다.

## 81차: 연차 달력·날짜 상세의 공통 직원 프로필 (2026-09-11)

- 월간 갱신과 날짜 상세의 신청/외부 일정/갱신에 공통 entity 렌더러를 연결했다. 기존 월간·연간 요약도 장식용 사진/이니셜과 전체 이름을 유지한다. 개인 이름에서 UTF-16 코드 단위 하나만 잘라 깨질 수 있던 Razor 이니셜을 보완했다. 새 사진 API·별도 캐시/갱신 루프는 만들지 않았다.
- 레이아웃의 로컬 EmployeeId→CompanyUserId JSON이 회사 ID를 숫자로 직렬화하던 정밀도 손실 경로를 확인했다. 양쪽을 invariant 십진 문자열로 보존한다. 실제 로컬/회사 ID가 서로 다른 9007199254740991 초과 데이터로 매핑하고, 미연결 로컬 ID에 사진이 있더라도 그 사진을 사용하지 않는지 검사했다.
- 상세의 이름·유형·상태·취소 가능 여부/ID를 개별 속성으로 분리해 `|`가 들어간 이름이나 공휴일이 필드를 밀거나 잘리지 않게 했다. Razor/동적 HTML 인코딩, 신청 ID·기준값·기존 승인/취소/가불 처리와 POST/CSRF를 보존했다.
- 갱신이 본인 직원 객체를 별도로 만들던 우회를 제거하고 기존 표시 직원 필터를 사용했다. 외부 일정 본인/대신보기도 허용 직원 목록과 교집합을 사용해 회사 마스터가 다시 나타나지 않게 했다. 관리자에게 비공개 직원과 퇴사 직원의 과거 외부 일정을 보여주는 기존 정책은 유지하며 DB/발생 계산/인가를 재설계하지 않았다.
- 월간/연간 사진 크기는 16/14px 기하로 제한하고 날짜 상세에는 이름+사진 행 배치를 적용했다. 모바일 보조 문구 숨김과 외부 일정의 metadata 색 선택자를 직계 span으로 좁혀 내부 공통 사진/이니셜을 덮지 않게 했다. 공통 CSS/런타임은 변경하지 않았다.
- 새 실제 SSO/격리 DB/Razor 검사 첫 실행에서 선호 저장 플래그를 생략한 테스트와 연간 기존 최대 두 항목 요약을 무시한 단언이 실패했다. 실제 GET 선호 저장 경로를 사용하고 특정 직원만 있는 별도 날짜도 seed하여 보강했다. 검사나 업무 표시 제한을 제거하지 않았으며 신규 역할/본인 보기 5개가 통과했다. 이어 전체 Leave 서버 검사 143개가 통과했다(1분 19초).
- 루트 공통 생성/구조·테마/CI 정책 및 계약/DOM/생성기 검사 257개가 통과했다. 최종 CSS 선택자 정리 뒤 check:ui도 다시 통과했다. 기존 primitive 부채는 65회/44개 서명으로 유지했고 새 예외는 추가하지 않았다.
- 새 Chrome 집중 9개가 통과했다(`artifacts/browser-leave-calendar-entities-initial`, 11.4초). 최종 앱 CSS와 실제 Razor로 전체 Leave Chrome **508개가 모두 통과**했다(`artifacts/browser-leave-calendar-entities-full`, 5.7분). 두 너비/테마, 원문/상태·정확한 ID, 사진 갱신·제거·실패·이전 이미지 오류·재열기·로그아웃과 기존 업무 저장/초안·설정/다른 Leave 페이지를 확인했다.
- 초기 모바일 다크 신청 상세/연간 달력·PC 라이트 갱신 상세와 최종 모바일 라이트 신청 상세·PC 다크 갱신 상세/라이트 연간 달력을 직접 확인했다. 합성 이름/프로필 HTTP와 실제 렌더링 자산이며 운영 개인정보/SSO 검증은 아니다. 다른 다섯 앱 전체 브라우저를 재실행했다고 보고하지 않는다.
- 계약/AGENTS·구조/개발·Leave 문서와 완료 판정표를 갱신했다. 여섯 원본 ancestry/exact import tree 및 21개 보관 ref, diff 공백을 확인했다. 원격은 미설정이며 푸시·운영 checkout/DB/환경/Docker는 변경하지 않았다. 다른 소비자/표시 위치, 미전환 UI/읽기/쓰기와 원격 필수 보호·독립 배포/롤백/운영 이관은 남는다.

## 80차: 연차 신청·날짜 상세·목록 작업의 공통 컨트롤 (2026-09-11)

- `Leave/Index`의 일반 입력/버튼과 `_SelfActionForm`의 목록 취소·철회 버튼을 공통 primitive로 전환했다. 날짜 상세에서 동적으로 생성하는 수정/삭제·취소·철회/강제 삭제도 실제 common class·primary/danger/compact에 연결했다. 필드 이름/ID·원문·hidden 기준값/CSRF·native 제약과 기존 handler/서버 정책·저장/확인/초안 수명주기를 보존했다.
- 신청은 공통 필드를 PC 3열/모바일 1열, 관리자/외부 일정은 공통 2열/모바일 1열로 배치하고 사유/인수인계/메모 읽기 면적을 유지했다. 오래된 여러 단계의 폼 그리드/입력 skin·포커스/disabled 색 복제를 제거했다. 조회용 연도/월·표시 개수/페이지도 common field를 사용하되 기존 GET을 유지한다. 직원 select는 기존 초성 검색·로컬→회사 ID 연결을 유지한다.
- 루트 생성 바이트/구조/테마/CI 정책 및 계약·DOM·생성기 257개가 통과했다. 격리 서버/Razor Leave 검사 138개(1분 16초)도 통과했다. 실제 감소분 38회/35개 서명만 prune해 기존 부채는 65회/44개 서명이다. 새 예외를 늘리거나 checkbox/달력 표/이동 링크를 거짓으로 공통 전환하지 않았다.
- `support/leave-controls.mjs`는 실제 Razor와 동적 상세에서 라벨·공통 클래스·계산된 테마 색/모서리/높이·컨테이너 폭을 검사한다. 최초 네 업무/두 너비/두 테마 16개가 통과했다(`artifacts/browser-leave-controls-initial`, 19.7초). 이어 신청/취소·외부 일정/관리자·복수 초안·설정·다른 페이지까지 전체 Leave Chrome 499개가 모두 통과했다(`artifacts/browser-leave-controls-full`, 5.5분).
- 전체 검사 뒤 내용이 없는 CSS media 두 줄을 정리하고 테스트를 보강했다. 전송 중 실제 disabled 스타일, 날짜 상세 안에서 직원 초성 검색/선택·포커스/부모 창 보존, full-page 고정 헤더 위치와 혼동하지 않는 viewport 캡처를 추가했다. 최종 집중 16개도 통과했다(`artifacts/browser-leave-controls-final`, 18.8초). 마지막 정리는 새 CSS 선언/업무 동작 변경이 아니며 전체 499개 실행과 최종 16개의 범위를 구분한다.
- 초기 PC 라이트/모바일 다크의 강제 추가·외부 일정 편집과 최종 PC 라이트/모바일 다크 신청 viewport를 직접 확인했다. 원래 입력 원문·공통 색/배치·긴 textarea/위험 버튼을 확인했으며 합성 DB/HTTP와 실제 Razor/공통 자산 검사다. 운영 계정/데이터/SSO 검증을 주장하지 않는다. 공통 CSS/런타임은 변경하지 않았으므로 다른 다섯 앱 전체 브라우저를 재실행했다고 보고하지 않는다.
- 계약/AGENTS·구조/개발·Leave 문서 및 완료 판정표를 갱신했다. 여섯 원본 ancestry/exact import tree와 21개 보관 ref, diff 공백을 확인했다. 원격은 미설정이며 푸시·운영 checkout/환경/DB/Docker는 변경하지 않았다. 남은 UI/데이터 연결·원격 필수 보호·독립 배포/롤백·운영 이관과 전체 완료 감사는 계속 진행 대상이다.

## 79차: 연차 날짜 상세의 공통 native 팝업 전환 (2026-09-11)

- 기존 div/section overlay를 같은 `calendarArea` 안의 `.cw-modal` native dialog와 `CompanyDialog.attach`로 전환했다. 개별 backdrop/카드/다크 프레임 및 document Escape 루프를 제거했다. 기존 폼·hidden 기준값/CSRF·초안 DOM은 이동/삭제하지 않으며 날짜 버튼의 키보드 진입·제목 초기 포커스·닫기/Escape/바깥 클릭·원래 날짜로 복귀를 연결했다.
- 취소/철회·외부 일정·관리자 강제 작업의 확인 후 숨김을 `LeaveDayDetail.close`로 모았다. 사용자 닫기는 pending 중 보류하며 기존 승인 후 숨김은 전송할 폼을 유지한다. 계정 범위에는 창과 자식 확인을 닫고 무효 문서 재진입을 막는다. 달력 노드 교체/일반 pagehide에 연결을 해제하며 bfcache는 보관한다. 서버 업무/API·인가·DB·기존 URL은 변경하지 않았다.
- 초기 실제 화면에서 긴 상세를 내리면 닫기 버튼이 사라지는 것을 확인해 제목/닫기를 sticky로 보완했다. 프레임의 색·backdrop·viewport는 공통 소유이고 Leave에는 본문 너비/여백·내부 스크롤 기하만 둔다. 날짜 상세의 나머지 기존 입력·작업 버튼/카드 색은 아직 별도 이관 대상이다.
- 격리 서버/Razor 전체 213개(1분 19초)가 통과했고 최종 sticky/바깥 클릭과 실제 Razor 연결 단언 추가 뒤 Leave 서버 검사 138개(1분 22초)를 다시 통과했다. 실제 Razor/합성 DB와 HTTP를 사용하며 운영 계정/데이터에는 연결하지 않았다. 최초 관리자 Chrome 54개도 통과했다(`artifacts/browser-leave-owned-detail-initial`, 43.5초).
- 새 구조 변이 검사에서 키보드 진입/범위 가드의 일반 단어가 다른 사용처에도 남아 누락을 놓치는 두 실패를 확인했다. 실제 속성/진입 가드 전체 표현을 검사하도록 좁혀 보강했고 루트 계약/DOM/생성기/CI 정책 257개가 통과했다. 이전 Escape 정적 마커는 private 루프를 유지하는 대신 공통 attach 연결과 실제 중첩 브라우저 검사로 교체했다.
- 최종 전체 Leave Chrome 498개가 모두 통과했다(`artifacts/browser-leave-owned-detail-final`, 5.7분). 같은 최종 앱 자산으로 추가한 native close 가드·bfcache 유지·일반 pagehide 해제 검사 1개도 통과했다(`artifacts/browser-leave-owned-detail-lifetime`, 4.4초). PC 라이트와 모바일 다크의 최종 날짜 상세에서 공통 프레임·고정 제목/닫기를 직접 확인했다. 모든 UI 검사는 실제 Razor와 합성 HTTP이며 운영 연계 검증으로 확대하지 않는다.
- 실제 닫기 버튼을 공통 primitive로 전환한 감소분 1개만 prune하여 기존 부채는 103회/79개 서명이다. 새 날짜 버튼/native dialog는 처음부터 공통 연결을 사용했고 예외를 늘리지 않았다. 공통 자산·런타임은 변경하지 않아 다른 다섯 앱 전체 브라우저 재실행을 주장하지 않는다. 여섯 원본 import ancestry/exact tree 및 21개 보관 ref와 diff 공백을 다시 확인했다.
- 계약/AGENTS·구조/개발·Leave 문서와 완료 판정표를 갱신했다. 원격은 미설정이며 푸시·운영 checkout/환경/DB/Docker는 변경하지 않았다. 남은 UI/데이터 연결·원격 필수 검사·최종 이관/독립 배포·롤백과 전체 완료 감사는 계속 진행 대상이다.

## 78차: 지속 편집·선택창의 공통 프레임과 수명주기 (2026-09-11)

- `CompanyDialog.attach`와 기존 `present`/확인·비교창이 같은 native 수명주기/중첩 스택을 사용하도록 연결했다. React 소유 노드는 이동·제거하지 않으며 조건부 렌더링/초안은 앱에 둔다. 명시적 retain/dismiss 범위 정책·동기 닫기 가드·portal 부모 해제·AbortSignal·외부 close/queued close·포커스 복원을 처리한다. 일회 확인창의 기존 단일 실행 제한과 전체 소비자 계약은 보존했다.
- Schedule 업무/버전 편집·주요 일정 관리·날짜 이동/선택·이미지 확대의 실제 여섯 팝업을 generated `useWorkspaceModal` 및 `.cw-modal`에 연결했다. 업무/버전/주요 일정의 전송·초안 가드와 계정 재확인 중 보존, 날짜 이동의 초기화·native 검증, 날짜/이미지 종료와 포커스를 유지한다. 프레임 테마·backdrop·viewport/drawer는 공통 소유이며 앱은 본문 폭/스크롤·이미지 여백/비율만 유지한다.
- CSS 사용처를 추가 확인해 같은 옛 task-dialog 프레임을 사용하던 버전/주요 일정 관리도 함께 전환했다. 최초 세 프레임 연결만으로 전체 일정 팝업을 완료했다고 판단하지 않았다. import/페이지 등록이 없는 옛 `Notifications.tsx`는 제거했다. 실제 회사 통합 알림과 일정 서버 API/DB는 유지하며 삭제 파일은 Git 이력에서 복구할 수 있다.
- 실제 화면에서 작은 이미지와 닫기 버튼 간격이 부족한 것을 확인해 상단 공간과 큰 이미지의 viewport 폭/높이를 보완했다. 업무·이미지·달력·버전 편집의 PC/모바일·두 테마 화면을 직접 확인했고 계산 색·프레임 경계/기하·이미지 비율/닫기 간격과 포커스 검사를 연결했다. 합성 이미지/계정/HTTP를 사용하며 운영 데이터 검증을 주장하지 않는다.
- 공통 lifecycle 집중/primitive 검사 20개, React 포함 일정 단위 156개, 격리 서버/Razor 통합 191개와 실제 Schedule/Sheet 빌드를 확인했다. 이후 추가 abort/예외·실제 여섯 연결 변이·생성기 의존성까지 포함한 루트 전체 255개가 통과했다. 생성기 격리 fixture에 신규 검사 모듈을 복사하지 않은 첫 실패는 구성 누락을 수정해 재검증했다.
- 최초 일정 브라우저 142개 및 중첩/프레임 집중 12개가 통과했다. 이후 전체 실행과 병행한 일정 실행은 142개 통과/4개 시간 초과로 종료했다(`artifacts/browser-owned-modal-schedule-final`). trace상 목록/칸반 이동의 클릭이 길어져 30초 제한에 도달했으며 실패 뒤의 session-closed 메시지를 앱 원인으로 단정하지 않았다. timeout을 늘리거나 실패 검사를 제외하지 않았다.
- 여섯 서비스 전체 Chrome은 1,075개 모두 통과했다(`artifacts/browser-owned-modal-all`, 19.5분). 위 네 경로도 동일 실행에서 통과했지만 환경 문제로 확정하지 않는다. 전체 실행 중 Schedule이 자산을 읽는 동안 빌드를 교체하지 않았고, 다른 다섯 앱/공통 자산은 이 전체 검사 시작 뒤 변경하지 않았다. 최종 주요 일정 관리 연결과 미사용 파일 제거·큰 이미지 추가 검사는 아래 최종 Schedule 결과로 보완한다.
- 최종 Schedule 실제 번들(`index-DYhgd5F1.js`)의 Chrome 150개가 모두 통과했다(`artifacts/browser-owned-modal-complete`, 3.7분). 주요 일정 관리까지 공통 프레임·접근성 이름·색·viewport 검사를 적용하고 큰 가로/세로 이미지의 비율·닫기 간격·포커스 검사를 추가했다. 최종 모바일 다크/PC 라이트 주요 일정 편집창과 모바일 다크 세로 이미지/PC 라이트 가로 이미지 화면을 직접 확인했다. 긴 파일명은 창 내부에서 줄바꿈·스크롤하며 문서 가로 넘침을 만들지 않는다.
- 새 `cw-modal`에 클래스만 추가하거나 접근성 이름/공통 연결을 누락하고 JSX open·onCancel·onClose로 중복 제어하는 경우를 primitive 검사와 변이 테스트로 차단했다. 같은 소스의 호출 존재를 검사하는 정적 가드이며 모든 ref 데이터 흐름을 증명하지는 않는다. 마지막 보강을 포함한 루트 계약/DOM/생성기/CI 정책 검사 256개와 생성 바이트·구조 검사가 통과했다.
- 공통 생성 바이트·137개 UI 소스/44개 페이지와 최초 여섯 import ancestry/exact tree·21개 보관 ref를 확인했다. 감소 전용 prune으로 실제 프레임 6개 및 미사용 알림창 5개 표기를 제거해 부채는 104회/80개 서명이며 예외를 늘리지 않았다. `owned-modals.md`와 관련 소비자/개발/구조/완료 판정 문서를 갱신했다.
- 원격은 미설정이며 푸시·원본 저장소/운영 checkout·DB·환경·Docker 변경은 하지 않았다. 다른 앱의 미전환 프레임, 일정 댓글/업로드/주요 일정 전송, 원격 필수 검사/출처와 독립 배포·롤백/운영 이관은 남는다. 전체 목표는 계속 진행 중이다.

## 77차: 일정 업무 화면의 공통 JSON 저장 연결 (2026-09-11)

- 공통 `CompanyForm.createTransport`에 JSON과 기존 native 폼의 요청 관찰을 통합했다. native FormData·검증·disabled/포커스 복원은 attach 어댑터로 유지하고 JSON은 정확한 직렬화 복사본·같은 출처/CSRF·공통 envelope·취소/timeout/늦은 응답 판정을 재사용한다. generated React 연결은 Schedule과 Sheet에 함께 생성한다.
- 실제 TaskPanel의 생성/수정/상태 변경을 `useTaskWrites`와 `taskWrites`에 연결했다. fresh 계정/전체 기준값·공통 확인창·프로필·전체 ACK/첨부를 확인하고 저장 후 상세/목록 GET을 분리한다. 정확한 입력 거부·충돌과 unknown을 구분하며 SPA 편집기 재열기로 unknown 잠금을 초기화하지 않는다. 상태 변경/후속 읽기로 독립 댓글 초안을 지우지 않는다.
- 문서 세션의 sent 기록·전송 전 원래 계정 재확인 복구와 충돌한 이전 resource 소모를 명시했다. sent/unknown/실제 pagehide는 GET으로 풀지 않는다. 프런트/서버의 날짜 suffix 차이로 잘못 비교하지 않도록 UTC 비교를 통일하고 다른 시간대에서도 검사했다.
- 신규/수정/상태·PC/모바일·두 테마 및 기존 충돌 비교 집중 Chrome 13개가 통과했다. 초기 실패는 없는 DOM 속성/미제공 프로필 fixture와 등록 버튼의 실제 접근성 이름을 잘못 가정한 단언이었다. 실제 공통 이미지 렌더러와 합성 사진을 제공해 검증했고 선택기/사진 기능을 제외하지 않았다. 시각 확인에서 저장 후 조회 오류 두 안내가 중복되는 것을 찾아 하나로 정리했다. 상태 충돌의 명시적 GET 복구와 abort를 무시하는 늦은 JSON의 timeout/scope/pagehide 검사도 최종 번들에 포함했다.
- native/JSON/문서 세션 집중 40개, 일정 단위 152개, 서버 50개와 실제 격리 Razor/서버 통합 191개를 통과했다. 루트 첫 실행 248/249에서 기존 보관/복원 변이 검사가 새 write 연결의 동일 문구 때문에 실패했다. 검사 대상을 실제 useTaskActions 호출로 한정해 누락 감지를 강화한 뒤 루트 전체 249개가 통과했다. 공통 생성 바이트·138개 UI 소스/44개 페이지, 부채 115회/91개 서명과 최초 여섯 import ancestry/tree·21개 보관 ref를 유지했다.
- 공통 런타임 변경으로 여섯 앱 전체 Chrome 회귀를 실행했고 1,067개 통과/1개 실패로 종료했다(`artifacts/browser-shared-task-writes-all`, 16.5분). 기존 보관 확인의 계정 재확인 뒤 새 공통 작업 세션에 검증 결과가 전달되지 않아 계속 잠기는 실제 연결 회귀였다. `useTaskActions.refresh`의 검증된 상세/원래 계정을 공통 작업 세션에 전달했고 전송 전 범위만 복구한다. sent/unknown의 GET 해제는 허용하지 않는다. fixture도 실제 서버 editing 메타데이터를 포함하도록 보정했다.
- 이 Schedule 전용 보완 뒤 최종 실제 번들의 일정 Chrome 전체 142개가 통과했다(`artifacts/browser-schedule-task-writes-final`, 2.6분). 다른 다섯 앱/공통 런타임은 전체 실행 뒤 변경하지 않았다. 따라서 여섯 앱 회귀와 최종 일정 재실행을 함께 증거로 삼되 최초 전체 실행이 전부 통과했다고 기록하지 않는다. PC/모바일 및 두 테마의 최종 확인창·단일 저장 후 조회 실패 안내·담당자 프로필을 직접 확인했다.
- 마지막 일정 단위 153개, 루트 전체 249개·UI/CI 정책 및 타입 검사를 다시 통과했다. 실제 보관 재확인 후 같은 계정의 검증 정보만 전달하고 scope가 다시 바뀌면 전달하지 않는 검사를 추가했다. Schedule/Sheet 실제 배포 빌드를 수행했으며 .NET 서버/DB/실운영 환경은 변경하지 않았다. 문서의 현재 연결/남은 범위를 갱신하고 생성 코드·diff 공백을 확인했다.
- 원격은 미설정이며 새 원격/푸시·원본 저장소/운영 checkout·DB·환경·Docker 변경을 하지 않았다. 댓글/업로드/모달 프레임과 다른 미전환 UI, 원격 보호/출처·독립 배포/롤백·운영 이관은 계속 남는다. 전체 목표는 진행 중이다.

## 76차: 일정 업무 저장의 공통 서버 응답과 기준값 (2026-09-11)

- `TaskWriteProtocol`을 업무 생성/수정/상태 API의 선택적 공통 envelope 어댑터로 연결했다. 기존 JSON DTO·경로와 레거시 업무 객체 응답은 유지하며 명시적인 media type을 선택한 요청만 현재 회사 사용자 ID·기존 Version·업무/본문 첨부 전체 기준값을 대조한다. 상세 GET에 editing 메타데이터를 추가했다. 원문 속 큰 정수·실제 날짜 null 의미·첨부 중복 제거와 기존 담당자/프로젝트/비공개/보관 인가를 유지한다.
- PUT/PATCH는 트랜잭션 안에서 수정 대상/기준값을 읽는다. 저장 후 업무와 본문 첨부를 DB에서 다시 읽어 전체 결과를 JSON 값으로 고정하고 커밋 성공 후 반환한다. 첫 쓰기 전 입력/충돌/권한 거부와 첫 쓰기 후 결과 미확정을 구분한다. 커밋 직전/직후 예외 모두 unknown이며 후자는 실제 DB에 업무/감사가 남는 것을 검사했다. 이 응답 계약에 영구 멱등성이나 브라우저 취소에 의한 롤백 보장을 부여하지 않는다.
- 실제 TestServer/임시 SQLite·합성 SSO/디렉터리/이미지 업로드를 사용한 새 계약 19개를 포함해 일정 서버 전체 50개가 최종 통과했다. 모든 업무/첨부 필드 fingerprint, 상세 왕복·첨부 정렬/시각, 생성·수정·상태 전체 ACK, 첨부 교체/댓글 보존, 기존 JSON/Accept 옵션, 계정·CSRF·비공개/권한, 두 동시 쓰기, DB/커밋 실패와 실제 저장행 재조회를 검증한다. 운영 DB·계정·이미지/API에는 연결하지 않았다.
- 실제 DB 저장값/GET/ACK를 비교하는 추가 검사는 처음 49개 통과/1개 실패였다. 한국어 JSON의 Unicode escape 표현 차이를 값 변경으로 오인한 단언이었다. 전체 JSON의 의미상 동등성을 비교하도록 바꾸고 다시 전체 50개가 통과했다. 실제 DB 값/전체 필드와 기준값 대조는 유지했다.
- 구조 검사와 변이 검사를 추가했다. 첫 루트 전체 실행은 229개 통과/생성기 1개 실패였으며 격리 생성기에 새 검사 모듈이 복사되지 않은 원인이었다. 모듈과 두 서버 소스를 격리 대상에 포함한 뒤 전체 230개가 통과했다. 검사를 생략하거나 예외를 늘리지 않았다. 실제 CI 정책/페이지 생성기의 기존 여섯 서비스 범위를 유지한다.
- React 단위 137개 및 타입/배포 빌드를 통과했다. 공통 생성 바이트·136개 UI 소스·44개 페이지, 부채 115회/91개 서명과 최초 여섯 import ancestry/tree·21개 보관 ref 및 diff 공백을 확인했다. 이번 단계는 서버/계약·검사 변경이며 실제 브라우저/화면 검증을 새로 수행한 것으로 주장하지 않는다. 공통 런타임/CSS·React 화면 구현은 변경하지 않았다.
- 계약·AGENTS·구조/개발/README·완료 점검표를 갱신했다. TaskPanel의 공통 JSON 전송·전체 ACK/확인/초안/미확정 잠금과 이미지 업로드·댓글 쓰기·dialog 프레임, 다른 앱 미전환 UI 및 원격 보호·독립 배포/롤백·최종 운영 전환은 남아 있다. 원격 미설정 상태를 확인했고 새 원격 생성/푸시·원본 저장소나 운영 checkout/환경/Docker를 변경하지 않았다. 전체 목표는 계속 진행 중이다.

## 75차: 일정 업무·댓글 상세의 공통 읽기 연결 (2026-09-11)

- `useTaskDetail`에서 업무 상세 초기/폴링·업무와 댓글 충돌 비교·보관/복원/댓글 삭제 전후 GET을 generated 공통 읽기 세션에 연결했다. 한 detail 채널의 30초 관찰 제한·진행 중/실패 폴링 정지·늦은 응답/라우트/해제를 같은 소유자로 관리한다. 별도 상세 GET을 기본값으로 제공하지 않는다.
- 상세 전체의 정확한 업무 ID·안전한 정수/버전·날짜/상태/본문, 댓글/답글과 첨부 관계·이력 필드를 검증하고 알려진 버전 후퇴/댓글 누락을 거부한다. 기존 TaskRoutes의 전체 댓글/같은 업무 첨부/최신 100개 이력과 DiscussionRoutes의 최상위 답글·논리 삭제/첨부 해제 정책을 확인했다. 원문 안의 큰 정수/JSON은 재직렬화하지 않는다.
- 실패와 빈 결과를 구분하고 마지막 정상 내용·독립 업무/댓글 초안을 보관한다. 범위 이벤트/401/403에는 자동 읽기와 관련 쓰기를 잠그고 초기 소유자의 명시적 회사 재확인·전체 상세 GET으로만 재개한다. 뒤쪽 무효화된 보드는 복구하지 않는다. 기존 snapshot을 삭제/익명화한 것으로 설명하지 않으며 새 소유자에는 문서 재개방을 요구한다.
- 첫 집중 9개 검사는 4개 통과/5개 실패였다. 네 개는 공통 GET의 안전한 권한 안내로 바뀐 문구 차이였고 한 개는 확인창 중 폴링까지 멈추어 최신 버전 대조가 실행되지 않는 회귀였다. 해당 안내 단언과 실제 확인/전송 구분을 수정해 집중 17개가 통과했다. 확인창 중 서버 상태 관찰을 유지하고 전송/업로드 중에만 폴링을 보류한다.
- 첫 일정 전체 검사는 125개 통과/댓글 비교 4개 실패였다. 댓글 비교만 raw GET을 사용해 부모의 scope 잠금이 복구되지 않는 회귀를 발견했다. 댓글 비교도 같은 읽기 경로로 연결하고 원래 계정의 검증된 복구를 전달했다. 삭제 댓글에 첨부가 남는 합성 fixture는 실제 서버의 해제 정책에 맞췄고 검증을 완화하지 않았다. 이후 댓글/상세 집중 12개와 일정 전체 129개가 통과했다(`artifacts/browser-schedule-detail-final`, 2.1분).
- 마지막 타입/React 빌드, 일정 단위 137개와 루트 공통/계약/DOM/생성기/CI 정책 229개가 통과했다. 구조 변이 검사는 상세 응답/계정/관찰 경계와 private GET/폴링 복원을 검출한다. 136개 앱 UI 소스·44개 페이지·공통 생성 바이트와 최초 여섯 import ancestry/tree·21개 보관 ref, diff 공백을 확인했다. native 부채 115회/91개 서명 및 허용 목록은 늘리지 않았다.
- 모바일 다크 오류/초안과 PC 라이트 재확인 화면을 직접 보면서 부정확한 기본 ‘표시할 내용 없음’ 제목을 ‘작성 중인 내용’으로 고쳤다. 실패 후 남아 있던 로딩 fallback도 제거하고 공통 상태만 표시한다. 해당 최종 UI 코드로 일정 전체 Chrome 129개가 다시 통과했다(`artifacts/browser-schedule-detail-final-ui`, 2.5분). 최종 캡처를 직접 확인했고 루트 229개·일정 단위 137개 재실행도 모두 통과했다.
- 합성 HTTP와 로컬 Chrome만 사용했다. 공통 런타임/CSS·서버/DB·운영 환경/Docker·원본/원격 저장소는 변경하지 않았다. 업무/상태 변경·업로드의 저장 수명주기, dialog 프레임·기타 앱 UI 및 원격 보호·산출물/독립 배포/롤백은 남아 있으며 전체 목표는 진행 중이다.

## 74차: 공휴일 관리의 실제 공통 폼 연결 (2026-09-11)

- `holiday-settings.js`에서 직접 추가/수정·삭제·JSON/온라인 가져오기를 공통 폼·확인창·상태·문서 작업 세션에 연결했다. 확인 전 lease와 입력/계정/기준값을 캡처하고 JSON digest 준비/확인 후에도 대조한다. 하나의 작업 중에는 다른 쓰기/연도 조회를 잠그며 native 삭제 confirm을 제거했다.
- `holiday-contract.js`는 정확한 Int64 ID·달력 날짜·전체 연도 목록, Add/Delete의 대상 외 행 보존, 가져오기 입력 digest/덮어쓰기·정규화된 적용 목록/건수·기존/신규 ID를 검증한다. 실제 변경 없이 건너뛰는 정상 응답은 같은 stateToken을 허용한다. 원문 JSON을 파싱/재직렬화하지 않으며 서버가 해석한 적용 목록과 외부 공휴일 자체의 정확성 검증을 구분한다.
- 최초/후속 목록은 같은 `_HolidayRow`를 사용하고 공휴일명을 HTML로 삽입하지 않는다. 저장 후 대상 연도 목록을 표시하되 다른 폼의 연도·날짜·이름·체크박스·JSON 원문은 유지한다. 연도 조회는 확인된 전체 스냅샷의 로컬 필터이며 새 탭 서버 조회와 구분한다. 저장된 Add/JSON의 그대로인 재제출을 막고 온라인은 명시적 재확인 후 다시 조회할 수 있다.
- invalid는 교정 가능하고 나머지 거부/충돌/손상/통신/timeout은 원문을 보관하며 문서 쓰기를 잠근다. 계정 변경에는 이전 입력/목록을 지우고 화면/폼 제거·pagehide 및 취소를 무시하는 늦은 응답은 반영하지 않는다. native 실패 잠금/원문/링크는 유지한다. DB/감사/외부 보정·서버 기준값 정책은 이번 단계에서 변경하지 않았다.
- 실제 격리 서버/Razor 191개와 공휴일/native 브라우저 집중 31개가 통과했다(`artifacts/browser-leave-holiday-shared`, 18.7초). 서버가 만든 순차 Add/update/Delete 및 JSON skip/overwrite/repeated/online 응답을 사용한다. 모바일 다크 저장 결과와 PC 라이트 가져오기/JSON 원문을 직접 확인했다. 합성 HTTP·SQLite만 사용하며 운영 공휴일 API/DB를 호출하지 않았다.
- 루트 검사의 첫 실행은 228개 중 227개 통과/1개 실패였다. 구조 검사에서 oldIds 변수 이름만 확인해 선언을 제거한 변이를 검출하지 못했다. 선언과 실제 중복 ID 판정을 각각 검사하도록 강화했으며 이후 루트 228개가 모두 통과했다. 실제 응답 검증을 약화하거나 실패를 성공으로 소급하지 않았다.
- 마지막 런타임/페이지 코드의 연차 전체 Chrome 493개가 모두 통과했다(`artifacts/browser-leave-holiday-shared-all`, 5.4분). 기존 연차 신청·승인·달력·감사·보정/정산·개인/채널 알림과 새 공휴일 공통 작업을 포함한다.
- 135개 UI 소스·44개 페이지·공통 생성 바이트와 diff 공백을 확인했다. 감소 전용 prune으로 native confirm 1회를 제거해 부채는 115회/91개 서명이다. 허용 목록을 늘리지 않았다. 지침·계약·앱/개발/구조 문서와 완료 점검표를 갱신했다. 공통 런타임/CSS는 변경하지 않았으며 다른 서비스 전체/운영 검증으로 확대하지 않는다.
- 남은 일정 업무 저장/상세·연차 날짜 상세 프레임·기타 UI, 원격 필수 보호·독립 빌드/배포·롤백/운영 이관은 계속 진행 대상이다. 원격/원본 저장소·운영 환경/Docker 변경은 하지 않았고 전체 목표는 진행 중이다.

## 73차: 공휴일 저장 서버 계약과 native 실패 복구 (2026-09-11)

- 공휴일 Add/Delete/ImportJson/ImportOnline에 공통 `workspace-form-v1` 응답을 추가하고 `Holidays.Protocol.cs`로 계정·전체 연도 기준값·입력/응답·실패 처리를 분리했다. 표시 중인 연도와 실제 제출 연도가 달라도 전체 기준값으로 대조한다. 날짜/ID 순서의 문자열 Int64 목록, 입력 원문 digest, 실제 적용 날짜/이름과 created/updated/skipped를 반환한다. 변경 없는 저장/가져오기는 같은 hash일 수 있다.
- 기존 파싱·날짜별 이름 합치기·덮어쓰기/건너뜀·온라인 원 공휴일/대체휴무 보정과 DB/감사 경계를 유지했다. 외부 조회가 끝난 뒤 첫 쓰기 전에 제출 기준값을 다시 검사한다. 422는 알려진 입력/저장 전 조회 실패, 409는 대상/계정/기준값 충돌, 502 unknown은 쓰기 시작 뒤 실패다. 감사 실패를 DB 롤백으로 안내하지 않고 내부 예외를 사용자 응답에서 제거했다.
- native 오류는 원문 양식을 유지하고 unknown/conflict에 전체 fieldset 잠금·새 탭 목록 링크를 제공한다. JSON 원문은 Razor 인코딩 그대로 유지하며 실패 시 성공 안내를 함께 띄우지 않는다. 구형 native 기준값 없는 POST 호환·CSRF/AdminOnly는 유지한다. 현재 실제 폼은 아직 native POST/confirm이며 공통 클라이언트 수명주기 전환 완료로 보고하지 않는다.
- 공휴일 전용 격리 테스트 28개를 추가했다. 실제 SSO/SQLite·합성 HTTP에서 큰 ID/전체 연도 보존·추가/기존 이름 수정/삭제·JSON 정규화/집계·체크박스 true,false·중복 scalar·입력/CSRF/직원 POST 거부·외부 조회 중 변경·저장 후 감사 실패/native 원문을 검증한다. 최종 서버/Razor 준비 191개가 통과했다. 이전 187개 결과는 보강 전 실행이며 최종 근거로 대체했다.
- 루트 계약/DOM/생성기/CI 정책 224개와 공통 자산 바이트·132개 UI 소스/44개 페이지·diff 공백을 확인했다. 기존 primitive 부채는 116회/92개 서명으로 같고 새 예외는 없다. `checkHolidayProtocol`과 변이는 대표 계약 누락을 검출하지만 완전한 인가/경쟁 증명이나 DB CAS/멱등성을 제공하지 않는다.
- 실제 서버의 native 실패 화면 4개와 기존 관리자 설정 컨트롤 8개가 통과했다(`artifacts/browser-leave-holiday-server`, 9.9초). 모바일 다크의 오류/조회 안내와 PC 라이트의 잠긴 입력/JSON 원문을 직접 확인했다. 공통 CSS/런타임은 변경하지 않았으며 실제 운영 공휴일 API/DB/계정에 접근하지 않았다.
- 마지막 코드의 연차 전체 Chrome 회귀 466개가 모두 통과했다(`artifacts/browser-leave-holiday-all`, 4.9분). 다른 다섯 서비스 전체 브라우저 검사나 운영 연계 검증으로 확대하지 않는다.
- 계약·지침·구조/개발/앱 문서와 완료 점검표를 갱신했다. 다음은 실제 공휴일 폼의 공통 확인/저장/독립 초안/계정·늦은 응답 연결이다. 일정 raw 쓰기/상세·나머지 UI, 원격 보호·독립 배포/롤백/운영 이관도 남는다. 원격/원본 저장소·운영 환경/Docker는 변경하지 않았고 전체 목표는 진행 중이다.

## 72차: 연차 채널 설정의 공통 확인·저장 수명주기 (2026-09-11)

- 채널 웹훅 등록/삭제/테스트를 `CompanyForm`·`CompanyDialog`·`CompanyState`와 문서 작업 세션에 연결했다. 현재 관리자와 전체 목록 기준값, 문자열 Int64 ID·등록 URL digest·정확한 목록/처리 응답을 대조한 뒤 같은 `_WebhookRow`로 갱신한다. 삭제/테스트가 다른 추가 초안을 지우지 않으며 확인 취소·입력 변경은 전송하지 않는다.
- 테스트는 서버가 확인한 바로 그 수신처 목록으로 발송한다. 일부 외부 발송/업무 저장 뒤 감사 실패를 롤백으로 안내하지 않고 unknown 잠금과 새 탭 확인을 제공한다. 서버 native 실패에도 잠금/조회 링크와 허용된 입력을 보존했다. 목록/확인창/오류에 웹훅 토큰·내부 예외를 노출하지 않으며 기존 일반 알림·인가·CSRF·DB 경계는 유지한다. 새 DB CAS/영구 멱등성을 구현했다고 주장하지 않는다.
- 실제 격리 SSO/SQLite·합성 HTTP의 서버/Razor 검사 163개가 최종 통과했다. 등록/삭제/정확한 발송·큰 ID·stale/invalid·직원 POST 거부·CSRF·native·부분 발송·감사 실패를 포함한다. 루트 공통 계약/DOM/생성기/CI 정책 223개도 다시 통과했다. 실제 운영 Discord/DB/계정은 사용하지 않았다.
- 연차 전체 Chrome 462개가 통과했다(`artifacts/browser-leave-webhooks-all`, 5.1분). 최종 native 실패 링크까지 포함해 Razor 자료를 재생성하고 채널 집중 23개를 다시 통과했다(`artifacts/browser-leave-webhooks-verified`, 15.2초). 이전 관찰 결과가 유실된 실행은 프로세스 종료와 결과 파일을 확인한 후에만 재검증했으며 진행 중 작업을 중복 실행하지 않았다.
- PC/모바일·두 테마의 확인/순차 작업, 초안 유지, 손상/권한/충돌·timeout·계정 변경·화면/폼 제거·취소를 무시하는 늦은 응답을 검사한다. 초기 22개 실행의 15개 실패는 fieldset 자체에 대한 Playwright disabled 단언 오류였으며 실제 disabled 속성과 하위 버튼 비활성 검증으로 고쳤다. 이를 성공으로 소급하지 않았다. 실제 화면에서 결과 안내가 고정 상단바에 가리는 문제를 보완하고 위치 단언을 추가했으며 최종 PC/모바일 다크 저장 화면을 직접 확인했다.
- 구조 검사에 공통 연결/정확한 발송 목록 누락과 raw 전송/확인 재도입의 변이를 추가했다. 132개 UI 소스·44개 페이지에서 부채는 116회/92개 서명이며 예외를 늘리지 않았다. 공통 CSS/런타임은 변경하지 않았고 이번 검사를 다른 다섯 서비스 전체 회귀나 운영 검증으로 확대하지 않는다.
- 계약·지침·개발/구조/앱 문서와 완료 점검표를 갱신했다. 공휴일 native 폼·일정 raw 업무 저장/상세·나머지 UI 및 원격 보호·독립 배포/롤백·운영 이관은 남는다. 원격 대상/이전 계획 확정 전 새 저장소 게시·푸시·원본 저장소/운영 checkout·환경/Docker 변경은 하지 않았다. 전체 목표는 진행 중이다.

## 71차: 연차 공휴일·채널 설정 공통 컨트롤 (2026-09-11)

- 공휴일 온라인/JSON 가져오기·직접 추가·연도 조회와 웹훅 추가/테스트/삭제의 일반 입력·버튼·표를 공통 primitive로 연결했다. 공통 필드 그리드·내부 표 스크롤을 사용하고 페이지별 입력/다크 색 및 사용하지 않는 웹훅 필드 배치를 제거했다. 가져오기 양식의 중복 DOM ID를 분리하되 native 전송 이름·JSON 원문·handler/CSRF/min/max/required·마스킹·서버 인가는 유지했다.
- 실제 화면 확인에서 JSON 고정폭 글꼴이 공통 font에 덮이는 것을 발견해 해당 편집기의 글꼴만 명시적으로 보존했다. 재검사한 PC/모바일·두 테마 집중 8개가 통과했다(`artifacts/browser-leave-admin-controls-final`). PC 라이트/다크, 모바일 라이트/다크의 필드·표 및 최종 모바일 다크 JSON을 직접 확인했다.
- 격리 서버/Razor 준비 154개, 루트 공통/생성기/CI 정책 219개, 연차 전체 Chrome 439개가 통과했다(`artifacts/browser-leave-admin-controls-all`, 4.9분). 마지막 JSON 글꼴 보완은 전체 실행의 공휴일 화면 시나리오 전에 반영했고 집중 8개도 별도로 재실행했다. 웹훅 테스트는 미설정 disabled 시나리오이며 외부 발송 성공/운영 검증으로 주장하지 않는다.
- 감소 전용 prune은 19회/15개 서명을 제거해 117회/93개 부채를 남겼다. 공통 자산 원본/생성 바이트는 변경하지 않았고 130개 UI 소스·44개 페이지·diff 공백을 확인했다. 계약·지침·구조/개발/Leave 문서와 완료 점검표에 실제 전환 범위를 기록했다.
- 기존 공휴일·웹훅 native POST/삭제 confirm/HTML 결과와 외부 조회·발송/감사 경계는 공통 폼·확인·상태 수명주기로 아직 전환해야 한다. checkbox/요약 카드와 다른 서비스의 남은 UI/업무 전송도 미완료다. 운영 DB/웹훅/API/환경/Docker·원본 저장소·원격을 변경하지 않았다. 전체 목표는 계속 진행 중이다.

## 70차: 일정 초기 정보·보드의 공통 조회 계약 (2026-09-11)

- `CompanyReadSession`과 생성 React 어댑터를 추가하고 실제 Schedule bootstrap/주간/칸반/날짜 미정 목록을 연결했다. 채널별 교체·취소 무시/늦은 JSON·30초 관찰을 공통으로 처리하며 앱은 계정/조건·주별 캐시·페이지 전체 응답을 검증한다. 사용하지 않는 raw `fetchWeek` 기본 경로도 제거해 cache helper에 검증된 fetcher를 필수로 전달한다.
- 같은 조건의 조회 실패는 정상 목록을 유지하고 조건 변경은 이전 목록을 숨긴다. 계정/권한/pagehide는 보드를 무효화한다. 기존 편집 초안과 동일 계정의 명시적 검토는 유지하되 내비게이션으로 이전 계정의 새 편집기를 만들지 않는다. 새 댓글의 범위 변경 잠금과 기존 댓글 비교 적용 이후의 명시적 재개를 보완했다. 서버 DB·인가·URL·기존 쓰기 API는 변경하지 않았다.
- 초기 브라우저 116개 중 6개에서 과도한 내비게이션/후속 조회 잠금 및 댓글 권한 전파 문제를 확인했다. 기존 편집 회귀를 수정했고 이후 121개 실행은 120개 통과/timeout 안내 1개 실패였다. timeout 뒤 폴링이 오류를 지우는 문제를 수정한 집중 5개는 통과했다(`artifacts/browser-schedule-reads-focused`). 초기 실패를 통과로 기록하지 않는다.
- Schedule 단위 124개와 타입/실제 React 빌드, 루트 공통 계약/DOM/생성기/CI 정책 219개, 격리 서버/Razor 통합 154개가 통과했다. 공통 연결/응답 검증 삭제와 raw 초기 조회 복원을 검사하는 `checkScheduleReads` 및 변이 검사를 추가했다. 최종 캐시 기본 경로 제거 뒤 Schedule 단위/빌드를 다시 통과했다.
- 모바일 다크·PC 라이트의 조회 실패/정상 목록 보존과 PC 다크·모바일 라이트의 권한 없음 화면을 직접 확인했다. Sheet/Schedule/Razor 준비 후 여섯 앱 Chrome 988개가 모두 통과했다(`artifacts/browser-schedule-shared-reads-all`, 16.2분). 일정 121개와 강화된 실제 `.personal-todos` 생성 금지 단언을 포함한다. 마지막 캐시 기본 경로 제거 후의 일정 번들은 전체 실행에서 Schedule 시나리오 시작 전에 빌드했고 해당 최종 번들로 검증했다. 시트 번역과 통계 확인창의 모바일 다크 화면도 확인했다. 이는 운영 SSO·업무 데이터·배포 확인이 아니다.
- 생성 바이트·130개 앱 UI 소스·44개 페이지와 원본 여섯 ancestry/exact import tree/21개 archive ref 및 diff 공백을 확인했다. 기존 primitive 부채는 136회/108개 서명이며 새 예외는 늘리지 않았다. 계약·AGENTS·README·구조/개발 문서에 소유권과 남은 범위를 명시했다.
- 다른 서비스의 기존 읽기 구현, 일정 상세/업무·댓글·업로드 저장 및 dialog/checkbox/range, 다른 앱의 남은 UI와 원격 보호·출처·독립 배포/롤백·운영 이관은 미완료다. 원격 생성·푸시·운영 환경/Docker/원본 저장소 변경은 하지 않았다. 전체 목표는 계속 진행 중이다.
- `GOAL-READINESS.md`에 목표별 코드 근거·간접 증거·남은 판정과 다음 순서를 분리했다. 원격 대상(조직/계정·이름·공개 범위)은 사용자에게 확인 요청했으며 확정 전 변경하지 않는다.

## 69차: 일정 기록 카드·셀 등록 공통 UI (2026-09-11)

- 공통 native 버튼에 record 강조와 overlay 배치를 추가하고 업무/주요 일정 카드·PC 셀 전체 등록을 연결했다. 프로젝트/유형 색은 --record-accent로 전달하며 목표/실현은 low/high 강조와 기존 점선/실선으로 구분한다. 개별 task-card/milestone-chip/cell-add의 배경·hover·비활성 덮어쓰기를 제거했다. 업무 상세·주요 일정 관리 진입·칸반 dragstart ID와 모바일 등록 방식을 보존했다.
- 집중 검사에서 record low/high 선택자의 specificity가 disabled를 덮는 실제 공통 CSS 문제를 발견해 :where로 우선순위를 낮췄다. 주요 일정 닫기 이름 오인과 pointer 클릭 후 programmatic focus를 focus-visible로 가정한 테스트 오류도 수정했다. 실제 Tab/Shift+Tab으로 셀에 진입하여 힌트·내부 윤곽·셀 전체 크기와 정확한 직원/날짜를 검증한다. 최종 집중 4개는 통과했다(artifacts/browser-record-keyboard).
- PC 라이트/다크의 목표·실현 카드, 모바일 다크 카드, PC 라이트 칸반의 실제 viewport를 직접 확인했다. Schedule 단위 111개 및 루트 계약/DOM/생성기/CI 정책 215개가 통과했다. Sheet/Schedule 번들과 격리 Razor 브라우저 자료를 준비한 뒤 실제 Chrome 여섯 서비스 전체 983개가 통과했다(artifacts/browser-record-controls-all, 14.6분). 일정 116개를 포함하며 CS·연차·회사 계정·시트·통계의 기존 회귀도 유지한다. CS 상품 화면·연차 감사 상세·Portal 기존 계정 상세·시트 개요·통계 확인창의 다크 캡처도 직접 확인했다.
- 공통 생성 바이트·128개 앱 UI 소스·44개 페이지 및 원본 여섯 ancestry/exact import tree/21개 archive ref를 확인했다. 감소 전용 prune으로 3회/3개 서명을 제거해 137회/109개가 남고 예외는 늘리지 않았다. 계약·AGENTS·README·구조/개발 문서를 갱신했다.
- checkbox/range·표식·초기/읽기 상태·raw 업무/상태/업로드 저장 수명주기와 편집 dialog 프레임, 다른 앱의 남은 UI 및 원격 보호·출처/독립 배포·롤백/운영 이관은 미완료다. 합성 HTTP만 사용하며 실제 업무/계정/DB·환경/Docker·원본 저장소/원격은 변경하지 않았다. 공통 스타일 검증은 전체 업무 저장·운영 배포의 증거가 아니다.

## 68차: 일정 보드 작업·범례 공통 UI (2026-09-11)

- WeekBoard의 전체/개별/그룹 업무 펼침·주요 일정 밀도·집중 보기·기간 읽기·모바일 날짜별 등록 버튼을 공통 primitive로 전환했다. 의미 있는 aria-expanded/aria-pressed/disabled를 유지하고 밀집 보드에는 compact 32px을 사용한다. 이름/부서와 접기 버튼이 겹치지 않게 예전 절대 위치와 예약 여백을 제거했다.
- 색상 안내를 generated disclosure의 독립 보드 루트에 연결하고 모바일에서도 사용할 수 있게 했다. 상위 보기 설정과 별도로 hidden/ARIA를 공통 소유하며 범례 내용과 주말/공휴일·부서·목표/실현 의미를 유지한다. 비모달 펼치기이며 모달 수명주기를 새로 구현하지 않는다. 실제 업무 전개는 visibleLanes와 직원별 반전 집합의 도메인 배치를 그대로 사용한다.
- 최초 집중 검사는 3개 통과/PC 다크 1개 실패로, 옛 theme.css의 expand-person 색이 공통 접기 버튼을 덮어쓰는 것을 발견했다. 실제 소비자가 모두 공통 버튼임을 확인하고 해당 복제 색 규칙을 제거했다. 이후 집중 4개가 통과했다. 카드나 셀 전체 등록 overlay까지 일반 버튼으로 허위 전환하지 않았다.
- 최종 타입/React 빌드·일정 단위 111개·루트 계약/DOM/생성기/CI 정책 215개와 실제 Chrome 일정 전체 112개가 통과했다(artifacts/browser-schedule-board-actions-final, 2.1분). 겹친 4개 업무·개별/전체/그룹 전개, 주요 일정 밀도, 집중 보기 왕복, 지연 GET의 중복 클릭 차단, 모바일 등록의 정확한 직원/날짜, 키보드 범례·계산 색/32px·문서 넘침을 검사한다. PC 라이트/다크 펼친 업무와 모바일 다크 범례/집중 보기의 실제 viewport를 직접 확인했다.
- 공통 생성 바이트·128개 앱 UI 소스·44개 페이지, 원본 여섯 ancestry/exact import tree/21개 archive ref 및 diff 공백을 확인했다. 감소 전용 prune으로 11회/10개 서명을 제거해 140회/112개가 남고 예외는 늘리지 않았다. 계약·AGENTS·README·구조/개발 문서를 갱신했다.
- 업무/주요 일정 카드·셀 overlay·checkbox/range·초기/읽기 상태와 raw 쓰기 수명주기, 다른 앱의 남은 UI 및 원격 보호·출처/독립 배포·롤백/운영 이관은 미완료다. 공통 런타임/CSS는 바꾸지 않았고 여섯 앱 전체 브라우저 재검증으로 주장하지 않는다. 합성 HTTP만 사용했으며 운영 계정/DB·환경/Docker·원본 저장소/원격은 변경하지 않았다.

## 67차: 팀 일정 탐색·필터 공통 컨트롤 (2026-09-11)

- 주간 일정/칸반의 분류·업무 등록·주 이동·표시 기간·내 일정·부서/직원/프로젝트 필터·날짜 미정·더 보기·주말 안내와 칸반 상태 입력을 공통 primitive에 연결했다. 분류/내 일정/날짜 미정의 실제 aria-pressed와 기존 native query·ID·API·URL을 유지했다. 감소 전용 prune으로 15회/15개 서명을 제거해 151회/122개 부채가 남으며 허용 목록을 늘리지 않았다.
- 보기 설정을 generated useWorkspaceDisclosure에 연결했다. React는 본문/업무 값과 왕복 시 펼침 선호만 유지하며 hidden/ARIA는 공통 컨트롤러가 소유한다. 날짜 미정·칸반에서 외부 slot만 숨기고 개인 TODO 왕복 후 공통 API로 이전 펼침을 복원한다. 접기/필터 변경으로 행 높이·상세·목표/실현 선택을 초기화하지 않는다.
- 개별 toolbar/grouping/select 크기·색 규칙을 제거했다. 실제 화면에서 발견한 모바일 날짜 잘림·detail.css의 select 46% 폭 제한과 칸반 metadata 안의 상태 입력 축소를 보완했다. 필터 전체 폭·날짜 내부 넘침·상태 입력 최소 120px을 회귀 단언에 추가했다.
- 신규 브라우저 시나리오는 320/1440px × 두 테마에서 실제 GET 필터/날짜 기준, 초성 프로젝트 검색·포커스, 선택 계산 색·44px·라벨, 기간/분류 저장, 보기 설정 DOM/값 유지·날짜 미정/칸반/TODO 왕복을 검증한다. 최초 집중 4개 실패는 필드가 없는 칸반 toolbar에도 최소 필드 1개를 요구한 테스트 오류였으며 존재하는 필드 검증은 유지하고 해당 루트만 최소 0개로 명시했다. 이후 집중 4개와 날짜/필터 보완 집중 4개, 첫 전체 108개가 통과했다.
- 최종 타입/React 빌드와 일정 단위 111개, 루트 계약/DOM/생성기/CI 정책 215개가 통과했다. 최종 칸반 상태 입력 배치 보완까지 포함한 Chrome 전체 108개도 통과했다(artifacts/browser-schedule-board-controls-final-layout, 1.7분). 원본 여섯 ancestry/exact import tree/21개 archive ref 및 공통 생성 바이트·128개 앱 UI 소스·44개 페이지를 확인했다.
- PC 라이트·모바일 다크의 주간 일정/칸반 viewport를 직접 확인했다. 합성 HTTP만 사용했고 운영 계정/DB·원본 저장소·원격·Docker는 변경하지 않았다. schedule-board-controls.md, AGENTS/README 및 구조·개발 문서를 갱신했다.
- checkbox/switch/range·WeekBoard 카드/행/집중 보기·초기/읽기 오류 안내와 raw 상태 PATCH/일부 업무 저장 수명주기, 다른 앱의 남은 UI·원격 필수 보호/출처·독립 배포·롤백/운영 이관은 미완료다. 공통 런타임/CSS 자체를 바꾸지 않았으며 여섯 앱 전체 브라우저 검증이나 전체 목표 완료를 주장하지 않는다.

## 66차: 팀 일정 날짜 이동·달력 내부 공통 컨트롤 (2026-09-11)

- DateNavigation의 날짜 범위 진입/직접 입력/취소/이동과 DatePicker popup의 연도·월·월 이동·날짜·닫기/지우기/오늘을 공통 primitive로 전환했다. 날짜 선택·비활성·hover CSS 복제를 제거하고 실제 aria-pressed/disabled를 사용한다. 기존 모달 프레임과 날짜/공휴일 조회 로직은 유지한다.
- 7열·6주와 휴일명을 위한 52px 셀 높이는 앱 기하로 남기고 토요일/일요일·공휴일의 숫자/범례에 공통 accent/danger 의미 색을 사용한다. 선택·비활성에는 공통 상태 색이 우선하며 오늘은 aria-current/밑줄, 다른 달은 muted 숫자로 구분한다. 공휴일 읽기 중/실패·재시도도 WorkspaceState에 연결했다.
- 첫 집중 4개는 테스트가 연도 입력의 실제 blur 확정을 생략해 윤일 버튼을 찾지 못했다. Tab 확정을 추가했고 초기 실패를 통과로 바꾸지 않았다. 화면 확인에서는 모바일 연도 4자리 잘림을 발견해 기본 dialog max-width와 월 이동 버튼/연도 필드 폭을 보완했으며 최소 88px 검사를 추가했다.
- 실제 Chrome 일정 전체 104개가 통과했다(`artifacts/browser-schedule-calendar-controls-final`, 1.5분). 마지막 토요일/공휴일 계산 색 단언을 보강한 집중 4개도 통과했다(`artifacts/browser-schedule-calendar-controls-colors`, 8.3초). 잘못된 날짜 제출 차단·윤일·시작일 초기화·주 이동·종료일 하한·지우기·중첩 Escape와 포커스 복귀·공휴일 실패/재시도를 포함한다. PC 라이트/모바일 다크 달력과 모바일 라이트 실패 안내를 직접 확인했다.
- 최종 일정 단위 111개·타입/React 배포 빌드와 루트 공통 계약/DOM/생성기/CI 정책 215개가 통과했다. 원본 여섯 ancestry/exact import tree/21개 archive ref, 공통 생성 바이트·128개 앱 UI 소스·44개 페이지 및 diff 공백도 확인했다. 감소 전용 prune으로 12회/12개 서명을 제거해 부채 166회/137개가 남으며 예외를 늘리지 않았다.
- 계약/AGENTS/README·구조/개발 문서를 갱신했다. 모달 프레임/공통 dialog 중첩 수명주기, 공휴일 전체 응답/계정 범위와 남은 앱별 폼·UI, 원격 필수 보호·출처/독립 배포·롤백/운영 이관은 여전히 미완료다. 이번에는 앱 CSS만 변경했고 여섯 앱 전체 브라우저 재검증으로 주장하지 않는다. 운영 계정/DB·원격/원본 저장소·Docker는 변경하지 않았으며 전체 목표를 계속 진행한다.

## 65차: 팀 일정 주요 일정 관리·보관함 공통 컨트롤 (2026-09-11)

- Settings의 신규/기존 주요 일정 필드·날짜 조회·프로젝트 선택·작업 버튼을 공통 primitive에 연결했다. 실제 aria-pressed로 주요 일정/보관함 및 목록 선택 상태를 표현하고 저장/삭제/닫기는 공통 primary/danger/quiet를 사용한다. 개별 오류·버전 충돌·빈 결과 안내는 WorkspaceState로 전환했다.
- 주요 일정/보관함 카드는 content 버튼으로 통합하고 날짜·프로젝트·유형·제목의 기하만 `settings.css`에서 관리한다. 옛 settings-list의 버튼 padding/색·flex 복제를 제거했다. 긴 제목과 공백 없는 보관 업무 제목을 모바일에서 줄바꿈하고 프로젝트 표시·일정 유형 badge는 기존 도메인 정보를 유지한다.
- 실제 합성 HTTP 검사를 4개 추가해 기존 PUT/신규 POST/DELETE의 ID·버전·타입·날짜·프로젝트·64비트 원문 문자열, 충돌 뒤 초안 및 최신값 선택 취소/적용, 저장 중 비활성, 삭제 취소/실행과 보관함→업무 URL을 검증했다. fake 성공 응답으로 서버 저장/원자성·미확정 결과까지 검증한 것은 아니다.
- 단위 111개와 타입 검사/React 배포 빌드, 루트 공통 계약/DOM/생성기/CI 정책 215개가 통과했다. 집중 4개와 초기 전체 100개, 충돌 보강 4개 이후 마지막 보관함 제목 변경까지 포함한 Chrome 전체 100개가 통과했다(`artifacts/browser-schedule-management-controls-final-archive`, 1.4분). PC 라이트·모바일 다크 주요 일정/편집 화면과 최종 모바일 다크 보관함을 직접 확인했다.
- 실제 계산 색·일반 44px·선택/비활성 및 문서 넘침을 검사했다. 원본 여섯 ancestry/exact import tree/21개 archive ref, 생성 자산·128개 앱 UI 소스·44개 페이지와 diff 공백을 확인했다. 감소 전용 prune으로 14회/14개 서명을 제거하여 기존 부채는 178회/149개다. 기존 dialog 태그 변경은 검사에서 거부되어 프레임을 그대로 보존하고 본문에만 범위 클래스를 적용했으며 예외를 늘리지 않았다.
- 공통 UI 계약/AGENTS/README/구조·개발 문서를 갱신했다. 주요 일정의 raw 읽기/저장 수명주기·전체 ACK·미확정/늦은 응답, 동기 확인 및 편집 dialog/달력 popup·다른 앱의 남은 UI, 원격 보호/출처·독립 배포/롤백·운영 이관은 미완료다. 원격 게시·원본 저장소나 운영 DB/환경/Docker는 변경하지 않았다. 공통 런타임/CSS 자체를 바꾸지 않았으며 여섯 앱 전체 브라우저 재검증이나 목표 완료를 주장하지 않는다.

## 64차: 팀 일정 업무·댓글 편집 공통 컨트롤 (2026-09-11)

- 업무 신규/수정/상세의 제목·담당자·프로젝트·상태·날짜와 본문/새 댓글/기존 댓글/답글 Editor를 공통 필드·버튼으로 연결했다. 이미지 추가/확대/제거, 댓글 행 작업·저장·취소도 같은 primitive를 사용한다. 기존 API·멘션 ID/원문·첨부·확인/충돌 비교·초안 동작은 유지했다.
- 날짜 입력과 달력 열기 버튼은 겹치는 절대 위치 대신 flex 간격을 사용한다. 실제 입력/버튼 높이·날짜 입력 폭·모바일 넘침을 단언한다. popup 달력 내부와 task/lightbox 프레임은 아직 별도이며 일반 입력의 전환과 혼동하지 않는다.
- 개별 editor/comment-actions의 배경·테두리·버튼 크기 덮어쓰기를 제거했다. 실제 화면 확인에서 공통 필드 기본값 때문에 본문 편집 높이가 70px로 줄어든 것을 발견해 앱 소유 편집 기하 140px을 복원하고 회귀 단언을 추가했다. 최초 스타일 집중 8개 통과만으로 시각 검증 완료를 판단하지 않았다.
- 팀 일정 단위 111개·타입 검사/React 배포 빌드, 루트 계약/DOM/생성기/CI 정책 215개를 통과했다. 최종 실제 번들의 Chrome 일정 전체 96개가 통과했다(`artifacts/browser-schedule-task-controls-final`, 1.4분). 기존 96개 초기 실행과 스타일 집중 8개도 통과했으며 최종 전체 실행은 마지막 편집 높이 수정과 이미지 확대/닫기 포커스 검증을 포함한다.
- PC 라이트 업무 편집, 모바일 다크 본문, PC 다크·모바일 라이트 댓글 편집의 실제 viewport를 직접 확인했다. 계산 색/라벨·44px/compact 크기·비활성과 기존 충돌/멘션/첨부/명시적 저장을 함께 검사한다. 합성 HTTP만 사용하며 운영 업무·댓글·DB나 실제 첨부에 쓰기를 보내지 않았다. 공통 런타임/CSS 자체를 바꾸지 않아 여섯 앱 전체 브라우저 재검증으로 보고하지 않는다.
- 감소 전용 prune으로 26회/26개 서명을 제거해 부채 192회/163개가 남는다. 공통 생성 바이트·128개 앱 UI 소스·44개 페이지·diff 공백과 원본 여섯 ancestry/exact import tree/21개 archive ref를 확인했다. `schedule-task-controls.md` 및 AGENTS·앱 README·구조/개발/필드 문서를 갱신했다.
- raw 업무 저장/상태 변경/업로드의 요청 수명주기, 동기 이탈 확인·달력 popup/편집창 프레임과 나머지 앱별 UI는 아직 남는다. 원격 필수 보호·출처·독립 배포/롤백·운영 이관도 미완료다. 새 원격 생성·푸시·원본 저장소/운영 환경/Docker 전환은 하지 않았으며 전체 목표는 계속 진행 중이다.

## 2026-09-10 기준 조사

| 앱 | 원본 폴더 | 원본 GitHub 저장소 |
| --- | --- | --- |
| portal | company-portal | company-org/company-portal |
| leave | LeaveManager | company-org/leave-system |
| schedule | schedule | company-org/schedule |
| cs | CS | company-org/CS |
| statistics | statistics | company-org/statistics |
| sheet | sheet | company-org/sheet |

원본 작업 트리는 조사 시 모두 clean이었다. Portal/IAP 연계, 일정 개인 할 일, CS diff 보정이 최근 추가되어 과거 대화의 커밋을 기준으로 가져오지 않는다. 가져온 정확한 커밋·파일 트리·ref는 `migration-sources.json`에 기록한다.

## 이력 보존 방식

`tooling/import-repositories.mjs`는 원본을 이동하거나 수정하지 않고 각 main 트리를 apps 아래에 가져온다. squash/rebase/filter 없이 원본 main을 통합 커밋의 부모로 연결한다. 다른 로컬 브랜치와 태그도 source 이름 공간에 가져온다. 최초 원본 경로의 이력은 `git log <원본 커밋>`으로 조회 가능하며 이관 이후 경로별 이력과 다름을 명시한다.

원본에 미커밋 변경이 생기면 자동 진행하지 않고 중단한다. ignored 운영 .env/DB/백업은 가져오지 않는다. 원격 게시 전에는 현재 파일뿐 아니라 가져온 과거 이력도 비밀값 검사 대상이다.

## 운영 안전

- 기존 여섯 원격과 운영 checkout, 컨테이너, 볼륨, 터널은 유지한다.
- 새 원격의 이름·공개 범위·보호 정책을 확정하기 전 push하지 않는다.
- 기존 전체 업데이트 bat에는 reset --hard와 일부 서비스 누락이 있다. 이를 새 배포 도구로 재사용하지 않는다.
- 앱별 Compose 프로젝트 이름/볼륨 이름/네트워크/환경 파일 경로를 확인한 후 배포 연결을 변경한다. 디렉터리 이름 변경으로 새 빈 볼륨이 생성되는 것을 방지한다.
- 운영 전환은 검사 완료 커밋, DB/키 백업, 기존 이미지 식별자, 건강 상태 확인, 복구 명령을 준비한 뒤 순차 수행한다.

## 1차 시점의 체크리스트

아래는 최초 이관 당시의 상태다. 후속 전환과 검증 증거는 차수별 기록을 따른다. 최종 완료 여부는 모든 목표 항목의 별도 감사로 판단한다.

- [x] 여섯 앱 이력·트리 import 검증
- [x] 공통 UI 패키지 추출 및 생성형 페이지/사이드바
- [ ] 모든 앱 연결, 중복 제거
- [ ] 공통 선택기/계정 필드/상태 UI 계약
- [ ] 위반 검출 자동 검사와 생성기 테스트
- [ ] 앱별 빌드·테스트 및 모바일/다크/권한별 화면 검증
- [ ] 원격 저장소와 필수 CI/병합 보호 정책
- [ ] 검사된 커밋만 배포하는 경로 및 롤백 검증
- [ ] 운영 전환 및 완료 기준별 증거 감사

## 1차 기반 작업 증거 (2026-09-10)

- 여섯 원본 main 커밋이 HEAD의 조상인지, import merge의 앱 트리가 원본과 정확히 같은지, 원본 로컬 브랜치/태그 21개가 보존되었는지 `tooling/verify-import.mjs`로 확인했다.
- 공통 셸 JS·CSS·선택기를 packages로 추출하고 Portal 호환 자산을 생성하도록 변경했다. 수동 버전 갱신을 내용 해시 기반 생성으로 대체했다.
- CS 네 페이지의 중복 사이드바를 제거했다. 공통 페이지 목록에서 메뉴와 서버 경로 allowlist를 생성한다. 나머지 다섯 앱의 sidebar adapter는 아직 legacy로 명시되어 있다.
- 공통/계약/DOM/생성기 48개, CS 기존 81개, 통계 기존 39개, 일정 frontend 37개, 시트 6개, 일정 backend 25개, 세 서비스 통합 22개 테스트 통과를 확인했다. 일정·시트 frontend와 Portal·Leave·Schedule .NET Release 빌드 성공.
- 실제 Chrome CS 공통 셸 브라우저 테스트 25개 통과: 네 페이지 × 세 너비 × 두 테마 및 접근권한 없음. 도메인 모듈은 테스트에서 격리했으며 업무 처리 E2E를 완료했다는 뜻이 아니다.
- 이전 통합 테스트에 남은 company-portal/LeaveManager 경로를 새 앱 경로로 수정했다. 관리자 목록 기대값에 이미 서비스 원본에 존재하던 IAP를 반영하여 호환성을 검증했다.
- 시트 서버는 sid를 이미 발급·검증에 사용하지만 CompanyToken 타입에 누락되어 있었다. 타입과 서명 왕복 테스트를 보완하고 CI에 시트 typecheck를 추가했다. 인증 처리나 권한 정책을 변경하지 않았다.
- npm 설치 시 기존 schedule에서 moderate 2개, sheet에서 low 1개/moderate 3개 의존성 감사 경고가 나왔다. 강제 major 업데이트는 하지 않았으며 별도 조사/수정이 남아 있다.
- 원격 생성/게시, 원격 CI 실행/보호 설정, 운영 배포 전환, 전체 서비스 화면·폼·선택기 전환은 아직 수행하지 않았다.

## 2차: 통계 SPA 공통 페이지 구조 연결 (2026-09-10)

- 통계의 6개 경로(상세 2개 포함)를 공통 페이지 계약에 등록했다. 중복 메뉴 HTML과 앱 내부 경로/제목 목록을 제거하고 메뉴·SPA 라우트·서버 HTML allowlist가 동일한 원본에서 생성되도록 연결했다.
- 상세 페이지는 상위 메뉴를 활성화한다. 동적 메뉴는 기존 라우터를 사용하므로 페이지 전체 재로딩 없이 필터·뒤로/앞으로 이동을 유지한다. 인증 게이트와 통계 조회·집계 처리는 변경하지 않았다.
- 생성기는 CS와 통계 모두 지원한다. 통계 생성 시 기존 본문을 보존하며 새 view를 추가하고, 중복/예약 경로·중복 view·잘못된 상위 메뉴·누락된 본문을 검사한다. 나머지 4개 어댑터는 여전히 미완료다.
- 실제 통계 app.js를 예제 응답과 함께 실행한 브라우저 검사에서 게임 결과의 4열 고정 요약 카드가 모바일 문서를 417px로 늘리는 문제를 재현했다. 작은 화면에서 2열과 줄바꿈을 적용하여 원인을 수정했다. 문서 전체의 overflow를 숨겨 통과시키지 않았다.
- 공통 테스트 50개, 통계 테스트 40개, CS 기존 테스트 81개 및 통계 구문 검사 통과. 브라우저 기본 회귀 63개(CS 25 + 통계 38)와 데이터가 있는 빌드/보스 상세 선택·새로고침 검사 4개 통과를 확인했다. 운영 API 대신 예제 응답을 사용했으므로 운영 집계나 인증 E2E의 증거는 아니다.
- PC 다크 대시보드와 모바일 다크 요약 카드의 렌더링을 직접 확인했다. 전체 앱/전체 화면의 시각 검증 완료를 뜻하지 않는다.
- 새 원격 게시·운영 배포는 수행하지 않았다. 원본 저장소와 운영 checkout은 유지한다.

## 3차: React 연결과 시트 관리 전환 (2026-09-10)

- 공통 React adapter를 packages에 추가하고 시트의 5개 페이지에 적용했다. 앱 내부 사이드바·경로 해석·제목 목록을 제거했다. 공통 메뉴와 본문 내 링크 모두 같은 라우트 hook을 사용하며 기존 분석 상태와 뒤로/앞으로 이동을 유지한다.
- 시트 페이지 생성기는 독립 TSX 본문만 추가하고 메뉴·타입·컴포넌트 연결·서버 HTML 경로를 생성한다. 기존 App 업무 코드를 덮어쓰지 않는다. 기존 `/`, `/overview`, `/index.html` 진입을 보존했다. 업무 API의 회사 인증과 쓰기 권한 검증은 그대로 유지한다.
- React 코드에 개별 sidebar/global UI가 추가되거나 등록하지 않은 페이지 파일이 생기면 구조 검사에서 실패한다. 원본 adapter와 앱 안 generated 복사본의 차이도 검사한다. React/Razor 전체 연결 완료를 의미하지 않으며 Portal·Leave·Schedule이 남아 있다.
- 공통 표와 상태 배지 스타일을 추가하고 시트의 수식/한국어 갱신 표에 적용했다. 다크 모드에 남아 있던 밝은 표 머리글·검색창·하단을 의미별 색상으로 수정하고 표 글자 크기를 보완했다. 모바일 현재 페이지 제목과 스냅샷 행의 잘림도 수정했다.
- 시트 타입 검사·클라이언트/서버 배포 빌드·테스트 9개, 공통 테스트 51개 통과. 실제 React 배포 번들과 합성 응답을 사용한 시트 32개를 포함하여 CS/통계/시트 브라우저 검사 99개가 통과했고, 후속 index.html 호환성 검사 1개도 통과했다. CI 브라우저 단계는 시트 의존성 설치와 배포 빌드를 선행한다.
- PC 다크 수식 표와 모바일 개요·스냅샷의 렌더링을 직접 확인했다. 배지와 기존 재로그인 안내의 클래스 충돌을 발견해 분리하고 배지의 위치 검사를 추가했다. Google Sheets 실제 쓰기·스냅샷 복구나 아직 준비 중인 릴리스 기능을 새로 구현/검증한 것은 아니다.
- 직원·프로젝트 선택기와 계정 공통 필드, 나머지 상태/폼 컴포넌트, 나머지 3개 페이지 어댑터, 원격 보호·배포·운영 전환은 계속 미완료다.

## 4차: 팀 일정 페이지·권한·상세 이동 연결 (2026-09-10)

- 팀 일정의 주간/칸반/개인 TODO/버전 기록/관리/업무 상세 6개를 공통 계약에 등록하고 기존 개별 사이드바와 URL 해석을 공통 React adapter로 교체했다. 원래의 일정/필터/업무 처리와 `/tasks/{id}#comment-{id}`, `/index.html` 주소는 유지한다. 관리 창은 `/settings`로 진입·뒤로 이동할 수 있다.
- 관리 메뉴는 기존 서버 bootstrap의 관리자·책임자 정보를 사용하며 권한이 갱신되면 사라진다. 직원의 주요 일정 상세 읽기와 관리자 편집 권한은 구분한다. DB, 인증 미들웨어, 업무 API 인가는 변경하지 않았다.
- 일정 생성기는 새 TSX와 메뉴·타입·본문 연결·ASP.NET 경로를 같이 생성하며 기존 App 업무 코드를 덮어쓰지 않는다. 동적 상세 경로와 메뉴 capability를 계약에서 검사한다. Portal·Leave Razor 두 어댑터는 아직 남아 있다.
- 실제 브라우저에서 popstate 리스너 순서에 따라 초안 보호 전에 창이 닫히는 문제를 재현했다. 공통 라우터가 전환 승인 여부를 먼저 확인하게 바꾸고 일정 관리·업무 편집에 적용했다. 취소하면 초안과 URL fragment를 유지하며, 기존 문서 이동 beforeunload 보호도 유지한다.
- 공통 테스트 53개, 일정 frontend 37개/backend 26개, 서비스 통합 22개, 시트 11개 통과. 시트 타입 검사와 배포 빌드, 일정 타입 검사와 배포 빌드 성공. 서버 경로 테스트는 실제 배포 HTML과 ASP.NET을 사용해 등록 경로·양수 long ID·미등록 경로·API 401/404를 검증한다. CI도 테스트 전에 일정 frontend를 빌드한다.
- CS·통계·시트·일정 브라우저 회귀 142개 통과(일정 42개 포함). 세 너비/두 테마, 관리 권한, 일반 직원의 읽기 전용 상세, 상세·댓글 링크, 이동/초안 보호를 합성 API 응답으로 확인했다. PC·모바일 일정/관리의 light/dark 이미지를 직접 확인했으며 실제 운영 일정 쓰기 검증을 뜻하지 않는다.
- 이력 보존 검사를 다시 통과했다. 기존 원격·운영 서비스는 변경하지 않았다. 공통 계정/선택기/폼 계약, Razor 연결, 원격 보호·배포 차단·운영 전환은 여전히 미완료다.

## 5차: 회사 홈 Razor 페이지·서버 정책 연결 (2026-09-10)

- 회사 홈·개인 설정·직원 관리·부서/프로젝트 관리·알림·권한 없음·오류의 8개 페이지 정의를 공통 계약에 등록했다. 부서/프로젝트는 같은 Razor 본문의 query variant이며 기존 주소·편집 쿼리·handler를 보존한다. 로그인·로그아웃·SSO 전달은 사유를 명시한 기술 엔드포인트로 유지한다.
- 공통 C# adapter가 등록 경로와 기존 EmployeeOnly/AdminOnly/MasterOnly 정책을 연결한다. 실제 ASP.NET 인가 결과로 허용된 메뉴 ID만 반환하고 공통 렌더러가 표시한다. 로그인 만료 시 메뉴 API의 HTML 로그인 리다이렉트 문제를 발견해 typed JSON endpoint metadata로 401 응답을 보장했다. 기존 쿠키 무효화·업무 인가·antiforgery는 유지했다.
- `home` 페이지 생성기는 본문과 기본 직원 정책을 등록하고 제목·경로·메뉴·서버 정책을 생성한다. 독립 레이아웃, 개별 제목/경로/페이지 인증 정의, 미등록 Razor 페이지 및 query variant의 정책 불일치를 검사한다. 현재 29개 페이지가 등록되었으며 Leave 어댑터 한 개가 남아 있다.
- 공통 테스트 56개와 서버 통합 테스트 28개가 통과했다. 새 역할별 테스트는 비로그인·직원·공용 계정·관리자·마스터의 실제 Razor 응답, 기존 URL, 비인가 페이지 차단, 관리자 권한 회수 후 세션 무효화를 검증한다. 격리 DB에서 생성한 HTML과 허용 메뉴 응답을 브라우저 fixture로 쓰며 수동 대체 HTML을 만들지 않는다.
- CS·회사 홈·통계·시트·일정 브라우저 회귀 196개 통과(회사 홈 54개 포함). 시트/일정 배포 빌드 및 Razor fixture 생성이 선행되도록 CI를 연결했다. PC 다크 직원 관리와 모바일 다크 프로젝트/라이트 프로필 메뉴를 직접 확인했다. 실제 Google 로그인·직원 변경·프로필 업로드·운영 업무 쓰기를 수행한 것은 아니다.
- 메뉴 API 장애 시 안전하게 숨기고 재조회하는 동작은 검증했으나 전용 오류/재시도 UI는 남아 있다. Leave 페이지 연결, 계정 공통 필드·선택기·폼/상태 전체 전환, 원격 보호 설정, 이미지 빌드·배포 차단 및 운영 전환은 여전히 미완료다. 원격 게시와 운영 변경은 하지 않았다.

## 6차: 연차관리 Razor 연결과 승인 배지 보존 (2026-09-10)

- 연차관리의 15개 조회 화면을 공통 페이지 계약에 등록했다. 여섯 앱의 44개 페이지가 공통 메뉴·주소 생성 및 구조 검사에 연결되었으며 legacy 페이지 어댑터는 0개다. 이것은 개별 계정/직원 선택기/표/폼 및 운영 이관까지 완료했다는 뜻이 아니다.
- 같은 C# adapter가 Leave의 기존 EmployeeId·AdminOnly·MasterOnly 정책을 사용한다. 회사 관리자/마스터의 Leave Master 투영과 루트·신청·달력 리디렉션, OAuth/SSO 경로를 유지했다. 업무 handler·계산·승인·DB 스키마를 변경하지 않았다.
- 승인/취소 승인 대기 합계는 서버가 허용한 승인 메뉴에만 붙인다. `IWorkspaceNavigationBadges`와 공통 메뉴 배지 렌더러를 도입하고 기존 승인 화면의 폴링을 연결했다. 숫자 검증, 0건 숨김, 99+ 및 실제 건수 접근성 이름, 메뉴 포커스 보존을 검사한다.
- 실제 테스트 Portal의 SSO 발급 → Leave callback → 서명된 중앙 세션 재검증을 사용하는 역할별 서버 테스트를 추가했다. 공용 계정의 Leave 진입 차단, 일반 직원의 관리 페이지 차단, 회사 admin/master의 기존 관리 접근, 중앙 인증 장애 503·비활성 403·폐기 세션 401을 확인했다. HTTP 연결을 named client로 주입했으며 timeout·리디렉션 금지·HMAC·Host를 보존했다.
- 공통 테스트 57개와 전체 서버 통합 테스트 34개가 통과했다. 실제 Razor HTML에 테스트 직원·신청을 넣어 브라우저 fixture를 생성한다. 운영 직원/연차 데이터나 실제 Google·Discord에 접속해 변경하지 않았다.
- 여섯 서비스 전체 Chrome 브라우저 회귀 293개가 통과했다(Leave 95개 포함). 320/390/1440px와 light/dark, 역할별 메뉴·기존 경로·승인 배지 갱신 및 긴 프로필 정보의 가로 넘침을 검사했다. 실제 테스트 서버의 Razor 응답과 격리된 API fixture를 사용했으며 운영 업무 쓰기를 검증한 것은 아니다.
- 모바일 검사에서 Discord 긴 설정 문자열, 직원 선택과 보정·정산 폼의 intrinsic/grid 너비로 인한 넘침을 재현하고 수정했다. 어두운 배경에 남은 폼 label 색도 토큰으로 바꿨다. 회귀 검사에서 별도로 발견한 공통 개인 설정의 긴 이메일 넘침을 수정하고 고정된 긴 계정 정보 검사를 추가했다. 문서 overflow를 잘라 숨기지 않았다.
- PC 다크 승인 대기 화면과 모바일 다크 보정 폼을 직접 확인했다. 승인 표의 촘촘한 열/줄바꿈과 기타 기존 표·폼은 후속 공통 컴포넌트 전환 대상이며 이번 메뉴 전환만으로 전체 시각 품질 완료를 주장하지 않는다.
- 원본 이력과 21개 archive ref 보존을 재검증했다. 기존 저장소·원격·운영 서비스는 변경하지 않았다. 공통 데이터/폼 계약, 공통 실패/재시도 UI, 원격 보호·배포 차단·운영 전환이 남아 있다.

## 7차: 계정 등록·기존 직원 수정의 공통 필드 연결 (2026-09-10)

- 계정 유형·활성 상태·이름·이메일·부서·입사일·참여 프로젝트·비공개·회사 역할·서비스 권한의 10개 필드를 단일 계약으로 정의하고 공통 C# 입력 모델을 생성한다. 등록·단건 호환 수정·일괄 수정은 같은 정규화와 값 반영 코드를 사용한다. DB 스키마와 직원 ID는 변경하지 않았다.
- 등록/일괄 표/상세 입력을 `_AccountField` 하나로 연결했다. 역할 표현을 직원/관리자/마스터 선택으로 통일했으며 기존 isAdmin/isMaster POST는 호환한다. 활성 여부도 등록 시 선택 가능하며 기본은 활성이다. IAP 접근/배포 권한을 포함한 기존 서비스 권한 목록을 보존한다.
- 비공개 설정은 상세에 있는 하나의 실제 입력과 표의 현재값/상세 이동으로 정리했다. 공용↔직원 전환 및 전체 변경 취소에서 초안을 불필요하게 지우지 않는다. 서버의 공용 소속 제거·마스터 보호·버전 충돌·antiforgery·트랜잭션·Leave outbox는 유지한다.
- 새 필드의 렌더러/기존값 투영/서버 정규화가 빠지거나 페이지에 개별 입력을 추가하면 구조 검사가 실패한다. 검사에 대한 누락/중복 변이 테스트도 추가했다. 실제 권한 판단은 이 정적 검사 대신 서버에서 수행한다.
- 최초 모바일 검사에서 표 안 접근성 레이블의 절대 위치가 스크롤 영역을 벗어나 문서를 554px로 늘리는 것을 재현했다. 필드 자체를 위치 기준으로 지정해 수정했으며 PC/모바일 계정 화면 재검사 14개가 통과했다. PC·모바일 다크 등록 폼 렌더링을 직접 확인했다.
- 공통/계약 검사 59개, 서버 통합 45개, 여섯 서비스 Chrome 회귀 301개가 통과했다. 계정 테스트는 실제 form binding·antiforgery·격리 DB로 등록/일괄/기존 단건 수정 왕복, 비공개 해제, 서비스 권한 변경, 소속/프로젝트/Leave outbox, 잘못된 날짜·ID·이메일, 역할 위조, 관리자 계정 보호 및 오래된 버전 거부를 검증한다. 브라우저는 서버 생성 HTML에서 신규/기존 필드 일치·유형 전환·공개 범위·변경 취소·가로 넘침을 검증하며 운영 계정 변경을 수행하지 않는다.
- 기존 실패 시 일괄 초안 복원, 나머지 직원/프로젝트 선택기의 명시적 계약 전환, 공통 상태 UI, 원격 보호와 운영 이관은 계속 남아 있다. 원격 푸시·운영 데이터 변경은 하지 않았다.

## 8차: 공통 상태 UI와 메뉴 장애 복구 (2026-09-10)

- loading/empty/error/denied/success의 텍스트·아이콘·접근성·액션을 플랫폼 중립적인 `CompanyState`로 모았다. 정적 HTML/Razor 선언형 연결과 React `WorkspaceState`를 제공하며 여섯 서비스의 새 페이지 생성기에 공통 empty 본문을 포함했다. 준비 중인 화면을 실제 조회 성공으로 간주하지 않는다.
- 서버 메뉴 조회의 연결 실패·로그인 만료·권한 거부·빈 목록을 구분하고 허용되지 않거나 검증되지 않은 링크는 숨긴다. 오류 안내와 재시도는 남기고 본문/초안을 지우거나 자동 로그인 이동을 하지 않는다. 계정·역할·서비스 변경 시 캐시와 늦게 도착한 이전 응답을 차단한다.
- 재시도 시 버튼 DOM이 바뀌면서 모바일 drawer가 닫히는 경로를 막았다. 로딩→오류/복구 사이 키보드 포커스, reduced-motion, 텍스트 escaping, 선언형 동적 갱신, 오래된 콜백 교체를 검증한다. 셸 재로그인 안내도 같은 상태 렌더러를 사용한다.
- 시트의 초기 로딩/조회 오류, 한국어 비교 대기/오류, 빈 스냅샷, 쓰기 오류를 공통 컴포넌트로 전환하고 사용하지 않는 개별 상태 CSS를 제거했다. 초기화 실패 시 config/분석/스냅샷 읽기 전체를 다시 시도하며, 초기화 전 0건 카드나 빈 목록을 성공한 데이터처럼 표시하지 않는다. 실제 Google Sheets 쓰기나 자동 쓰기 재시도는 추가하지 않았다.
- 공통/계약 66개, 시트 13개, 서버 통합 45개 테스트와 시트 타입 검사·배포 빌드가 통과했다. 여섯 서비스 Chrome 회귀 313개가 통과했으며 이후 안내창 CSS와 중복 상태 스타일 정리 관련 42개를 재검사했다. 실제 Razor HTML/React 배포 번들과 격리 API 응답으로 검증했고 운영 API·직원·시트 데이터는 변경하지 않았다.
- PC 다크 상태 UI와 모바일 다크 오류/로그인 안내를 직접 확인했다. 문서 scrollWidth 검사로 놓치는 왼쪽 안내창 잘림을 발견해 고정 배너 최대 너비를 수정하고 양쪽 경계 검사를 추가했다. 빈 스냅샷의 중복 패널/고정 빈 공간도 제거하고 PC/모바일 두 테마의 초기화·빈 목록 검사 4개를 다시 통과했다.
- 여섯 원본 이력·21개 archive ref 보존을 재검증했다. 원격 생성·푸시·운영 배포는 수행하지 않았다. 나머지 업무 화면의 상태/확인/결과 UI, 직원·프로젝트 선택기 계약, 일괄 초안 복원, 원격 보호·배포·운영 이관은 미완료다.

## 9차: 직원·프로젝트 이미지와 명시적 검색 선택 연결 (2026-09-10)

- 회사 ID 기반 `CompanyEntityDisplay`와 React `WorkspaceEntity`를 공통 원본으로 추가했다. 공통 헤더, 기존 Portal/Leave ID 마커, 일정의 직원/프로젝트 표시가 같은 이미지 갱신·오류 폴백을 사용한다. 일정의 개별 프로필 URL 구독/이미지 실패 구현을 제거했다. 생성된 React 연결도 자산 검사 대상이다.
- Leave 직원 select 8개에 검색 선택과 로컬 ID 매핑을 명시하고 필드명 추측 자동 연결을 제거했다. 회사 사진 ID와 폼의 로컬 EmployeeId는 구분한다. 매핑이 없으면 회사 ID로 추정하지 않으며 동명이인도 ID로 구분한다. 업무 handler·DB·쓰기 권한은 변경하지 않았다.
- 선택창이 열린 동안 원본 option의 삭제·값/회사 ID/표시 변경·disabled/optgroup/fieldset을 다시 검증하고 오래된 항목 클릭을 거부한다. 계정/권한 범위 변경은 닫고 사진 버전 변경은 검색어·포커스를 유지한다. 초성 검색·방향키·Enter·선택 후 포커스 복원과 native input/change를 보존한다.
- 공통/계약/DOM 테스트 74개, 일정 frontend 37개, 시트 13개, 서버 통합 45개가 통과했다. 시트 타입 검사와 시트/일정 배포 빌드도 통과했다. 여섯 서비스 Chrome 회귀 321개 통과 후 최종 선택창 보완 관련 8개를 재검사했다. 실제 Razor 응답/React 번들과 격리 API를 사용했으며 운영 데이터 쓰기는 수행하지 않았다.
- 추가 테스트에서 JSDOM 26의 form reset 후 selectedOptions 캐시 불일치를 최소 예제로 확인했다. 앱을 테스트 환경에 맞춰 바꾸지 않고 실제 Chrome의 네이티브 reset으로 선택값과 아이콘 복원을 검증했다.
- 실제 모바일 화면에서 기존 Leave button 너비/nowrap 및 다크 input 강제 스타일이 공통 선택창에 섞이는 것을 확인했다. 공통 선택창 내부의 스타일 소유권을 명확히 하고 Leave 강제 스타일에서 제외했다. 제목 한 줄, 긴 이메일 줄바꿈, 입력/버튼의 테마와 내부 가로 넘침을 검사했다. PC 라이트와 모바일 다크 이미지를 직접 확인했다.
- 이력 21개 archive ref 보존을 재검증했다. 멘션·프로젝트 다중 선택·지급 내역 ID 선택창 및 나머지 표/폼/확인·결과 UI, 일괄 실패 초안 복원, 원격 보호·배포·운영 이관은 미완료다. 기존 원격·운영 checkout은 변경하지 않았다.

## 10차: 멘션 후보·다중 선택과 모바일 상세 폼 연결 (2026-09-10)

- 회사 계정 신규/기존 수정의 참여 프로젝트와 조직 관리의 참여 직원/책임자 검색을 공통 `entity-choices.js`로 연결했다. 초성 검색은 선택된 checkbox의 name/value/checked, 비활성 필드와 서버 보존용 hidden input을 바꾸지 않는다. 검색으로 숨긴 선택도 FormData에 남고 검색만으로 업무 수정 표시나 조직 관리의 이탈 경고를 켜지 않는다.
- 일정의 개별 멘션 후보 렌더링/검색을 generated `WorkspaceSuggestions`로 전환했다. 공통 프로필·설명, 방향키·Enter·Escape, 조합 중 Enter 무시, 빈 결과와 키보드 탭 순서를 제공한다. 기존 8명 잘림을 제거했고 모바일에서는 입력 중 후보가 보이는 위치로 스크롤한다. 프로필 갱신은 검색을 유지하며 계정/역할/서비스 범위 변경은 후보만 닫고 본문 초안을 보존한다.
- 이름 기반 일괄 치환으로 기존 동명이인 멘션의 ID가 바뀔 수 있던 편집 경로를 위치 기반 토큰 보존으로 변경했다. 기존 `@[표시](ID)` 형식·파일 업로드·댓글/알림 서버 처리는 유지한다. 토큰 안쪽 직접 수정은 해당 멘션만 일반 텍스트로 풀며 수동 입력한 같은 이름을 다른 직원 ID로 자동 연결하지 않는다. 본문 멘션에도 공통 프로필 표시를 연결했다.
- 공통 검색 컴포넌트와 명시적 checkbox group을 우회하는 기존 `mention-picker`/`data-search-choices` 패턴은 구조 검사에서 거부한다. 일정의 오래된 개별 멘션 CSS와 회사 홈의 개별 checkbox 검색 코드를 제거했다. 선택 목록의 서버 인가·직원 자격/비공개 정책은 변경하지 않았다.
- 실제 모바일 이미지를 확인해 기존 직원의 펼친 상세 폼이 1180px 표 너비를 따라가는 문제를 발견했다. 공통 `cw-table-scroll`/`cw-table-detail`로 표 가로 스크롤과 상세 폼 너비를 분리하고 회사 계정 편집에 적용했다. 단순 문서 overflow 외에 실제 프로젝트 입력 영역의 좌우 경계도 검사한다. 모바일 다크의 후보·프로필과 펼친 프로젝트 폼을 직접 확인했다.
- 공통/계약 77개, 일정 frontend 44개/backend 26개, 시트 13개, 서버 통합 45개 테스트 통과. 시트 타입 검사·시트/일정 배포 빌드 및 실제 Razor fixture 생성 성공. 여섯 서비스 Chrome 회귀 329개 통과 후 최종 멘션·선택·직원 관리 보완 관련 30개를 재검사했다. 브라우저 댓글 POST는 격리 fixture가 가로채 실패 응답을 반환해 ID와 초안 보존을 확인했으며 운영 쓰기는 수행하지 않았다.
- 원본 여섯 이력과 archive ref 21개 보존을 재검증했다. 남은 직원/프로젝트 표시·지급 내역 선택, 업무 표/폼/확인/수정·결과 안내의 전체 공통화, 일괄 실패 초안 복원, 원격 필수 CI/보호·배포/롤백·운영 이관은 계속 미완료다. 원격 생성·푸시·운영 서비스 변경은 하지 않았다.

## 11차: 공통 저장 처리와 직원 일괄 편집 초안 보존 (2026-09-10)

- 동일 출처 native POST 폼용 `CompanyForm`을 공통 자산에 추가했다. FormData/antiforgery/다중 값과 checkbox 의미를 유지하고, 전송 중 중복 제출과 편집을 잠근다. 공통 상태 UI로 결과를 표시하며 폼 본문을 재렌더링하거나 로그인 페이지로 자동 이동하지 않는다.
- 직원 일괄 편집의 수정 행만 명시적 collection index로 전송한다. 서버는 실제 커밋 후에만 확인 응답을 반환하며 기존 마스터/관리자 정책·입력 검증·버전 검사·트랜잭션·Leave outbox를 유지한다. 같은 계정 필드 계약에서 정규화된 값과 ID/버전 문자열을 만들어 JS 숫자 정밀도 손실을 피한다.
- 확인된 성공에서는 응답 전체 검증 후 저장값·버전·변경 취소 기준·목록/검색 표시·현황 수를 갱신한다. 별도로 작성 중인 신규 계정 초안은 지우지 않는다. 검증 실패/충돌/401/403/HTML/통신 실패/불완전한 확인 응답은 입력과 기존 버전을 유지한다. timeout이나 커밋 중 오류는 서버 반영 여부를 확정하지 않고 자동 재전송하지 않는다.
- 공통 저장 연결이 빠진 직원 관리 페이지를 구조 검사에서 거부하는 변이 검사를 추가했다. 공통/계약 테스트 81개, 서버 통합 48개 통과. 실제 ASP.NET과 격리 DB에서 문자열 버전/정규화 확인 응답, 비연속 행 index, 이전 버전 재전송 거부, 형식 오류, antiforgery, 비로그인/직원 인가 차단 및 후속 소속 변경 실패 시 전체 행 롤백을 확인했다.
- 시트·일정 배포 빌드 및 실제 Razor fixture 생성 성공. 여섯 서비스 Chrome 회귀 333개 통과(`artifacts/browser-bulk-full`). 새 네 가지 PC/모바일·light/dark 검사는 저장 POST를 격리 fixture에서만 받아 실패/성공을 모의하고 중복 전송 방지, 다른 폼 초안, reset 기준과 문서 넘침을 확인한다. PC 다크 오류와 모바일 라이트 오류·다크 편집 화면을 직접 확인했다. 운영 계정 쓰기는 수행하지 않았다.
- 초안은 열린 화면의 메모리에만 유지한다. 일반 HTML POST 호환 경로의 실패 재렌더링 초안 복원, 신규/단건 및 타 서비스 폼 이관, 충돌 비교·해결 UI, 확인/수정 표시와 나머지 직원·프로젝트 표시, 원격 CI/보호·배포·운영 이관은 계속 미완료다. 원본 이력과 21개 archive ref를 재검증했으며 원격/운영 checkout·서비스는 변경하지 않았다.

## 12차: 공통 3방향 변경 비교와 직원 충돌 검토 (2026-09-10)

- `CompanyReview`를 공통 자산으로 추가했다. 수정 전/내 초안/현재 서버를 문자열 배열로 비교하고, 양쪽이 다르게 변경한 필드는 명시적으로 선택해야 한다. 프로젝트/권한의 순서 차이는 변경으로 취급하지 않으며 큰 정수·ID를 숫자로 파싱하지 않는다. 직원/프로젝트 아이콘과 의미별 테마 토큰을 사용하고 실제 선택한 열만 강조한다.
- Portal 일괄 저장 충돌 안내에서 명시적으로 현재 계정을 다시 읽도록 연결했다. 동일 계정 필드 투영과 읽기 트랜잭션을 사용하며 대상 관리자/마스터 편집 권한을 서버에서 다시 검사한다. 조회는 no-store이고 직원/버전/outbox를 수정하지 않는다. 레거시 저장값의 기본 leave.access는 편집 가능한 권한 목록에서만 제외하며 읽기 중 원본 DB 값은 변경하지 않는다.
- 전체 계정 집합·버전·필드·현황·선택지 검증을 저장 확인과 비교 조회에서 공유한다. 불완전한 단일 값/현황, 알 수 없는 권한과 중복 선택지를 거부한 뒤에만 선택지나 reset 기준을 바꾼다. 조회 중 수정된 초안이나 계정 범위 변경도 적용을 막는다. 새 프로젝트/부서는 서버가 확인한 ID로 연결하며 이름으로 추정하지 않는다.
- 비교 적용은 최신 서버 값을 reset 기준으로 삼아 선택한 초안만 복원한다. 자동 저장하지 않으며 후속 명시적 저장도 비교한 버전의 충돌 검사를 통과해야 한다. 취소/Escape/계정 범위 변경은 초안과 원래 버전을 유지한다. 공용 계정 역할·소속 등의 잘못된 필드 조합은 비교창에서 교정을 요구하고 서버 검증도 유지한다.
- 공통/계약 테스트 86개, 실제 ASP.NET/격리 DB 서버 통합 49개 통과. 새 테스트에서 읽기 무변경, 비로그인/보호 대상 차단, 잘못된 ID, 비교 이후 추가 수정에 대한 재충돌 및 새 버전의 명시적 재저장을 확인했다. 실제 Razor fixture 생성 12개 및 시트·일정 배포 빌드도 성공했다.
- PC/모바일·light/dark의 저장/비교 브라우저 검사 8개가 통과했다(`artifacts/browser-review-validation`). 권한 거부·불완전 응답·조회 중 초안 변경·계정 범위 변경·Escape·포커스·새 프로젝트·자동 저장 없음 및 명시적 재전송 payload를 검증했다. 모바일 다크와 PC 라이트 비교창을 직접 확인했다. 브라우저 POST는 격리 fixture에서만 처리했으며 운영 계정을 변경하지 않았다.
- 최종 여섯 서비스 Chrome 회귀 337개도 모두 통과했다(`artifacts/browser-review-full`, 실패/재시도 0). 실제 Razor fixture와 React 빌드를 사용한 메뉴·프로필·테마·모바일·권한·초안 회귀 증거이며 운영 업무 처리 전체의 검증을 뜻하지 않는다.
- 공통 비교를 우회하는 직원 일괄 편집 연결에 구조 검사와 변이 테스트를 추가했다. 이력과 archive ref 21개 보존을 재확인했다. 기존 원격/운영 checkout·서비스는 변경하지 않았다.
- 남은 범위: 일반 HTML POST의 실패 초안 복원, 신규/단건 및 다른 앱 폼·확인/변경 표시의 공통화, 나머지 직원/프로젝트 표시, 원격 필수 CI/보호와 배포·롤백/운영 이관. 특히 팀 일정 TaskPanel의 기존 버전만 교체하는 재시도 준비 UI는 새 공통 비교를 연결할 후속 대상이다. 기존 폼/확인창이 많이 남아 있어 이번 공통 비교의 첫 소비자 연결을 전체 목표 완료로 보지 않는다.

## 13차: 팀 일정 업무 편집의 공통 비교 연결 (2026-09-10)

- 공통 비교창의 타입 연결을 React 앱에 생성하고, AbortSignal로 소비 페이지 해제 시 body에 열린 창을 정리한다. 일정이 별도 비교 UI를 만들지 않으며 공통 컴포넌트는 업무 조회·저장·권한을 소유하지 않는다.
- 업무 편집 시작 시 기준 필드/첨부를 보존하고, 명시적 비교 요청에서 최신 업무와 디렉터리를 읽는다. 초안·로그인 범위 변경, 권한 거부, 보관된 업무, 잘못된 스냅샷은 기존 초안과 버전을 유지한 채 적용을 거부한다. 폴링으로 이미 받은 더 최신 버전도 덮어쓰지 않는다.
- 담당자/프로젝트는 확인된 ID로 연결하고 본문의 멘션 토큰과 큰 정수 문자열을 보존한다. 날짜 조합과 현재 담당자/프로젝트 자격을 검사하며 서버에서 제거된 기존 첨부를 복구하지 않는다. 새 업로드와 현재 서버 첨부의 선택만 초안에 반영하고 최종 소유권·만료·버전 검증은 기존 저장 API가 수행한다.
- 업무 버전만 최신으로 바꾸는 재시도 버튼을 제거했다. 비교 적용과 실제 저장은 분리되며, 검토 이후 서버가 또 바뀌면 다시 409가 발생한다. 알려진 비교 연결 누락과 버전만 교체하는 패턴을 정적 검사/변이 테스트로 잡는다. 정적 검사가 모든 우회나 서버 권한의 안전성을 증명하지는 않는다.
- 공통/계약 테스트 88개, 일정 frontend 48개/backend 26개, 서비스 통합 49개 통과. 시트 타입 검사, 시트·일정 배포 빌드와 실제 Razor fixture 생성 12개도 성공했다. 원본 여섯 이력·정확한 import tree와 archive ref 21개 보존을 재확인했다.
- 새 PC/모바일·light/dark 브라우저 검사 4개 통과(`artifacts/browser-task-review-verified`). 읽기 실패·편집 권한 회수·조회 중 입력·계정 범위 변경·Escape·부모 페이지 해제·새 디렉터리 값·첨부 선택·검토 후 재충돌을 실제 React 번들과 격리 API로 검증했다. 모바일 다크와 PC 라이트 렌더링을 직접 확인했으며 운영 업무 저장은 수행하지 않았다.
- 최종 여섯 서비스 Chrome 회귀 341개가 모두 통과했다(`artifacts/browser-task-review-full`, 실패/재시도 0). 실제 Razor 응답과 React 배포 번들을 사용했으나 운영 인증/업무 처리 전체의 검증을 뜻하지 않는다.
- 댓글 편집의 구형 버전 재시도, 다른 폼/확인창/업무 상태 및 나머지 직원·프로젝트 표시, 일반 HTML POST 실패 초안 복원, 원격 필수 검사/보호와 배포·롤백/운영 이관은 계속 남아 있다. 원격·운영 checkout·서비스는 변경하지 않았다.

## 14차: 댓글 편집의 공통 비교·저장 확인 연결 (2026-09-10)

- 일정의 신규 댓글·답글·기존 댓글 편집을 `CommentComposer`로 분리하고 공통 비교/상태 UI에 연결했다. 댓글 본문·첨부의 수정 전/초안/현재 값을 검토한 뒤에만 기준 버전을 갱신하며 자동 저장하지 않는다. 구형 버전만 바꾸는 재시도 버튼을 제거하고 연결 누락/확인 응답 처리 누락을 정적 검사와 변이 테스트로 확인한다.
- 업무 수정 가능 여부를 댓글 권한으로 사용하지 않는다. 작성자·활성·접근·공용·삭제·보관 상태를 확인하고 기존 서버의 작성자 전용 PUT, 버전 충돌, 멘션 알림과 첨부 검증을 유지했다. 기존 서버 읽기/쓰기 API와 DB 스키마는 바꾸지 않았다. 서버에서 제거된 첨부는 선택만으로 되살리지 않는다.
- 폴링에서 삭제된 댓글로 바뀌어도 편집 초안을 유지하며 저장을 막는다. 조회 실패·조회 중 입력·계정 범위 변경·비교 취소도 기존 초안과 버전을 유지한다. 저장 중 편집·첨부 변경과 중복 제출을 차단한다. 확인된 쓰기 응답과 이후 목록 읽기를 분리하여 갱신 실패를 저장 실패로 오인하거나 POST/PUT를 자동 반복하지 않는다. 불완전 응답은 서버 반영 여부 미확정으로 알린다.
- 공통/계약 89개, 일정 frontend 52개/backend 27개, 서비스 통합 49개 테스트 통과. 실제 서버 테스트에서 업무 편집 권한 없는 댓글 작성자의 조회/수정, 관리자 타인 수정 거부, 읽기의 댓글/이력 무변경, 검토 후 재충돌, 원문/버전 확인 응답 및 삭제 후 수정 거부를 검증했다. 원본 여섯 이력·정확한 import tree와 archive ref 21개를 재검증했다.
- 시트·일정 배포 빌드 및 실제 Razor fixture 생성 12개 성공. 신규/답글 저장과 PC/모바일·light/dark 댓글 비교 브라우저 5개 통과(`artifacts/browser-comment-review-final`). 격리 API로 실제 React 번들의 실패·성공·초안·중복 제출·저장 후 조회 실패·삭제 폴링·계정 변경을 확인했고 운영 댓글을 쓰지 않았다. 멘션 밖만 수정하는 실제 입력으로 ID와 큰 정수 원문 보존을 확인했다. 전체 textarea 교체를 멘션 보존으로 잘못 기대한 초기 테스트는 올바른 입력 시나리오로 수정했다.
- 모바일 다크와 PC 라이트 렌더링을 직접 확인했다. 모바일에서 적용 버튼의 문구가 글자 중간에 나뉘어 공통 레이블을 `초안에 적용`으로 줄이고 최종 모바일 이미지를 다시 확인했다. 버튼은 여전히 서버 저장이 아닌 초안 적용만 수행한다.
- 최종 여섯 서비스 Chrome 회귀 346개가 모두 통과했다(`artifacts/browser-comment-review-full`, 실패/재시도 0). 실제 Razor/React 렌더링과 격리 응답의 UI·내비게이션·테마·모바일·권한·초안 회귀 증거이며 운영 업무 전체의 성공을 증명하는 것은 아니다.
- 아직 남은 범위는 다른 폼/확인창/업무 상태·표/직원·프로젝트 표시의 공통화, 일반 HTML POST 실패 초안 복원, 원격 필수 검사/보호, 배포·롤백 및 운영 이관이다. 원격·운영 checkout·서비스는 변경하지 않았다.

## 15차: 공통 확인창 수명주기와 시트 실행 연결 (2026-09-10)

- `CompanyDialog.present/confirm`과 generated React `confirmWorkspaceAction`을 추가했다. 확인창과 기존 3방향 비교창이 모달 중복 방지, Escape/취소/native close, AbortSignal, 계정 변경, DOM/리스너 정리, 포커스 복원을 공유한다. showModal 실패나 검증 콜백 예외도 실행/영구 잠금으로 이어지지 않는다. 확인 컴포넌트 자체는 API를 호출하지 않는다.
- 시트 수식 전환·한국어 갱신의 두 독립 확인/결과 모달과 CSS를 제거하고 공통 확인창/상태 안내로 연결했다. `useSheetActions`가 분석/미리보기의 복사본·ID·대상·설정·로그인 범위를 고정하고 확인 중 변경·페이지 전환·중복 실행을 거부한다. 같은 객체의 직접 변경도 검토 내용과 비교한다. 서버의 쓰기 설정·정확한 확인 문구·fingerprint 재검증·스냅샷·실패 복구는 변경하지 않았다.
- 기존 API 응답의 대상·미리보기·건수·스냅샷/완료 정보를 검증한 후에만 완료 안내를 표시한다. 후속 목록 읽기 실패와 실제 쓰기 실패를 분리한다. 불완전 응답/통신 오류를 확실한 롤백으로 안내하거나 자동 재전송하지 않는다. 명시적 재확인은 현재 데이터/스냅샷 조회만 수행하며 이전 요청의 실행 여부를 확정할 수 없는 한계도 안내한다. 계정 변경 후 늦은 쓰기 응답은 새 범위에 표시하지 않는다.
- 실제 Chrome에서 취소 후 포커스 복원 실패를 발견했다. React의 실행 버튼 잠금 해제 뒤 한 프레임에서 복원을 보완하되 새 모달/사용자 초점을 빼앗지 않게 했다. 모바일 다크와 PC 라이트 확인창을 직접 확인하고, 모바일 한글 단어 중간 줄바꿈과 긴 실행 버튼 문구를 보완했다.
- 공통/계약/DOM 95개, 시트 22개 테스트 및 시트 타입 검사 통과. 시트·일정 배포 빌드와 실제 Razor fixture 생성 12개가 성공했다. 읽기 전용 설정, 문구 일치, 취소/계정/페이지 전환, 중복 실행, 불완전 응답, 성공 후 조회 실패와 명시적 재확인을 브라우저 격리 API로 검증했다. 실제 Google Sheets/운영 데이터를 수정하지 않았다.
- 여섯 서비스 Chrome 회귀 351개가 모두 통과했다(`artifacts/browser-confirm-full`, 실패/재시도 0). 이후 시트의 검토 복사본 고정과 이전 조회 오류 해제 보완을 반영한 최종 시트 브라우저 42개도 통과했다(`artifacts/browser-sheet-confirm-final`). 최종 모바일 다크 이미지를 다시 확인했다. 공통 확인 연결/완료 확인 누락은 정적 검사와 변이 테스트를 추가했고 루트 작업 지침에도 사용 규칙을 명시했다.
- 여섯 원본 이력·정확한 import tree·archive ref 21개 보존을 재검증했다. 아직 일정 보관/복원·댓글/TODO 삭제, 다른 폼/확인창/업무 표·직원/프로젝트 표시, 동기식 이탈 보호의 안전한 전환, 일반 HTML POST 실패 초안 복원과 원격 필수 검사/보호·배포/롤백·운영 이관이 남는다. 원격 생성·푸시·운영 checkout/서비스 변경은 하지 않았다.

## 16차: 일정 보관·복원·댓글 삭제의 공통 확인 연결 (2026-09-10)

- `useTaskActions`와 `taskActions`가 업무 보관·관리자 복원·댓글 삭제를 공통 확인/상태 UI에 연결한다. 사전 최신 업무/디렉터리 조회, 복사한 대상·버전·내용, 확인 중 폴링 변경·권한/계정/페이지 전환과 동기 중복 호출을 검사한다. 직접 보관/삭제하던 native confirm 경로를 제거하고 알려진 우회/응답 확인 누락을 구조 검사와 변이 테스트에 추가했다.
- 작성 중인 업무·댓글 또는 열린 댓글 편집은 저장/취소 후 처리한다. 기존 댓글 입력의 sticky dirty 때문에 내용을 모두 지워도 보관이 계속 막히는 문제를 브라우저에서 발견해, 원본/검토 기준과 실제 본문·첨부를 비교하도록 보완했다. 확인/전송 중 native fieldset과 닫기/이탈 경로를 잠그고, 비동기 사전 조회 전에 포커스를 캡처해 취소 후 기존 실행 버튼으로 돌아온다.
- 보관/복원의 기존 JSON 응답에서 대상·새 버전·보관 상태·유지 필드를 확인하고 댓글 삭제는 HTTP 204만 완료로 인정한다. 성공 뒤의 상세/보드 조회 실패와 불확실한 쓰기 결과를 구분하며, 수동 재확인은 읽기만 수행한다. 기존 보드 갱신이 오류를 삼키던 경로는 명시적 성공 확인용 `changed(true)`에서 호출자에게 전달한다. 서버 API/DB/권한 정책은 바꾸지 않았다.
- 서버 테스트에서 타인 보관/삭제 거부, 버전 충돌, 접근 회수, 보관 중 댓글 삭제 차단, 관리자 복원, 정확한 업무 응답 및 댓글 삭제 204를 검증했다. 댓글 본문/첨부 연결 제거와 답글·감사 기록 보존도 실제 격리 DB에서 확인했다. 운영 업무/댓글은 변경하지 않았다.
- 공통/계약/DOM 96개, 일정 frontend 70개/backend 29개, 서비스 통합 49개 테스트 통과. 일정 단독 clean npm 설치/테스트/빌드도 성공했다. DOM 테스트용 jsdom 26.1.0을 앱 개발 의존성/lockfile에 명시해 루트 설치에 대한 우연한 의존을 제거했다. 시트·일정 배포 빌드와 실제 Razor fixture 생성 12개도 성공했다.
- 최종 여섯 서비스 Chrome 356개가 모두 통과했다(`artifacts/browser-task-confirm-full`, 실패/재시도 0). 실제 번들과 격리 응답으로 PC/모바일·light/dark 확인창, 네이티브 부모 상세창/취소 포커스, 초안 보호, 보관/복원/삭제, 확인 중 폴링 변경, 403/409/불완전 응답, 중복 실행과 성공 후 목록 장애를 검증했다. 모바일 다크 및 PC 라이트 화면을 직접 확인했다. 원본 여섯 이력·정확한 import tree·archive ref 21개 보존도 재검증했다.
- 의존성 온라인 audit에서 기존 Vitest/@vitest/mocker의 중간 위험도 보고 2건(GHSA-82fw-gwwq-j7x9)을 확인했다. 오프라인 설치의 `0 vulnerabilities` 출력은 최신 보안 검증 결과로 간주하지 않는다. 강제 메이저 업그레이드는 이번 UI 변경에 섞지 않았으며 테스트 도구 업그레이드 검증은 별도로 남긴다.
- 남은 범위: TODO 등 다른 확인/폼/상태/업무 표·직원/프로젝트 표시, 동기식 이탈 보호, 일반 HTML POST 실패 초안 복원, 원격 필수 검사/보호와 배포·롤백/운영 이관. 원격 생성·푸시·운영 checkout/서비스는 변경하지 않았다. 이 단계의 완료를 전체 목표 달성으로 보지 않는다.

## 17차: 공통 상세 펼치기와 직원 검색 상태 연결 (2026-09-10)

- `CompanyDisclosure`를 공통 자산에 추가하고 Portal 직원 관리의 정보/공개 범위 버튼과 상세 행을 연결했다. 여러 버튼의 ARIA·패널 ID·열기/닫기 문구·포커스를 한 곳에서 관리한다. 기존 개별 click/상태 갱신 코드를 제거했으며 입력 DOM·필드 값·폼 제출·저장 충돌 버전은 변경하지 않는다.
- 기존 검색은 상세 행만 숨겨 버튼이 여전히 펼쳐진 것으로 남았다. 이제 검색/부서/프로젝트 필터가 공통 API로 상세를 닫고 검색창 포커스와 초안을 보존한다. 다시 검색하여 열어도 비공개 설정·프로젝트 선택·입력값·dirty 상태가 유지된다. 서버 인가와 일괄 저장 계약은 그대로다.
- 키 중복·DOM 교체·중첩 그룹·해제/재연결·guard 중 해제·재진입·취소 이벤트·비동기/예외 guard를 검증했다. 정적 패널 그룹에는 선택적으로 한 개만 펼치기와 동기 전환 guard를 제공한다. 컴포넌트 자체는 조회·쓰기·초안 초기화를 하지 않는다. CS의 단일 이동형 대용량 편집기 및 다른 업무 표는 아직 별도 전환 대상으로 남는다.
- 직원 상세 연결/필터 API를 제거하거나 개별 ARIA 갱신을 다시 넣으면 구조 검사가 실패하도록 변이 테스트를 추가했다. 루트 작업 지침과 아키텍처/개발 문서, Portal README에 소유권·연결·테스트 방법과 미전환 범위를 기록했다. 다른 다섯 앱은 공통 자산 버전만 갱신하며 업무 동작은 변경하지 않는다.
- 격리 마스터의 실제 Razor 화면에서 PC/모바일·light/dark, Enter/Space, 다중 행 펼치기, 검색 후 재열기, FormData/버전 보존과 상세 폼 너비를 검사했다. 일반 관리자 fixture는 편집 가능한 직원이 한 명뿐이어서 최초 다중 행 테스트가 대기 실패했으며, 여러 계정 편집이 허용된 마스터 fixture로 수정했다. 제품의 권한 필터를 완화하지 않았다.
- 공통/계약/DOM 105개, 실제 서버 통합 49개 및 Razor fixture 생성 12개가 통과했다. 시트·일정 배포 빌드도 성공했다. 여섯 서비스 Chrome 회귀 360개 통과(`artifacts/browser-disclosure-full`, 실패/재시도 0) 후 guard 중 해제 방어를 추가했고, 최종 자산으로 직원 상세 Chrome 4개를 다시 통과했다(`artifacts/browser-disclosure-final`). 초기 모바일 캡처에서 고정 저장 바가 상세 하단과 겹쳐 보여 마지막 비공개 필드의 실제 클릭/포커스·초안 유지 검사를 추가했다. 스크롤 후 마지막 필드와 저장 바가 함께 접근 가능한 최종 모바일 다크 화면, PC 라이트 상세 화면을 직접 확인했다. 제품 CSS를 가리거나 테스트를 위해 저장 바를 숨기지 않았다.
- 원본 여섯 저장소의 이력·정확한 import tree·archive ref 21개 보존을 다시 확인했다. 이번 단계는 공통 상세의 첫 소비자 연결이며 전체 업무 표/폼 공통화 완료가 아니다. TODO/CS 등 남은 소비자, 일반 HTML POST 실패 초안 복원, 테스트 도구 보안 업그레이드, 원격 필수 검사/보호와 배포·롤백·운영 이관은 계속 남는다. 원격 생성·푸시·운영 서비스 변경은 하지 않았다.

## 18차: CS 단일 편집기와 공통 상세·표 연결 (2026-09-10)

- CS 플레이어 데이터의 개별 행 열림 상태를 `CompanyDisclosure`의 단일 펼치기로 교체했다. 저장소와 원래 데이터 키를 함께 식별하며 각 행의 빈 패널 사이에 편집기 DOM 하나만 이동한다. 큰 세이브를 행마다 복제하지 않는다. 검색은 기존 행을 숨기고 공통 API로 닫아 ARIA·열기/닫기 문구를 함께 갱신한다.
- 접기/검색 후 같은 키를 열면 원문·초안·사유·확인 체크·커서·편집기 스크롤을 유지한다. 다른 키/서버로 전환할 때의 기존 변경 폐기 확인은 유지한다. 조회/저장 중에는 native fieldset으로 대상 변경·편집과 중복 제출을 잠그고, 응답 반영 후 같은 상세를 복원하는 내부 경로를 구분했다. 서버 인가·저장소별 토큰/스냅샷·GZip·lossless JSON 처리와 DB는 바꾸지 않았다.
- 실제 모바일에서 스크롤 표 밖에 위치한 접근성 레이블이 문서 너비를 716px로 늘리는 문제를 확인했다. 공통 `.cw-table-scroll`에 위치 기준을 부여해 원인을 수정하고 표의 가로 스크롤 자체는 유지했다. 상세 입력은 보이는 컨테이너 폭에 맞추고 확인 문장의 잘못된 flex 분할·중첩 여백을 보완했다. 라이트 모드의 옅은 확인 문구도 공통 경고 토큰으로 변경했다.
- 실제 편집 JS와 실제 player-data API handler를 연결한 브라우저 검사 12개를 추가했다. PlayFab 전송만 메모리 클라이언트로 대체하고 모든 외부 요청을 차단한다. 라이브/테스트 구성, 세 저장소의 같은 이름 키 구분, 큰 정수/문자열 이스케이프/GZip 저장, 추가·삭제, 조회 실패·409 충돌 초안, 중복 제출 및 PC/모바일·light/dark를 검증했다. 실제 Title이나 운영 세이브는 변경하지 않았다.
- 공통/계약/DOM 106개, CS 81개, 실제 서버 통합 49개와 Razor fixture 생성 12개가 통과했다. 시트·일정 배포 빌드 및 원본 여섯 이력·정확한 import tree·archive ref 21개 보존도 재확인했다. 구조 검사에 CS 공통 연결/단일 편집기/잠금 누락 검사를 추가했고 생성기 테스트의 격리 복사 목록에도 새 검사 입력 파일을 포함했다. 검사 예외로 우회하지 않았다.
- 여섯 서비스 Chrome 회귀 372개 통과(`artifacts/browser-cs-disclosure-full`, 실패/재시도 0). 이후 CS 확인 문구 색과 화면 캡처/검사를 보완한 최종 CS Chrome 12개도 통과했다(`artifacts/browser-cs-disclosure-verified`). PC 라이트·모바일 다크 상세/저장 영역을 직접 확인했다. 서버 handler를 실행하는 격리 검사는 실제 PlayFab 전송·운영 인증·업무 전체 E2E 완료를 뜻하지 않는다.
- 남은 범위: CS 저장/추가/삭제 확인창·응답 전체 검증·성공 후 읽기 실패 구분과 계정 범위 변경 처리, TODO 등 다른 폼/상태/표와 직원·프로젝트 표시, 일반 HTML POST 실패 초안 복원, 테스트 도구 보안 업그레이드, 원격 필수 CI/보호·배포/롤백·운영 이관. 이번 상세 연결을 전체 목표 완료로 보지 않는다. 원격 생성·푸시·운영 checkout/서비스는 변경하지 않았다.

## 19차: CS 변경 확인·응답 검증·목록 복구 연결 (2026-09-10)

- 플레이어 데이터 저장을 공통 확인창에, 추가/삭제 입력 양식을 `CompanyDialog.present`와 `.cw-dialog-form`에 연결했다. 개별 모달 프레임/배경 CSS와 수명주기를 제거했다. 전송 중 사용자 Escape는 보류하지만 계정 범위 변경·abort·외부 close는 항상 해제한다. 창 닫힘은 서버 취소나 롤백을 의미하지 않는다.
- `runMutation`에서 서버·UID·저장소·키·편집 토큰·원문·사유·로그인 범위를 캡처하고 확인 뒤 다시 대조한다. 기존 API 확인 응답의 대상·버전·크기·저장 원문·새 토큰을 검증한 후에만 편집 기준을 갱신한다. JSON 숫자를 객체로 변환하지 않으며 GZip과 64비트 정수/문자열 토큰을 보존한다. 서버 API·DB·쓰기 허용 설정·인가·감사 정책 및 기존 PlayFab 재조회 이후 경쟁 구간은 변경하지 않았다.
- 추가/삭제가 성공했지만 뒤따르는 조회만 실패한 경우 완료 사실을 유지하고 읽기 전용 재확인을 제공한다. 이 버튼으로 쓰기를 반복하지 않는다. 다른 키의 초안을 새로 작성했다면 조회 적용 전에 폐기 확인을 받는다. HTML/불완전 응답/통신 장애는 반영 여부 미확정으로 안내하고, 충돌/미확정 결과 뒤에는 새 조회 전까지 쓰기를 막는다. 계정 변경 뒤 늦은 응답을 적용하지 않고 초안을 유지한다. 45초 통신 제한이 실제 서버 작업 취소를 보장하지 않음을 문서화했다.
- 공통 결과 영역을 본문과 열린 입력창에 연결하고 보이는 결과 영역으로 스크롤한다. 실제 시각 검사에서 기존 CS footer 글꼴이 공통 버튼에 상속되어 너무 작아지는 문제, 공통 fieldset 규칙 간 우선순위 충돌을 발견해 공통 프레임에서 수정했다. 최종 모바일 다크 추가 양식과 PC 라이트 저장 확인창을 직접 확인했다.
- 실제 player-data handler와 메모리 PlayFab을 연결한 계약 테스트 3개를 추가했다. 대상 불일치·필드 누락·중복/불완전 조회·큰 정수·UTF-8 바이트 길이·세 저장소 응답을 검사한다. 구조 검사에 공통 확인/상태·응답 검증·범위 확인 우회 방지를 추가했고 생성기 격리 복사 목록도 갱신했다. 이 정적 검사는 임의 우회가 절대 불가능함을 증명하지 않는다.
- 공통/계약/DOM 108개, CS 84개와 CS 문법 검사 통과. 시트·일정 배포 빌드, 실제 Razor fixture 생성 12개와 실제 서버 통합 49개도 통과했다. 원본 여섯 이력·정확한 import tree·archive ref 21개 보존을 재검증했다.
- 여섯 서비스 Chrome 회귀 383개 통과(`artifacts/browser-cs-mutations-full`, 실패/재시도 0). 이후 CS 반환 URL 헤더·완료 포커스·결과 영역 스크롤을 보완한 최종 CS Chrome 23개도 통과했다(`artifacts/browser-cs-mutations-verified`). PC/모바일·light/dark, 취소 포커스, 확인 중 초안 변경, 전송 중 Escape/중복 제출, 성공 후 읽기 장애/재확인, 403/409/HTML/통신/부분 응답, 늦은 응답 무시와 화면 안의 오류 안내를 검사했다. 모든 브라우저 요청을 격리했으며 실제 Title·운영 세이브·인증 키는 사용하지 않았다.
- 남은 범위: 다른 CS 작업과 TODO 등 폼/상태/표·직원/프로젝트 표시, 일반 HTML POST 실패 초안 복원, 테스트 도구 보안 업그레이드, 원격 필수 CI/보호·서비스별 배포/롤백·운영 이관. 기존 Vitest 보안 보고의 해결을 이번 검사 통과로 간주하지 않는다. 원격 생성·푸시·운영 checkout/서비스는 변경하지 않았으며 전체 목표는 계속 진행 중이다.

## 20차: 개인 TODO 공통 확인·상태·편집 기준 연결 (2026-09-10)

- `usePersonalTodos`로 조회·쓰기 수명주기를 분리하고 삭제는 공통 확인창, 로딩/빈 목록/실패/권한/성공은 공통 `WorkspaceState`에 연결했다. native form/fieldset과 ref 잠금으로 전송 중 입력·목록 전환·중복 요청을 막는다. 삭제는 현재 목록의 내용·버전을 다시 확인하며 기존 서버의 소유자·버전 검증도 유지한다.
- `personalTodoContract`에서 현재 소유자의 고유 목록 및 추가/수정/완료 응답의 ID·원문·버전·날짜·완료 상태를 검증한다. 삭제/정렬은 기존 204 계약만 완료로 인정한다. 서버 확인 전 초안을 지우거나 낙관적으로 정렬하지 않으며 확인된 쓰기와 후속 목록 장애를 구분한다. 목록 재확인은 읽기만 수행한다. 미확정/충돌 뒤에는 명시적 조회 전까지 반복 쓰기를 차단한다.
- 기존 자동 조회가 수정에 쓰일 버전을 바꾸던 구조를 제거했다. 편집 시작 항목과 초안을 별도로 보존하고 편집/새 입력 중 자동 조회를 보류한다. 명시적 조회에서 항목이 변경·제거되어도 편집 행을 유지하며 저장을 막고 현재 내용을 안내한다. 현재 단계는 3방향 TODO 병합이 아니라 취소/최신 항목 재열기 방식이다. 계정 ID가 바뀌면 개인 화면을 다시 생성하고 범위 변경/해제 뒤 늦은 응답을 적용하지 않는다.
- 이탈 보호를 공통 라우터 history/navigation 양쪽 및 문서 beforeunload에 연결했다. 초기 브라우저 검사에서 기본 history guard만 등록하면 사이드바 이동이 초안을 버리는 문제를 확인해 navigation도 등록했다. 비동기 서버 응답 이후에만 체크가 확정되는 동작은 테스트의 즉시 체크 단정 대신 클릭 후 완료 상태를 기다리도록 검증했다. StrictMode 초기 effect 정리는 지연 시작 타이머를 취소한다.
- TODO의 별도 다크 팔레트/흰 배경 값을 제거하고 공통 의미 토큰을 사용한다. 모바일 줄 배치와 체크/정렬/수정/삭제 동작은 유지하며 삭제 버튼의 기존 테마 우선순위 충돌도 보완했다. 공통 연결/응답 검증/양쪽 이탈 guard 누락과 하드코딩 색상 복귀를 구조 검사 및 변이 테스트에 추가했다. 공통 자산 자체와 다른 앱 소스는 이번 단계에서 변경하지 않았다.
- 공통/계약/DOM 109개, 일정 frontend 76개 및 backend 30개, 실제 서비스 통합 49개 통과. 서버 테스트를 보강해 오래된 수정/완료/삭제 버전, 타 계정 ID 정렬·관리자 삭제 거부, 접근 회수 및 본인 삭제 204를 격리 DB에서 확인했다. 서버 API/DB/72시간 보관 정책과 기존 원자성·정렬 경쟁 구간은 변경하지 않았다. 일정 배포 빌드와 원본 여섯 이력·정확한 import tree·archive ref 21개 보존도 확인했다.
- 최종 일정 Chrome 회귀 74개 통과(`artifacts/browser-todo-schedule-final`, 실패/재시도 0). 그중 신규 TODO 검사 10개는 PC/모바일·light/dark, CRUD/완료/되돌리기/정렬, 삭제 취소 포커스, 중복 실행, 초안/버전 보존, 403/409/부분/통신 오류, 성공 후 조회 장애·읽기 복구, 보관함 전환 및 계정 변경/늦은 응답을 검증한다. 실제 배포 번들과 공통 UI를 실행하되 모든 API 요청은 격리했고 운영 개인 TODO는 사용하지 않았다. 모바일 다크 결과 화면과 PC 라이트 확인창을 직접 확인했다. 다른 다섯 앱의 브라우저 회귀는 이번 단계에서 재실행하지 않았다.
- 남은 범위: 다른 일정 상태 변경·주요 일정/버전 기록·CS 작업 및 다른 폼/표·직원/프로젝트 표시, 일반 HTML POST 실패 초안 복원, 테스트 도구 보안 업그레이드, 원격 필수 검사/보호와 배포·롤백·운영 이관. 이번 TODO 전환은 전체 목표 완료가 아니다. 원격/운영 서비스는 변경하지 않았다.

## 21차: 필수 CI 결과 검증과 배포 증거 경계 (2026-09-10)

- 기존 집계의 `Object.values(needs).some(...)`는 빈 결과를 실패로 판단하지 못했다. 필수 일곱 job의 정확한 집합과 각 `success` 결과를 검증하도록 교체했다. 실패·취소·건너뜀·누락·불완전 결과는 성공 기록을 만들기 전에 거부한다.
- `verification-policy.json`과 `npm run check:ci`로 워크플로의 필수 명령·서비스 matrix·집계 의존성과 실행 조건을 검사한다. 공통 검사에 포함하며 명령 삭제·조건부 생략·matrix 축소·다른 checkout ref 등의 변이 테스트를 추가했다. 제한된 작성 형식 검사이며 모든 YAML 의미나 악의적 변경을 검증한다고 주장하지 않는다.
- CI 집계에 정확한 commit/tree, 저장소, run/attempt, event/ref, workflow/정책 해시 및 일곱 결과를 담는 기록과 artifact 업로드를 추가했다. dirty checkout과 CI commit 불일치를 거부하고 파일을 덮어쓰지 않는다. `deploymentApproved:false`이며 PR 증거는 PR merge commit용이다. 환경변수나 JSON 자체를 출처 인증으로 취급하지 않는다.
- `docs/DEPLOYMENT.md`에 원격 보호 설정·이미지 digest 연결의 미구현 상태와 여섯 Compose의 데이터 경계를 기록했다. CS/통계의 Compose 프로젝트별 볼륨 이름과 시트 상대 bind 경로가 새 checkout에서 달라질 위험을 구분한다. 실제 Docker inventory는 로컬 접근 제한으로 확인하지 못했으며 설정 파일 검토를 운영 상태 확인으로 보고하지 않았다.
- 공통/계약/DOM 및 신규 CI 변이 테스트 총 117개와 구조·워크플로 검사가 통과했다. 이번 단계는 CI/tooling/문서만 변경했으며 여섯 앱의 빌드·브라우저·운영 E2E를 재실행한 것으로 보고하지 않는다. 실제 원격 CI 성공 기록 생성·다운로드도 아직 실행하지 않았다.
- 원격 생성·푸시·보호 규칙·운영 checkout·컨테이너·데이터를 변경하지 않았다. 신뢰된 원격 실행과 배포 이미지 연결, 독립 배포/롤백 리허설 및 기존 UI/업무 소비자의 남은 전환·보안 업그레이드는 계속 필요하다. 이 단계로 전체 목표를 완료 처리하지 않는다.

## 22차: 테스트 도구 보안 갱신과 온라인 검사 강제 (2026-09-10)

- 변경 전 실제 설치는 일정/시트 Vitest·mocker 3.2.7이었다. 공식 GHSA-82fw-gwwq-j7x9 및 npm 온라인 audit를 대조하고 양쪽을 수정 버전 4.1.11로 고정했다. 기존 Vitest 테스트 본문/기준/개수는 변경하지 않았고 Vite 7·React 19 및 앱 업무 코드는 유지했다.
- 같은 온라인 검사에서 시트 qs 6.15.3의 중간 위험 보고와 esbuild 0.27.7의 낮은 위험 보고도 확인했다. qs를 6.16.0, esbuild를 0.28.2로 갱신했다. tsup 8.5.1의 요구 범위 때문에 tsup → esbuild 0.28.2 override를 명시하고 상위 지원 시 제거·재검증 조건을 개발 문서에 기록했다. 런타임 간접 의존성 변경은 qs이며 Express/Google API 클라이언트 및 다른 앱의 운영 의존성 버전은 바꾸지 않았다. 관련 공지는 [qs 배열 제한](https://github.com/advisories/GHSA-x5fp-wj9c-mxmx), [qs 예외 처리](https://github.com/advisories/GHSA-4mjr-xmp4-gh2g), [Windows esbuild 개발 서버](https://github.com/advisories/GHSA-g7r4-m6w7-qqqr)다. 실제 서비스가 해당 공격 조건에 노출됐다고 단정하지 않는다.
- npm 10.9.2의 갱신 계산이 `edgesOut` 내부 오류로 실패했다. 전역 npm은 바꾸지 않고 임시 npm 11.19.1을 앱 작업 디렉터리에서 직접 실행해 lockfile을 생성했다. 중간 명령의 성공 출력에도 앱 lockfile이 그대로인 것을 확인해 완료로 취급하지 않았으며 최종 diff/버전을 대조했다. 이후 기존 npm 10의 `npm ci --ignore-scripts`로 두 앱 모두 정상 설치·실행되어 CI 설치 호환성을 확인했다.
- shared-ui/node-apps/frontend-apps에 루트·CS·통계·일정·시트 온라인 audit를 필수 명령으로 추가했다. 개발/선택 의존성을 포함하고 low 이상 보고 및 조회 장애는 성공 처리하지 않는다. 명령 생략·`--omit=dev`·위험도 완화·`|| true` 및 시트 조건부 검증 누락을 CI 정책/변이 테스트에 포함했다. 원격 보호 설정 자체를 완료했다는 뜻은 아니다.
- 시트에 `test:runtime`을 추가해 tsup 생성 서버와 정적 자산을 실제 실행한다. 테스트 전용 loopback 임시 포트와 허용 목록 환경만 사용하고 외부 TCP 연결을 차단한다. 데모 조회, 실 쓰기 차단, 잘못된 JSON/큰 form 제한, 등록 페이지/자산, 인증 필수 상태의 401/303을 확인하며 운영 키/계정/Google 시트를 사용하지 않는다. 첫 실행은 15초 시작 제한에 걸려 종료됐고, 시작 단계 진단과 30초 상한을 둔 뒤 재검증했다. 이 테스트는 시작 속도 SLO나 실제 인증/Google API/컨테이너 E2E 검사가 아니다.
- 일정 76개·시트 22개 단위 테스트, 시트 typecheck 및 두 앱 배포 빌드 통과. 공통/계약/DOM/CI 정책 테스트 118개와 원본 여섯 이력·정확한 import tree·archive ref 21개 보존 검사도 통과했다. 최종 온라인 npm audit는 다섯 프로젝트 모두 보고 0건이며 모든 취약점 부재를 보장하지 않는다. 시트 격리 runtime 2개와 일정·시트 Chrome 회귀 116개 통과(`artifacts/browser-dependency-update`, 브라우저 실패/재시도 0). 시트 모바일 다크·일정 PC 라이트 실제 산출 화면을 직접 확인했다.
- 다른 네 앱의 브라우저/전체 서버 테스트와 Docker 이미지는 이번 단계에서 재실행하지 않았다. 신규 CI의 실제 원격 실행, 운영 배포/이미지 승격·롤백, 나머지 폼/표/직원·프로젝트 표시 공통화는 계속 남는다. 원격·운영 checkout·서비스·DB는 변경하지 않았으며 전체 목표는 진행 중이다.

## 23차: 한글 선택창 조합 보호와 버전 기록의 공통 인물·프로젝트 표시 (2026-09-10)

- 공통 직원/프로젝트 선택창에서 한글 IME 조합을 확정하는 Enter가 첫 검색 결과까지 선택할 수 있는 경로를 보완했다. composition 상태·isComposing·keyCode 229 중 하나라도 해당하면 선택/방향키 처리를 보류한다. 조합 종료 후 일반 Enter, 기존 select 값·change 이벤트·포커스 복원은 유지한다. 공통 원본을 빌드해 여섯 앱의 내용 해시 참조를 갱신했다.
- 일정 버전 상세의 프로젝트와 변경 이력의 직원 표시를 기존 공통 Avatar/ProjectIcon에 연결했다. 서버가 허용한 직원 목록에서 정확한 actor ID로만 사진 ID를 전달한다. 동명이인/목록 밖 변경자를 이름으로 연결하지 않으며 과거 변경자는 ‘이전 직원’, actor 0의 시트 이전 기록은 시스템 기록으로 구분한다. 프로젝트 선택·주요 일정 편집·버전 상세와 변경자에 허용된 비공개 표시를 보완했다. 기존 권한·저장 API·DB·스냅샷은 변경하지 않았다.
- 신규 브라우저 검사에서 긴 비공개 프로젝트명을 선택하면 모바일 320px 문서가 344px로 늘어나는 것을 발견했다. 버전 도구 모음의 flex 줄바꿈과 select 최소 너비를 보완했다. 문서 넘침을 숨기거나 검사 기준을 완화하지 않았고 넓은 버전 표의 자체 가로 스크롤은 유지했다. 수정 후 집중 Chrome 8개(PC/모바일·light/dark)가 모두 통과했다.
- 공통/계약/DOM/CI 정책 119개, 일정 단위 80개, 실제 서버 통합 49개가 통과했다. 시트·일정 배포 빌드 및 Razor fixture 생성 12개도 성공했다. 원본 여섯 이력·정확한 import tree·archive ref 21개 보존을 재확인했다. 통합 테스트 최초 호출의 잘못된 프로젝트 경로는 실행 전 실패했으며 실제 경로로 다시 실행한 49개 결과만 검증 증거로 사용한다.
- 모바일 다크 버전 목록/변경 이력 및 PC 라이트 변경 이력 화면을 직접 확인했다. Chrome의 IME 검증은 composition/keyboard 이벤트 주입이며 Windows의 실제 후보창 수동 검증은 아니다. 합성 계정/아이콘과 격리 API를 사용했으며 실제 직원·프로젝트·버전 데이터를 수정하지 않았다.
- 최종 여섯 서비스 Chrome 회귀 397개가 모두 통과했다(`artifacts/browser-entities-full`, 실패/재시도 0). 공통 자산 변경의 다른 소비 앱 영향까지 확인했으며 실제 운영 SSO·Docker 이미지·배포 검증 결과로 확대 해석하지 않는다. 생성 자산 일치와 diff 공백 검사도 통과했다.
- 버전 저장/충돌·다른 폼/표/표시 소비자의 공통화, 일반 HTML POST 실패 초안 복원, 실제 원격 CI 보호·배포 이미지 연결·독립 배포/롤백 리허설과 운영 이관은 계속 남는다. 원격 생성·푸시·운영 checkout·컨테이너·DB는 변경하지 않았다. 이번 표시 연결을 전체 목표 완료로 간주하지 않는다.

## 24차: 버전 기록의 공통 비교·저장 확인과 초안 보호 (2026-09-10)

- 일정 버전 편집을 `useReleaseEditor`로 분리하고 기존 공통 3방향 비교·결과 상태·history/navigation 이탈 보호를 연결했다. 최신 값으로 초안을 통째로 교체하던 경로를 제거했다. 저장 직전 기록과 디렉터리를 다시 확인하고 변경된 기록은 명시적으로 비교한다. 비교 적용은 기준 버전과 초안만 갱신하며 자동 저장하지 않는다.
- `releaseReview`가 날짜와 미기재 여부를 한 쌍으로 비교하고 롤백/해결 버전의 프로젝트·순서·상태 조합, 불변 식별자와 응답 버전·정규화된 저장 내용을 검사한다. 원문의 큰 정수를 숫자로 변환하지 않는다. 기존 서버 API·DB·권한·버전 충돌·감사 정책을 유지하며 보관 프로젝트의 기존 기록 수정도 보존한다.
- 중복 전송과 전송 중 편집을 잠그고 확인된 저장과 후속 목록 장애를 구분했다. 목록 재확인은 읽기만 수행한다. 불완전/HTML/통신/서버 오류는 미반영으로 단정하지 않으며 기존 초안을 유지한다. 신규 POST가 미확정이면 자동 재등록하지 않고 목록에서 확인한 뒤 다시 열도록 안내한다. 계정 범위 변경/해제 뒤 늦은 저장·참조 버전·이력 응답을 적용하지 않는다.
- 잘못된 변경 이력 JSON과 숫자형 날짜가 화면 렌더링을 중단시키지 않도록 수신 시 검사한다. 실제 편집 필드의 서명을 사용해 표시 메타데이터나 선택적 false/undefined 차이만으로 미저장 상태가 생기지 않게 했다. 공통 비교/응답 확인/범위/양쪽 이탈 보호 연결 누락을 구조 검사와 변이 테스트에 추가했다. 이는 알려진 회귀를 검출하는 정적 검사이며 임의 우회 전체를 증명하는 것은 아니다.
- 공통/계약/DOM/CI 정책 120개, 일정 단위 100개, 일정 서버 31개가 통과했다. 서버 테스트는 정규화된 확인 응답, 읽기의 기준/이력 무변경, 오래된 버전·타인·접근 회수 거부를 격리 DB로 확인한다. 서비스 통합 49개도 통과했으며 원본 여섯 이력·정확한 import tree·archive ref 21개 보존을 재확인했다. 일정 배포 빌드와 생성 자산 일치·diff 공백 검사도 통과했다.
- 일정 Chrome 전체 91개 통과(`artifacts/browser-release-schedule-verified`) 후 이력 날짜/오류 안내를 보완했다. 최종 버전 편집·표시 Chrome 17개를 다시 통과했다(`artifacts/browser-release-editor-final`, 실패/재시도 0). 신규 검사 13개는 PC/모바일·light/dark 비교/취소/포커스, 초안·계정·늦은 응답, 중복 전송, 신규 등록, 잘못된 응답 및 저장 성공 후 읽기 장애를 다룬다. 실제 React 배포 번들과 합성 API를 사용했으며 운영 기록은 수정하지 않았다.
- 최종 모바일 다크 저장 결과와 PC 라이트 비교창 이미지를 직접 확인했다. 이번에는 공통 자산 원본을 변경하지 않았으며 다른 다섯 앱의 브라우저 회귀를 재실행한 것으로 보고하지 않는다. 기존 서버의 경쟁 구간/멱등성을 새로 보장하거나 실제 운영 SSO·Docker 배포를 검증한 것은 아니다.
- 남은 범위: 버전 목록의 개별 상태·상세 펼치기, 다른 업무 폼/표·직원/프로젝트 표시, 일반 HTML POST 실패 초안 복원, 실제 원격 CI/보호·배포 이미지 연결·독립 배포/롤백과 운영 이관. 원격 생성·푸시·운영 checkout·컨테이너·DB는 변경하지 않았으며 전체 목표는 계속 진행 중이다.

## 25차: 버전 목록·변경 이력의 공통 펼치기와 조회 상태 (2026-09-10)

- 공통 `CompanyDisclosure`의 React 연결 `useWorkspaceDisclosure`를 추가하고 일정/시트에 같은 원본을 생성한다. React가 본문을 유지하고 공통 컨트롤러가 hidden·ARIA·키보드 포커스를 소유한다. 루트 교체·StrictMode·해제 시 이전 연결을 제거하며 공통 렌더러가 없으면 개별 구현으로 우회하지 않는다. 일정 마이너 목록·미기재 기록·변경 이력의 개별 토글/HTML details를 이 연결로 교체했다.
- `useReleaseList`는 기본/마이너/미기재 응답의 전체 구조·프로젝트·버전·중복 ID를 검사한다. 최초 실패를 빈 결과로 안내하지 않고 공통 오류/재조회 상태를 표시한다. 일시적인 갱신 실패에는 확인된 행을 유지하되 401/403·계정 범위 변경은 이전 행을 지운다. 프로젝트/범위 변경·접기·해제 뒤 늦은 응답을 적용하지 않으며 읽기 재시도는 저장을 반복하지 않는다. 기존 저장 이후 목록 실패 전달 경로와 서버 API·페이지 크기·인가·DB를 유지했다.
- 마이너 상세를 공통 표 내부 컨테이너에 연결하고 모바일에서 표 가로 스크롤과 상세 표시 폭을 분리했다. 버전 상태/문제/롤백/가이드 강조의 하드코딩 색과 별도 다크 팔레트를 공통 성공·오류 토큰으로 교체했다. PC 라이트와 모바일 다크의 실제 펼친 목록을 직접 확인했다.
- 공통 연결/조회 계약/테마 토큰 누락과 개별 펼치기 복귀를 구조 검사·변이 테스트에 추가했다. 생성기에서도 새 React 연결을 복제하며 원본과 generated 차이를 검사한다. 작업 지침과 개발/아키텍처/일정 README에 소유권·연결법·검증 명령을 기록했다. 정적 검사와 예제는 알려진 위반을 잡는 수단이며 모든 우회를 방지하는 절대적 보장은 아니다.
- 공통/계약/DOM/CI 정책 121개, 일정 단위 111개 및 일정 서버 31개, 시트 단위 22개와 타입 검사 통과. 일정·시트 배포 빌드, 생성 자산 일치 및 원본 여섯 이력·정확한 import tree·archive ref 21개 보존도 확인했다. 공통 adapter 검사는 실제 DOM 원본을 사용하는 모노레포 Vitest 검사이며 운영 앱에 테스트 원본이나 Node 파일 API를 포함하지 않는다.
- 신규 Chrome 5개는 두 너비/두 테마의 초기 실패→복구·키보드 펼치기·목록 페이지 추가·미기재/이력 읽기·상세 폭, 손상 응답과 계정 변경 후 늦은 응답을 검사한다. 최초 모바일 검사는 공통 DOM의 즉시 접힘 후 React 상태 반영 전에 다시 열어 조회 횟수를 잘못 단정했다. React의 닫힌 표기까지 확인하는 assertion을 추가하고 PC/모바일 5개를 통과했다. 실제 업무 로직이나 가로 넘침 검사를 완화하지 않았다.
- 여섯 서비스 Chrome 회귀 415개 통과(`artifacts/browser-release-lists-full`, 실패/재시도 0). 루트 교체 보완을 포함한 최종 번들로 버전 관련 22개도 다시 통과했다(`artifacts/browser-release-lists-final`). 실제 번들/기존 격리 Razor fixture와 합성 API를 사용했으며 실제 운영 계정·프로젝트·버전은 변경하지 않았다. 이번 단계에서 통합 서버 전체·Razor fixture 생성·실제 SSO·Docker/운영 배포를 새로 검증했다고 주장하지 않는다.
- 남은 범위: 회사 신규/단건 계정 폼과 일반 HTML POST 실패 초안, 일정 관리/주요 일정 및 다른 폼·표, CS의 나머지 실행/상태, 남은 직원/프로젝트 표시, 실제 원격 CI 보호·배포 이미지 연결·개별 배포/롤백 리허설과 운영 이관. 원격 생성·푸시·기존 운영 checkout·컨테이너·DB는 변경하지 않았다. 전체 목표는 계속 진행 중이다.

## 26차: 공통 폼의 계정 범위·해제·늦은 응답 경계 (2026-09-10)

- 공통 native POST 전송기에서 진행 중 계정 범위 변경 및 연결 해제 뒤의 응답이 기존 폼에 적용될 수 있는 경로를 확인했다. 요청 객체를 식별자로 삼고 응답 수신·JSON 처리·소비자 확인 이후 현재 요청인지 검사한다. abort를 무시하는 응답도 적용하지 않으며 오래된 finally가 새 요청의 잠금을 해제하지 않는다.
- scope 변경과 timeout은 즉시 원래 disabled/aria-busy를 복원하고 한 번만 종료를 알린다. dispose는 요청 관찰과 리스너를 정리하고 후속 콜백/포커스 갱신을 하지 않는다. 이미 서버에 반영되었을 가능성은 명시하며 자동 재전송·서버 롤백 보장을 추가하지 않았다. 기존 서버 인가·버전·antiforgery·트랜잭션·DB는 그대로다.
- onSaved의 전체 검증/동기 반영을 기본으로 명시하고 비동기 소비자에게 signal/isCurrent를 제공한다. 소비자 내부 await 뒤의 상태 변경은 해당 소비자도 검사해야 한다. onSettled는 확인된 성공·입력 거부·충돌·권한·미확정·범위 변경을 구분한다. 이 전송기는 새 계정 범위에서의 재검토·저장 허용 정책을 대신하지 않으며 신규 등록/일반 HTML POST를 자동 전환하지 않는다.
- 공통 폼 테스트 12개를 포함한 공통/계약/DOM/CI 정책 128개가 통과했다. 취소를 무시하는 fetch, JSON 및 비동기 소비자 처리 중 범위 변경, 해제/분리된 폼, timeout과 새 명시적 요청 사이의 늦은 응답을 확인했다. 취소 콜백이 dispose를 다시 호출하면 null.finish 오류가 발생하는 것을 추가 테스트로 재현한 뒤 요청 참조를 고정해 수정했다. 실제 서버 통합 49개 및 Razor fixture 생성 12개, 일정·시트 배포 빌드도 통과했다. 여섯 원본 이력·정확한 import tree·archive ref 21개 보존과 생성 자산 일치를 재확인했다.
- 직원 일괄 편집의 실제 Razor 화면에서 PC/모바일·light/dark에 대한 지연 응답 검사 4개를 추가했다. 기존 수정 초안·별도 신규 등록 초안·원래 버전·reset 기준·현황 수를 보존하고 자동 재전송하지 않음을 확인했다. API는 격리 응답이며 운영 계정은 수정하지 않았다.
- 최초 화면 확인에서 모바일 상태 문장이 한글 단어 중간에 나뉘는 것을 발견해 공통 안내의 word-break를 keep-all로 보완했다. 긴 식별자의 overflow-wrap:anywhere는 유지한다. 실제 글자 범위의 줄 개수와 문서 가로 넘침을 검사한다.
- 여섯 서비스 Chrome 회귀 419개가 통과했다(`artifacts/browser-form-lifetime-final`, 실패/재시도 0). 마지막 dispose 재진입 보완까지 포함해 자산·번들·Razor fixture를 다시 생성한 뒤 직원 저장·충돌 비교·상태 관련 16개도 통과했다(`artifacts/browser-form-lifetime-verified`, 실패/재시도 0). 최종 PC 라이트와 모바일 다크 화면을 직접 확인했다. 실제 Razor/React 산출물과 격리 응답의 검증이며 운영 SSO·실제 계정 쓰기·Docker 배포 검증은 아니다.
- 회사 신규/단건 계정 폼, 일반 HTML POST 실패 초안 복원, 다른 폼/업무 표·실행/직원·프로젝트 표시 및 원격 필수 검사·배포/롤백·운영 이관은 계속 남아 있다. 원격·운영 checkout·컨테이너·DB는 변경하지 않았다. 이번 공통 전송기 보완은 전체 목표 완료가 아니다.

## 27차: 신규 계정 등록의 공통 저장 확인과 별도 초안 보존 (2026-09-10)

- 신규 등록을 `CompanyForm` 전송·결과·요청 해제에 연결했다. 기존 직원 편집과 같은 `AccountFields`/`AccountInput`의 기본값 및 저장 값 투영을 사용한다. 업무별 응답 검증만 Portal adapter가 소유하며 독립 fetch/자동 새로고침을 추가하지 않았다. 구조 검사와 누락 변이 테스트도 연결했다.
- 계정·프로젝트 관계·연차 outbox를 기존 트랜잭션으로 저장하고, 같은 트랜잭션에서 전체 정규화 필드를 캡처한 다음 commit 완료 후 saved를 반환한다. ID/버전 ticks는 문자열로 유지한다. 공용 계정의 소속/연차 제외, 마스터의 프로젝트 제외, 상품 배포 권한의 의존 접근 권한 및 이름/이메일 정규화를 검증한다. 서버 인가·antiforgery·레거시 HTML 응답·DB 스키마는 유지했다.
- 명시적인 422 입력 거부만 재등록을 허용한다. 범위 변경·통신 실패·불완전 응답·미확정 결과는 입력을 보존하고 반복 등록을 잠근다. 비동기 응답이 늦게 와도 변경된 초안에 반영하지 않는다. 확인된 등록 이후 ‘다른 계정 등록’은 신규 폼만 초기화하며 기존 직원 일괄 편집 초안을 유지한다. 목록/현황이 이전 조회 시점임을 명시하고 새 탭 확인을 제공한다. 저장 여부를 추측해 현황을 증가시키지 않는다.
- 공통/계약/DOM/CI 정책 135개 및 실제 서버 통합 58개가 통과했다. 신규 서버 9개 사례에서 필드 정규화·중복 이메일·잘못된 소속/입사일·역할 권한·CSRF를 검사하고, 신규 ID 발급 뒤 프로젝트 저장 실패를 주입해 계정/프로젝트 버전까지 롤백됨을 확인했다. 계정 생성 DOM 테스트 6개는 늦은 응답·해제·다중 값·큰 문자열 ID·불완전 응답 및 다음 등록에서 이전 성공 문구가 남지 않음을 확인한다. 변이 테스트의 초기 실패는 등록 handler보다 앞에 있는 같은 문자열을 제거한 테스트 오류였으며 전체 해당 표식을 제거하도록 수정 후 135개를 재실행했다.
- 실제 Razor fixture 생성 12개 및 회사 홈 Chrome 회귀 100개가 통과했다(`artifacts/browser-account-create-portal`, 실패/재시도 0). 최종 버튼 표시/안내 초기화 보완 후 신규 등록 집중 8개를 다시 통과했다(`artifacts/browser-account-create-final`). 320/1440px·light/dark의 성공/입력 거부, 권한·범위·통신·잘못된 성공 응답과 다른 직원 초안 보존을 확인했다. 최종 모바일 다크·PC 라이트 화면을 직접 확인했으며 등록 완료 버튼을 중립적인 완료 표시로 구분했다.
- 여섯 원본 이력·정확한 import tree·archive ref 21개 보존과 생성 자산 일치를 확인했다. 공통 배포 자산은 변경하지 않았다. 다른 다섯 앱의 전체 브라우저/단위 테스트·React 빌드·실제 운영 SSO·Docker/운영 배포를 이번 단계에서 다시 검증했다고 주장하지 않는다. 브라우저 쓰기는 격리 응답, 서버 쓰기는 격리 DB이며 운영 직원은 수정하지 않았다.
- 레거시 단건 Update, 일반 HTML 일괄 POST 실패 초안 복원, 다른 폼/업무 표·실행/직원·프로젝트 표시 및 원격 필수 검사·배포/롤백·운영 이관은 남아 있다. 원격 생성·푸시·기존 운영 checkout·컨테이너·DB는 변경하지 않았다. 전체 목표는 계속 진행 중이다.

## 28차: 직원 일괄 편집의 공통 되돌리기와 계정 범위 보호 (2026-09-10)

- 직원 일괄 편집의 native confirm을 `CompanyDialog.confirm`으로 교체했다. 변경 직원 수와 미저장 초안만 되돌리는 작업임을 표시하고 별도 신규 등록 초안을 유지한다. 확인 전에 전체 행 입력을 캡처하여 확인 중 입력 변경·중복 실행·계정 범위 변경·페이지 해제 이후 되돌리기를 거부한다. 취소/Escape 후 기존 버튼으로 키보드 포커스를 복원한다.
- 기존 공통 전송기는 늦은 응답을 거부했지만 소비자가 계정 범위 변경 후 저장 버튼을 다시 활성화하던 경로를 보완했다. 현재 문서에서는 일괄 저장·충돌 재조회·되돌리기·권한 전체 전환을 잠그며 초안과 버전은 보존한다. 이전 요청의 서버 반영 가능성과 새 화면 확인 필요를 명시한다. 공통 비교/확인창도 닫고 이후 취소/오류 콜백이 권한 안내를 덮어쓰지 않게 했다. 신규 등록의 기존 범위 보호와 같은 정책이다.
- 저장 시점의 입력 서명을 보존해 전송 중 프로그램에 의해 바뀐 초안을 저장 응답이 덮어쓰지 못하게 했다. non-persisted pagehide에서 전송기·펼치기·신규 등록을 해제하고 비교 조회 및 모달 수명주기를 중단한다. bfcache 보관 이벤트는 연결을 유지한다. 클라이언트 abort를 서버 롤백으로 설명하지 않으며 기존 서버 인가·버전 충돌·API·DB는 변경하지 않았다.
- 누락 변이 검사에 공통 확인창·계정 범위·전송 입력 서명·해제 연결을 추가했다. 공통/계약/DOM/CI 정책 135개 및 실제 Razor fixture 생성 12개가 통과했다. 회사 홈 Chrome 회귀 109개 통과(`artifacts/browser-account-reset-final`, 실패/재시도 0) 후 모바일 버튼 문구를 줄이고 최종 fixture의 관련 13개도 통과했다(`artifacts/browser-account-reset-verified`).
- 새 브라우저 9개는 PC/모바일·light/dark 되돌리기 확인/취소/확인 중 초안 변경, 대기/확인창/비교창에서 계정 변경, 전송 중 입력 변경 및 non-persisted pagehide 후 취소를 무시하는 늦은 응답을 검사한다. 기존 비교 테스트는 계정 변경 후 계속 저장하던 기대를 제거하고, 같은 계정의 취소/재검토·새 버전 저장 검증은 유지했다. 별도 범위 변경 테스트는 반복 조회/쓰기가 차단됨을 확인한다. 실제 운영 계정은 변경하지 않았다.
- 최종 모바일 다크·PC 라이트 확인창을 직접 확인했다. 처음 모바일 캡처의 긴 버튼이 ‘기’ 한 글자로 나뉘어 ‘되돌리기’로 줄였으며 실제 글자 범위가 한 줄인지 검증했다. 원본 여섯 이력·정확한 import tree·archive ref 21개 및 생성 자산 일치를 재확인했다. 공통 배포 자산/다른 앱 소스는 변경하지 않았으며 다른 다섯 앱의 전체 브라우저·전체 서버 통합·운영 SSO·Docker 배포를 재검증한 것으로 보고하지 않는다.
- 일반 HTML POST 실패 재렌더링이 입력을 잃는 경로와 레거시 단건 Update는 조사했지만 이번에 변경하지 않았다. 다른 업무 폼/표·상태·직원/프로젝트 표시, 원격 필수 검사/보호·이미지 연결·개별 배포/롤백 및 운영 이관도 계속 남는다. 원격·기존 운영 checkout·컨테이너·DB는 변경하지 않았고 전체 목표는 진행 중이다.

## 29차: 서비스별 읽기 전용 배포 경계 사전 검사 (2026-09-10)

- 여섯 앱의 UI 서비스 식별자와 실제 Compose 서비스/컨테이너 식별자를 분리한 사전 검사 도구를 추가했다. 현재 컨테이너의 프로젝트·로컬 이미지 ID·mount·포트·네트워크와 명시적인 단일 서비스 후보 설정을 비교한다. 환경값·비밀 파일 내용·임의 label·health 로그를 출력하지 않으며 Docker 오류 원문도 숨긴다. up/restart/build/pull/볼륨 생성 기능은 없다.
- 후보 설정은 절대 Compose/환경 파일 경로, 기존 프로젝트 디렉터리와 이름을 요구한다. 다른 볼륨/checkout 연결, 읽기 전용 mount 변경, 포트 외부 노출, 프로젝트/네트워크 변경 및 이미지 digest 미고정을 차이로 보고한다. Windows drive/구분자만 정규화하고 디렉터리 대소문자·원격 엔진 경로를 임의로 동일시하지 않는다. 불완전 식별자와 지원하지 않는 mount 옵션은 수동 검토 대상으로 거부한다.
- 처음 기본 권한의 Docker 접근은 거부됐고 이후 승인된 읽기 전용 호출로 실제 여섯 컨테이너가 running임을 확인했다. 최초 전체 조회에서 healthcheck 미정의 컨테이너의 template 접근이 실패하여 존재 여부를 안전하게 읽도록 수정한 뒤 전체 조회가 성공했다. CS·통계·시트는 healthy, 나머지는 healthcheck 미정의(null)다. HTTP·운영 인증·업무 정상 여부까지 확인한 결과는 아니다.
- 원래 프로젝트 이름·작업 경로·환경 파일을 명시한 여섯 후보 모두 실제 mount/포트/네트워크와 일치했고 candidate-image-not-pinned만 남았다. CS는 cs_refund-audit, 통계는 statistics_statistics-data를 사용하며 시트는 기존 checkout의 data와 외부 자격 증명 파일 bind를 유지해야 한다. CS 프로젝트 이름만 cs-migration-probe로 바꾼 config 비교에서는 프로젝트·mount·네트워크 차이를 검출했다. 해당 이름으로 실제 리소스를 만들지 않았다.
- 신규 격리 테스트 8개 및 루트 공통/계약/DOM/CI 정책 테스트 143개가 통과했다. 잘못된 후보·경로·컨테이너 상태, 엔진 변경, 누락 파일, 비밀값 포함 오류와 결과 투영을 검사한다. 여섯 원본 이력·정확한 import tree·archive ref 21개 보존과 diff 공백 검사도 통과했다. 앱 코드·공통 UI 자산·CI는 변경하지 않았으며 앱 브라우저/서버 통합·이미지 빌드는 이번 단계에서 재실행하지 않았다.
- boundaryCompatible는 부분 비교일 뿐이고 deploymentApproved는 항상 false다. 신뢰된 CI/이미지 출처, 환경·보안 정책, 일관된 백업·스키마 호환성, 인증/업무 조회 및 전환/롤백 리허설은 미검증으로 명시한다. 현재 로컬 이미지 ID는 registry digest나 복구 보장이 아니다. 원격·운영 checkout·컨테이너·DB를 변경하지 않았으며 다른 업무 UI 공통화와 실제 원격/운영 이관을 포함한 전체 목표는 계속 진행 중이다.

## 30차: 직원 HTML 제출 실패의 초안·버전·되돌리기 기준 보존 (2026-09-10)

- 일반 HTML 일괄 POST가 실패하면 현재 DB 값만 다시 표시하던 경로를 수정했다. 같은 AccountFields/FormValues로 만든 ID·버전 문자열·수정 전 기준을 함께 제출하고, 표현 가능한 초안만 같은 `_AccountField` 편집 양식에 복원한다. 기존 전송 버전을 유지하며 현재 DB 버전으로 자동 교체하지 않는다. 서버 API 확인 응답은 여전히 실제 저장값만 반환한다.
- 기준값은 표시/되돌리기용 비신뢰 데이터다. 형식·ID/버전 일치·현재 편집 권한·선택 목록을 확인하지만 서버 인가·Prepare·버전 검사·트랜잭션을 대신하지 않는다. 잘못된 날짜/손상 또는 누락 기준/수정 불가 계정은 계약 필드 원문을 복사용으로 보관한다. 임의 POST 키·CSRF 토큰·서버 예외 원문은 반영하지 않으며 no-store와 Razor 인코딩을 사용한다.
- 신규 등록의 일반 실패도 별도 초안을 유지하고 표현할 수 없는 입력은 원문으로 보관한다. 결과가 불확실한 등록/일괄 저장은 해당 폼의 반복 쓰기를 잠근다. 레거시 단건 Update 실패는 복사용 원문만 제공하며 단건의 공통 저장 수명주기 연결을 완료했다고 보지 않는다. handler 전에 거부된 요청·네트워크 장애·다른 폼에서 전송하지 않은 입력은 복원 범위 밖이다.
- 복원 행은 공통 펼치기로 열고 공통 변경 표시/3방향 비교/되돌리기를 유지한다. 원문 보관 영역도 CompanyDisclosure로 연결하고 페이지 해제 시 정리한다. 보관 부서/프로젝트를 초안에서 제거했어도 원래 값으로 되돌릴 선택지는 남긴다. JS 없는 경우 같은 native 필드의 상세와 전체 제출 버튼을 제공하며 별도 편집기나 브라우저 영구 저장소를 만들지 않았다.
- 최초 Chrome 집중 검사에서 row._original만 복원하고 native defaultValue/defaultChecked/defaultSelected를 연결하지 않아 되돌리기가 실패한 것을 재현했다. 현재 초안을 유지한 채 native reset 기준을 원래 값으로 설정하도록 수정했다. noscript 상세도 공통 hidden 우선순위 때문에 숨겨지는 것을 발견해 해당 fallback 전용 CSS로 보완했다. 처음 실패한 9개를 성공으로 계산하지 않았고 수정 후 집중 11개/최종 추가 13개가 통과했다.
- 최종 회사 홈 Chrome 회귀 122개 모두 통과(`artifacts/browser-html-recovery-verified`, 실패/재시도 0). 실제 Razor 실패 응답으로 PC/모바일·light/dark 초안·기존 버전·3방향 충돌·별도 신규 초안·되돌리기·원문 열기/닫기·XSS 미실행·미확정 재전송 차단을 검사했다. JS 비활성 브라우저의 실제 native FormData 전체 제출도 격리 응답으로 확인했다. 최종 모바일 다크 원문 및 PC 라이트 복원 편집 화면을 직접 확인했다.
- 신규 서버 11개를 포함한 실제 서버 통합 69개가 통과했다. 중복 이메일/다른 작성자의 변경 보존·손상 기준·권한·잘못된 바인딩·보관 선택·격리 DB 쓰기 실패를 검사했다. Razor fixture 생성은 기존 페이지 12개와 계정 검사 35개를 함께 실행해 47개 통과했다. 공통/계약/DOM/CI 정책 144개, 원본 여섯 이력·정확한 import tree·archive ref 21개 및 diff 공백 검사를 재확인했다.
- 공통 배포 자산·다른 앱 업무 소스·CI workflow·운영 계정/DB는 변경하지 않았다. 다른 다섯 앱의 전체 브라우저/배포 빌드·Docker 이미지·실제 운영 인증을 재검증한 것으로 보고하지 않는다. 다른 업무 폼/표·상태·직원/프로젝트 표시, 원격 필수 검사/보호·이미지 연결·서비스별 배포/롤백과 운영 이관은 계속 남아 있으며 전체 목표는 진행 중이다.

## 31차: CS 로그 검색의 공통 상태·상세와 작업 이어받기 (2026-09-10)

- 로그 검색의 자체 토스트·빈 결과·부분 실패 안내를 `CompanyState`로, EventData 상세를 단일 `CompanyDisclosure`로 연결했다. 결과 카드·선택 상태·JSON의 하드코딩 색을 공통 의미 토큰으로 교체하고 작은 메타 글꼴을 보완했다. 상세 JSON은 기존 lossless formatter로 큰 정수와 문자열 원문을 보존하며 모바일에서는 내부 스크롤을 사용한다.
- 기존 job handler의 ID·라이브 Title·진행/완료 구조와 알고 있는 검색 조건을 검증한 뒤 결과/CSV에 반영한다. 현재 입력창과 별도로 실제 결과의 검색 조건을 표시한다. 입력 검증 실패는 기존 결과를 유지하고, 부분 파일 오류를 완전한 빈 검색 결과로 표시하지 않는다. 기존 서버 소유자 인가·검색 기간 무제한·장기 확인·큐·취소·결과 상한은 변경하지 않았다.
- 탭 저장소의 작업 ID를 회사 사용자별로 분리했다. 검색 문자열·결과를 브라우저 저장소에 저장하지 않는다. 구형 공용 키는 서버의 소유자 조회를 통과한 뒤 옮긴다. 일시적인 상태 읽기 오류는 ID를 지우지 않으며 명시적인 재확인은 기존 status만 읽는다. 404와 401/403을 구분하고 계정 범위 변경은 검색 문자열/결과를 지운다.
- 검색 시작 응답이 미확정이면 반복 실행을 잠그고 자동 CSRF POST 재전송을 제거했다. 45초 관찰 제한·페이지 해제·계정 범위 변경 뒤 늦은 응답과 이전 취소 응답이 새 결과를 덮어쓰지 않는다. 관찰 abort를 서버 검색 취소/롤백으로 설명하지 않는다. 백그라운드 작업 전체를 공통 폼 전송기로 대체하지 않고 표시·펼치기만 공통 소유한다.
- 신규 계약 검사 2개를 포함해 CS 테스트 86개와 문법 검사가 통과했다. 기존 서버 job 테스트의 실제 status 응답에도 새 계약 검증을 연결했다. 공통/계약/DOM/CI 정책 145개가 통과하며 연결·상태·색상·큰 정수 포맷터·작업 식별자 누락 변이를 검사한다. 생성기 격리 복사 목록에 새 검사 입력을 포함했고 검사 예외를 추가하지 않았다. 원본 여섯 이력·정확한 import tree·archive ref 21개와 diff 공백 검사도 통과했다.
- CS Chrome 회귀 66개 통과(`artifacts/browser-log-search-final`) 후 요청 timeout/HTML 권한 응답 처리를 보완하고 최종 로그 검색 20개를 통과했다(`artifacts/browser-log-search-verified`, 실패/재시도 0). 실제 페이지 JS와 실제 job handler를 연결하고 모든 HTTP·Azure 목록·Parquet를 격리했다. 320/1440px·light/dark, 키보드 펼치기·정수 원문·장기 확인·부분 결과, 이어받기/조회 재시도·설정 복구·401/403/404·불완전 응답·미확정 시작·계정 변경·해제·timeout·늦은 취소를 확인했다.
- 첫 브라우저 실행의 5개 실패는 브라우저 현지 시각과 합성 UTC 이벤트 시각 불일치였으며 fixture 시간대를 UTC로 명시해 실제 검색 조건/결과 검사를 다시 수행했다. 공통 범위 이벤트가 document의 비버블 이벤트임도 확인해 소비 리스너와 테스트를 실제 계약에 맞췄다. 모바일 다크 상세와 PC 라이트 결과/빈 상태를 직접 확인했다. 최종 데이터 영역의 긴 JSON은 내부 스크롤하고 문서 가로 넘침 검사는 유지했다.
- 기존 문서의 ‘동시에 하나·라운드 로빈’ 설명이 현재 서버의 병렬 슬롯 정책과 다른 것을 확인해 바로잡았다. 공통 배포 자산·다른 앱 업무 코드·CI workflow·운영 계정/DB는 변경하지 않았다. 다른 다섯 앱의 전체 브라우저/빌드·실제 Azure 자격 증명·운영 SSO·Docker 배포를 새로 검증한 것으로 보고하지 않는다. 다른 업무 UI 소비자와 원격 필수 검사/보호·이미지 연결·개별 배포/롤백·운영 이관은 계속 남아 있으며 전체 목표는 진행 중이다.

## 32차: Steam 환불의 공통 확인·결과와 도메인 검증 경계 (2026-09-10)

- Steam 거래 조회/환불 화면의 native confirm·자체 토스트를 공통 `CompanyDialog.confirm`과 `CompanyState`로 전환했다. 거래 표·상태 배지·위험 영역은 공통 프레임/의미 토큰을 사용하고 모바일 내부 스크롤·입력 정렬·글꼴을 보완했다. 다른 주문으로 조회 대상을 바꿀 때 기존 환불 초안을 지우려면 명시적 확인이 필요하며 취소/조회 실패는 기존 거래와 사유를 유지한다.
- 확인 전에 서버 설정과 거래를 다시 읽고 환경·실제 Order ID·Steam ID·사유·거래 서명을 고정해 확인 직후 재검증한다. 새 응답 계약은 uint64 문자열 정밀도, 조회 방식별 대상, 검증 플래그 및 환불 완료 필드를 검사한다. 전송 중 native fieldset 잠금과 현재 operation 식별자로 중복 실행·계정 변경·해제·늦은 JSON 응답의 적용을 막는다. 확인 취소/Escape는 초안과 키보드 포커스를 유지한다.
- 완료 응답을 확인한 환불과 후속 거래 조회를 분리했다. 이후 조회 장애는 환불 성공을 실패로 바꾸지 않으며 재확인은 읽기만 수행한다. 불완전 응답·네트워크/HTML 오류·45초 관찰 제한은 미확정으로 안내하고 사유와 같은 문서의 주문별 반복 실행 잠금을 유지한다. Succeeded 재조회도 잠금을 자동 해제하지 않는다. 이 메모리 잠금은 새 문서/서버 재시작을 포함한 영구 멱등성 보장이 아니며, 브라우저 abort는 서버 환불 취소가 아님을 문서화했다.
- 기존 app-server의 거래 처리 부분을 `steam-transaction-api.js`로 추출했다. SSO·CS 접근·CSRF/Origin·속도 제한·실행 허용 검사·API 경로는 유지하고, 실제 도메인 handler의 거래 재검증·프로세스 내 주문 잠금·시도/성공/실패 감사 기록을 격리 Steam client로 검사한다. 감사 시도 기록 실패는 Steam 호출 전 중단하며 성공 후 감사 기록 실패는 환불 실패로 안내하지 않는다. 기존 gateway 테스트에 조회/환불의 CSRF·출처 거부와 신규 정적 자산 제공 검증을 추가하고 테스트 Steam 키를 명시적으로 비웠다.
- CS 테스트 92개, 기존 및 신규 모듈 문법 검사, 루트 공통/계약/DOM/CI 정책 146개가 통과했다. 공통 확인/상태·검증 계약·operation/receipt·테마·native 잠금 누락에 대한 구조 변이 검사를 추가하고 생성기 fixture도 연결했다. 원본 여섯 Git ancestry·정확한 import tree·archive ref 21개와 diff 공백 검사도 통과했다.
- 최종 CS Chrome 회귀 94개가 실패/재시도 없이 통과했다(`artifacts/browser-steam-final`: Steam 26, 로그 검색 20, 플레이어 데이터 23, 셸 25). 실제 페이지 JS와 추출 도메인 handler를 사용하되 모든 브라우저 HTTP/Steam/PlayFab/Azure를 격리했다. Production/Sandbox 합성 설정, 320/1440px·light/dark, 조회/확인/취소·대상 변경·전송 잠금, 성공 뒤 읽기 장애·미확정·권한 거부·timeout·계정 변경·페이지 해제·abort를 무시하는 응답을 검증했다. 모바일 다크 확인창과 최종 PC 라이트 결과 화면을 직접 확인했다.
- 공통 생성 자산·다른 다섯 앱 업무 코드·CI workflow·운영 환경/DB/외부 API는 변경하지 않았다. 실제 Steam 환불·운영 SSO·다른 앱 전체 빌드/브라우저·Docker 배포를 검증한 것으로 보고하지 않는다. 남은 업무 UI 소비자, 원격 저장소/필수 검사 보호·이미지 출처·개별 배포/롤백·운영 이관은 계속 남아 있으며 전체 목표는 진행 중이다.

## 33차: 상품 지급·회수의 공통 확인과 실행 결과 계약 (2026-09-10)

- 상품 명령 실행·실패 UID 재시도·대기 명령 삭제를 `CompanyDialog.confirm`으로 연결하고 개별 확인 모달을 제거했다. 결과/오류/경고는 `CompanyState`, 표와 상태 배지는 공통 프레임·의미 토큰으로 전환했다. 모바일 확인창 내부 스크롤과 고정 실행 버튼, 작은 메타 글꼴, 입력 정렬을 보완했다. 명령 JSON 표시는 lossless formatter로 큰 정수 원문을 보존한다.
- 기존 미리보기 토큰·UID별 요청 ID·병합 승인·DataVersion 스냅샷을 유지한다. 설정·미리보기·실행·조회·삭제 응답의 대상 집합·개수·환경·키·실행 모드와 요청 ID를 검증한 뒤 화면에 반영한다. 실행 전 설정과 로그인 범위를 다시 읽고 확인 전후 입력 서명을 비교한다. 실패 UID 재시도는 같은 토큰/요청 ID와 직전 실행 모드를 사용하며, 새로운 미리보기는 별도 요청 ID를 발급한다는 중복 위험을 확인받는다.
- native fieldset과 operation 식별자로 전송 중 입력·중복 실행을 잠근다. 계정 범위 변경/401/403은 결과를 제거하고 잠그며, 비버블 범위 이벤트·페이지 해제·45초 관찰 제한 뒤 늦은 응답이 현재 UI를 바꾸지 않게 했다. 실제 쓰기 결과가 미확정이면 초안을 유지하고 현재 문서의 추가 쓰기와 새 미리보기를 잠근다. 명시적인 명령 조회는 허용하지만 미확정 쓰기를 재전송하거나 잠금을 자동 해제하지 않는다.
- 확인된 삭제와 이후 조회 장애를 분리했다. 후속 읽기가 실패해도 삭제 성공을 유지하고 재확인 버튼은 조회만 실행한다. 삭제 대상의 원문/버전, 반대 작업 키와 감사 결과를 유지한다. 상품 명령 등록 성공을 게임 내 지급·회수 완료로 표시하지 않는다. 기존 서버의 인가·CSRF/Origin·속도 제한·감사 기록·PlayFab 재시도 및 읽기-쓰기 경쟁 구간은 변경하지 않았으며, 영구 멱등성이나 브라우저 abort에 의한 서버 롤백을 새로 보장하지 않는다.
- CS 테스트 96개와 문법 검사, 루트 공통/계약/DOM/CI 정책 147개가 통과했다. 신규 계약 테스트는 실제 상품 API handler와 메모리 PlayFab을 사용하며 손상된 대상/개수/모드/요청 ID/버전을 거부한다. 구조 변이 검사는 공통 연결·응답 계약·작업 식별자·테마·native 잠금의 누락을 검출하며 생성기 격리 입력에도 연결했다. 검사 예외나 CI 축소는 추가하지 않았다.
- CS Chrome 전체 회귀 116개가 실패/재시도 없이 통과했다(`artifacts/browser-products-final`: 상품 22, Steam 26, 로그 검색 20, 플레이어 데이터 23, 셸 25). 마지막 경고/모드 배지를 공통 표시로 정리한 뒤 상품 22개를 다시 통과했다(`artifacts/browser-products-complete`). 라이브/테스트 합성 환경, 320/1440px·light/dark, 취소/포커스·확인 중 변경·병합/버전 충돌·동일 ID 재시도·일부 실패·미확정 응답·삭제 후 읽기 장애·권한 거부·timeout·범위 변경·해제와 늦은 응답을 검사했다. 실제 운영 API/계정 데이터는 사용하지 않았다.
- 첫 집중 실행에서 Playwright의 fieldset disabled 판정이 실제 native 속성과 다른 것을 확인해 실제 입력 잠금과 fieldset.disabled 속성을 검사하도록 바로잡았다. 반복된 동일 오류에서 공통 상태의 렌더링 캐시와 개별 DOM 초기화가 충돌하는 문제도 수정하고 같은 오류를 연속 표시하는 회귀 검사를 추가했다. 최종 모바일 다크 확인창과 PC 라이트 결과 화면을 직접 확인했다. 원본 여섯 이력·정확한 import tree·archive ref 21개와 diff 공백 검사를 재확인했다.
- 공통 생성 자산·다른 앱 업무 코드·서버 업무 처리·운영 환경/DB·기존 저장소·Docker는 변경하지 않았다. 다른 다섯 앱 전체 검사·실제 PlayFab 쓰기·운영 SSO·배포를 새로 검증한 것으로 보고하지 않는다. 남은 업무 UI 소비자와 원격 필수 검사 보호·이미지 출처·개별 배포/롤백·운영 이관은 계속 남아 있으며 전체 목표는 진행 중이다.

## 34차: 플레이어 조회 공통 상태와 CS 개별 토스트 제거 (2026-09-10)

- 플레이어 데이터의 설정·조회·오류·검색 빈 결과를 `CompanyState`로 연결했다. 마지막 소비자였던 플레이어 조회 전환 후 CS 전용 토스트 JavaScript와 공용/라이트 CSS를 제거했다. 페이지의 별도 회사 사용자 이름 렌더링도 제거하여 공통 셸의 계정 표시 소유권을 유지한다. 저장/추가/삭제의 기존 공통 확인창과 결과 영역은 그대로 사용한다.
- 기존 API의 전체 세 저장소 응답에 더해 설정의 저장소·압축·환경·활성 플래그 및 기본 인증 응답을 검증한다. 조회 시작의 대상·편집 원문·사유·확인 상태를 캡처하고, 입력/계정/화면 범위가 달라지면 이전 응답을 적용하지 않는다. 일시적 읽기 실패와 401/403 HTML은 빈 결과로 표시하지 않으며 이전 결과/초안을 보존하되 새 조회 성공 전 기존 토큰의 쓰기를 잠근다. 재확인은 읽기만 수행하고 초안 폐기에는 기존 동기식 확인을 유지한다.
- 요청 관찰은 AbortSignal과 Promise 경합으로 제한한다. 취소를 무시하는 fetch/JSON도 관찰 시간이 지나면 UI 잠금을 끝내며 늦은 응답은 적용하지 않는다. JSON 수신 후 권한 안내 전에 범위를 재검사하여 오래된 401이 새 로그인 안내를 띄우지 않는다. 이전 조회의 finally는 새 조회를 풀지 않으며 non-persisted pagehide는 요청·확인창·펼치기·ResizeObserver/테마 관찰자를 해제한다. 이 처리는 서버 취소·롤백·영구 멱등성 보장이 아니다.
- 플레이어 CSS의 고정 색과 별도 light 덮어쓰기를 의미별 토큰으로 바꾸고 메타/버튼 글꼴을 보완했다. canvas 수정 배경·추가·삭제·현재 변경 표시도 공통 색을 읽고 테마가 바뀌면 다시 그린다. 단일 편집기 DOM·초안·커서/스크롤, 세 저장소별 편집 토큰, 64비트 정수/이스케이프 원문, GZip 검증/저장 및 기존 서버 인가·감사/경쟁 구간은 유지한다.
- 최초 기존 회귀에서는 실패한 재조회 뒤 곧바로 추가를 허용하던 기대가 새 잠금 정책과 달라 실패했다. 실패 뒤 추가가 비활성인지 확인하고 명시적 최신 조회 성공 후 추가/삭제하는 검증으로 바꿨다. 추가 검사에서 공통 상태의 재확인 옵션 연결 누락도 발견해 실제 `actionLabel`/`onAction` 계약으로 수정했다. 실패한 실행을 통과로 집계하지 않았고 수정 후 플레이어 37개가 통과했다.
- 최종 CS Chrome 회귀 130개가 실패/재시도 없이 통과했다(`artifacts/browser-player-state-final`: 플레이어 37, 상품 22, Steam 26, 로그 검색 20, 셸 25). 신규 14개는 320/1440px·light/dark 상태·canvas 색 전환/복원, 설정 복구·반복 오류·읽기 전용 재시도·HTML 권한 거부·잘못된 대상·입력 변경·계정/해제·취소를 무시하는 JSON과 timeout을 검사한다. 모바일 다크 빈 검색/편집 상세 및 PC 라이트 JSON 편집 화면을 직접 확인했다. 모든 브라우저 HTTP와 PlayFab/Steam/Azure 전송은 격리했다.
- CS 테스트 97개와 문법 검사, 루트 공통/계약/DOM/CI 정책 147개가 통과했다. 공통 상태 재확인·설정 계약·작업 식별자·독립 관찰 종료·테마/토스트 복귀를 구조 변이 검사로 검출한다. 원본 여섯 Git ancestry·정확한 import tree·archive ref 21개와 diff 공백 검사도 재확인했다. 공통 생성 자산·다른 다섯 앱 코드·CI·서버 업무 처리·기존 저장소/운영 환경·DB·Docker는 변경하지 않았다. 다른 앱 전체 검사·실제 운영 인증/배포를 새로 검증한 것으로 보고하지 않는다. 남은 업무 UI와 원격 필수 검사 보호·이미지 출처·개별 배포/롤백·운영 이관은 계속 남아 있으며 전체 목표는 진행 중이다.

## 35차: 연차 알림 센터 공통 폼·상태 및 계정 범위 검증 (2026-09-10)

- Leave 알림의 읽음·모두 읽음·확인을 `CompanyForm`에 연결했다. native POST와 antiforgery 토큰을 유지하며, 서버 저장 후 `workspace-form-v1` 작업·문자열 직원/알림 ID·로컬 경로 응답을 전체 검증한 뒤 읽음 상태를 바꾼다. 현재 직원 소유 여부를 확인하고 존재하지 않는 알림은 성공 응답으로 위장하지 않는다. 기존 값 없는 native POST와 GET Open URL은 호환 목적으로 남겼다.
- 새 폼의 `expectedEmployeeId`를 서버의 현재 직원과 대조한다. 계정 변경을 아직 관찰하지 못한 오래된 문서도 다른 계정의 모두 읽음을 수행하지 못한다. enhanced 요청은 계정 값이 필수이며 원래의 중앙 세션·활성/폐기·CSRF 검증도 유지한다. 64비트 ID는 문자열로 전송·검사한다.
- `CompanyState`가 빈 목록·저장 중·실패·성공·계정 변경을 표시하며 알림 항목 색은 공통 의미 토큰을 사용한다. 결과가 미확정이면 기존 읽지 않음 상태를 임의 변경하지 않고 쓰기를 잠그며 GET 재확인만 제공한다. 계정 변경은 이전 목록을 제거하고 timeout/화면 해제/입력 변경 뒤 늦은 응답은 적용하지 않는다. 읽음 성공 후 상단 갱신 실패는 성공을 되돌리거나 쓰기 재전송으로 처리하지 않는다.
- 최근 120개가 전부 읽음이어도 더 오래된 미읽음이 남으면 모두 읽음을 사용할 수 있도록 전체 미읽음 수로 표시 여부를 결정한다. 서버는 기존처럼 현재 직원의 전체 미읽음을 처리한다. 원본 알림 DB·스키마·내부 통합 알림 API·Discord·연차 승인 업무는 바꾸지 않았다.
- 실제 Portal/Leave TestServer와 격리 SQLite의 신규 알림 검사 6개를 포함한 .NET 통합 75개가 통과했다. 실제 저장/반복 읽음 시간 유지·다른 직원·CSRF·잘못된 ID/화면 계정·DB trigger 실패·과거 미읽음·외부 링크·native URL·중앙 401/403/503을 검사하고 실제 Razor/응답 fixture를 생성했다. 일정 클라이언트 TypeScript/Vite 빌드를 선행했다.
- 최종 Chrome 검사 118개가 실패/재시도 없이 통과했다(`artifacts/browser-leave-notifications-verified`: 알림 19 + 기존 Leave 셸 99). 키보드 Enter·320/1440px light/dark·저장 전 전체 잠금·개별/전체 읽음·확인 이동·잘못된 응답·HTML/401/403/500·계정/대상 변경·해제·timeout·취소를 무시하는 JSON·상단 갱신 실패를 검사했다. 모바일 다크와 PC 라이트 알림 화면을 직접 확인했다. HTTP는 모두 격리했고 운영 알림을 읽음 처리하지 않았다.
- 최초 서버 집중 검사에서는 로컬 fallback 경로의 실제 Razor URL(`/Notifications/Index`)과 테스트 기대가 달라 수정했다. 브라우저 최초 실행은 기본 Chromium 미설치로 실행되지 않았으며 설치된 Chrome으로 실행했다. Chrome 초기 회귀의 fieldset 판정 차이는 실제 native disabled 속성/하위 버튼 검사로 고쳤고, 테스트용 이동 화면의 UTF-8 선언 누락도 수정했다. 실패 실행은 최종 통과 집계에 포함하지 않았다.
- 루트 계약/DOM/구조/CI 정책 149개와 원본 여섯 이력·정확한 import tree·archive ref 21개, diff 공백 검사를 통과했다. 알림 소비자가 공통 폼·상태·teardown·계정 대조·의미 토큰을 우회하면 구조 변이 검사가 실패한다. 공통 생성 자산·다른 서비스 업무 코드·CI·원격 저장소·운영 환경/DB·Docker는 변경하지 않았다. 나머지 업무 UI 소비자 및 원격 보호·이미지 출처·개별 배포/롤백·운영 이관은 계속 남아 있으며 전체 목표는 진행 중이다.

## 36차: Discord 개인 알림 공통 설정·확인창 연결 (2026-09-10)

- Leave Discord 설정의 Save/Unlink/Test를 `CompanyForm`과 `CompanyState`에 연결했다. 개별 confirm을 제거하고 Unlink 및 변경 중인 설정을 버리는 Link 이동에 `CompanyDialog.confirm`을 사용한다. 서버의 실제 작업·문자열 ID·정규화된 설정 응답을 전체 검증한 후에만 저장/해제 상태를 반영하며, DM 테스트는 수신 설정 초안을 저장하거나 지우지 않는다. 테스트 DM의 요청 수락과 실제 수신도 구분한다.
- OAuth Link는 외부 redirect와 state cookie를 사용하는 기존 native POST로 남겼다. callback·OAuth token 교환·Discord 봇 HTTP·카탈로그/역할별 정규화는 기존 서버의 책임이다. 기존 CSRF·현재 직원·중앙 세션 검증과 값 없는 native POST 호환을 유지한다. 새 양식의 화면 직원 ID와 설정 fingerprint를 현재 서버 값과 대조하여 오래된 문서에서 다른 Discord 연결을 수정/해제/테스트하지 않는다. 이 검사는 원자적 DB 경쟁 제어나 영구 멱등성을 새로 보장하지 않는다.
- 실패/미확정 응답은 초안을 유지하고 자동 재전송 없이 설정/수신 여부를 확인하게 한다. 확인 중 입력 변경, 계정 변경, timeout, 해제 및 취소를 무시하는 JSON 뒤에는 이전 결과를 적용하지 않는다. 계정 범위 변경은 이전 Discord 식별정보와 확인창을 제거한다. native beforeunload 의미는 유지하며 OAuth 이동을 명시적으로 확인한 뒤 중복 이탈 확인을 띄우지 않는다.
- 개별 다크 덮어쓰기와 사용되지 않는 Discord 메뉴 CSS를 제거했다. 상태·선택·hover·포커스는 공통 의미 토큰을 사용하며 선언되지 않은 토큰 이름도 구조 검사에서 거부한다. 서버 설정 안내도 공통 오류 상태를 사용하고 모바일의 저장 안내가 고정 상단바에 가리지 않도록 위치를 조정했다.
- 초기 서버 테스트 코드의 잘못된 인수 표기를 수정한 뒤 신규 Discord 6개를 포함한 전체 .NET 통합 81개가 통과했다. 실제 SSO/SQLite/handler와 격리 Discord HTTP로 설정 저장·역할별 필터·다른 직원 보존·해제·DM 수락/실패·DB 실패·CSRF·이전 계정/fingerprint·실제 재연동 뒤 오래된 요청·OAuth cookie/redirect·기존 native POST를 확인했다. 일정 TypeScript/Vite 빌드를 선행했다. 실제 Discord 로그인이나 DM 발송은 하지 않았다.
- Chrome 전체 Leave 회귀 139개가 실패/재시도 없이 통과했다(`artifacts/browser-leave-discord-final`: Discord 21 + 알림 19 + 셸 99). DM/해제 결과 문구를 최종 구분한 후 해당 Discord 21개를 다시 통과했다(`artifacts/browser-discord-verified`). 일반/관리자 실제 Razor와 미연동 상태, 320/1440px light/dark, 키보드 제출, 선택 배경의 실제 토큰 값, 전체 요청 잠금, 확인 취소/포커스, 초안 보존, OAuth native 이동, scope/timeout/해제/늦은 JSON을 검사했다.
- 초기 브라우저 검사에서 확인 전에 fieldset을 잠그며 버튼 포커스를 잃는 문제를 재현하여 잠금 전 opener를 캡처하도록 수정했다. 모바일 다크·PC 라이트 설정과 공통 해제 확인창을 직접 확인했고, 처음 이미지에서 발견한 고정 상단바의 저장 안내 가림도 수정 후 위치 검사·이미지로 재확인했다. 실패 실행을 최종 통과 수에 포함하지 않았다.
- 루트 계약/DOM/구조/CI 정책 151개, 문법·diff 공백 및 원본 여섯 ancestry/정확한 import tree/archive ref 21개 검사를 통과했다. 공통 생성 자산·다른 서비스 업무 코드·CI·원격·운영 DB/설정·Docker는 변경하지 않았다. 나머지 업무 UI와 원격 필수 보호·이미지 출처·개별 배포/롤백·운영 이관은 계속 미완료이며 전체 목표는 진행 중이다.

## 37차: 여섯 서비스 테마 소스 자동 검사 (2026-09-10)

- 특정 소비자 파일만 검사하던 공통 토큰 이름 검사를 서비스 등록 기반으로 확장했다. `check-theme-contract.mjs`가 Razor Pages/wwwroot, 정적 public, React client/document 및 공통 UI의 203개 소스를 수집한다. 새 중첩 파일도 자동 포함하며 미정의/계산된 리터럴 토큰 참조와 개별 CSS·inline/JS/React 재정의를 거부한다. 공통 정의는 light/dark 쌍을 검증하고 두 레이아웃 치수와 backdrop은 모드 공통으로 유지한다.
- 기존 `check:ui` 구조 검사에 연결했고 새 파일·새 페이지 생성 후 잘못된 CSS가 실제 검사 명령에서 거부되는 회귀를 추가했다. Portal의 정확한 생성 CSS만 기존 생성기 바이트 검사에 맡기며, 기존 Leave Bootstrap/jQuery 계열 네 vendor 경로 외에는 임의 예외를 추가하지 않았다. 리터럴 기반 정적 검사는 완전한 CSS/JS 파서나 모든 하드코딩 색상·대비 검증이 아니므로 시각 검증과 기존 업무 UI 이관은 계속 필요하다.
- 실제 누락으로 발견된 Leave mobile.css의 `--cw-input`과 CS 상품 CSS 세 곳의 `--cw-surface-alt`를 정의된 `--cw-raised`로 수정했다. Chrome 계산 배경색 회귀를 추가했다. 이미지 검토에서 모바일 CS 입력 오류 설명이 극단적으로 말줄임되는 것도 확인하여 설명 줄바꿈과 배지의 다음 행 배치를 적용했다.
- 최종 루트 검사 157개, CS 단위 97개 및 문법 검사, Chrome 상품 22개 + Leave 셸 99개(총 121개)가 실패/재시도 없이 통과했다. 최종 화면은 `artifacts/browser-theme-contract-final`에 남겼으며 모바일 다크 상품 오류 및 모바일 다크/PC 라이트 Discord 안내의 실제 배경과 줄바꿈을 직접 확인했다. 기존 실제 Razor fixture와 격리 HTTP/PlayFab을 사용했으며 이번 단계에서 .NET 통합 검사를 새로 수행한 것은 아니다.
- 원본 여섯 Git ancestry·정확한 import tree·archive ref 21개 및 diff 공백 검사도 통과했다. 공통 runtime/생성 자산·서버 인가/업무 처리·CI workflow·원본 저장소·원격·운영 데이터·Docker는 변경하지 않았다. 다른 네 앱 브라우저 전체나 운영 인증/배포를 새로 검증한 것으로 보고하지 않는다. 남은 업무 UI와 원격 보호·이미지 출처·개별 배포/롤백·운영 이관은 미완료이며 전체 목표는 계속 진행 중이다.

## 38차: 통합 알림의 정확한 식별자 계약 (2026-09-10)

- Portal의 공개 알림 JSON과 공통 셸에서 64비트 ID가 JavaScript 숫자로 반올림될 수 있는 경로를 확인했다. `WorkspaceNotification.SourceId` 속성만 문자열 직렬화하고 내부 `long`/DB/URL·기존 숫자/문자열 소스 수신은 유지했다. 잘못된 0/음수 대상은 내부 쓰기로 전달하지 않는다. 기존 CSRF·현재 계정/서비스 접근 권한·원본 알림 소유권 경계는 그대로다.
- `CompanyNotificationContract`가 알림 응답 필드·소스·중복 ID·건수와 읽음 키를 검증한다. 안전한 구형 숫자만 문자열로 정규화하며 안전 범위 밖의 숫자는 추측 복구하지 않는다. 읽음 URL과 최신 연차 알림 비교에서 Number/Math.max 변환을 제거했다. 다른 소스의 같은 ID는 별개이고 인접한 큰 연차 ID도 정확히 비교한다. 공통 패키지에 모듈을 포함하고 모든 소비 앱의 자산 버전 참조를 생성했다.
- `packages/contracts/notifications.md`에 타입·범위·호환·인가 경계와 한계를 명시했다. 이 단계는 알림 전체 수명주기/오류 UI나 프로필 설정 폼 공통화의 완료가 아니며 해당 업무 UI는 계속 이관 대상이다.
- 루트 계약/DOM/생성기/CI 정책 165개와 전체 .NET 통합 83개가 통과했다. 신규 Portal API 테스트는 실제 격리 DB/SSO 세션과 내부 HTTP 대역으로 `9007199254740993`/`9223372036854775807`의 공개 JSON·Razor·내부 읽음 URI, CSRF 및 공용 계정 인가를 확인했다. 실제 연차/일정 알림이나 운영 HMAC/외부 시스템에 쓰지는 않았다. 일정 TypeScript/Vite 및 시트 클라이언트/서버 빌드·typecheck도 통과했다.
- Chrome 여섯 서비스 기존 화면 회귀 426개가 통과했다(`artifacts/browser-notification-contract`). 같은 실행의 신규 알림 화면 4개 중 3개는 본문 읽음 후 native 재로딩 중 스크린샷/컨텍스트 종료가 겹쳐 timeout이었다. 실제 요청 ID 검증은 통과했으며 테스트가 교체된 문서의 DOM/load까지 기다리도록 수정한 뒤 신규 4개 모두 다시 통과했다(`artifacts/browser-notification-ids-verified`). 최초 실패를 통과 집계에 포함하지 않았다. 모바일 다크와 PC 라이트 알림 화면을 직접 확인했다.
- 원본 여섯 Git ancestry·정확한 import tree·archive ref 21개, 생성 바이트와 공통 테마 검사 및 diff 공백 검사도 통과했다. 원격 게시/보호·운영 checkout·DB·Docker는 변경하지 않았다. 다른 앱의 전 업무 쓰기 E2E, 원격 CI/이미지 출처·개별 배포/롤백·운영 이관은 별도 미완료이며 전체 목표는 진행 중이다.
- 수정한 신규 알림 화면 4개를 세 번 반복하여 12개 모두 실패/재시도 없이 통과했다(`artifacts/browser-notification-ids-repeated`). 재로딩 완료 대기 수정의 안정성을 추가 확인했으며 운영 데이터는 사용하지 않았다.

## 39차: 통합 알림 공통 요청·상태와 오래된 계정 문서 보호 (2026-09-10)

- `CompanyNotificationSession`을 공통 자산에 포함하고 셸의 조회 및 셸/Portal 본문의 읽음을 연결했다. 요청 당시 회사 ID·역할·관리자 여부·허용 서비스를 캡처하며 계정 범위 변경·해제·15초 관찰 제한 뒤 늦은 결과는 반영하지 않는다. 이전 요청의 finally가 새 요청을 풀지 않으며 동시에 여러 읽음 요청을 보내지 않는다. 서버 취소·롤백이나 영구 멱등성을 새로 보장하지 않는다.
- 새 조회/개별/전체 읽음 URL에 `expectedUserId`를 붙이고 Portal에서 현재 인증 계정과 정확히 대조한다. 빈 값·중복·불일치는 내부 호출 전에 409로 거부한다. 값 없는 기존 URL은 배포 호환을 위해 유지하므로 추가 대조는 새 클라이언트 경로의 보호다. CSRF·서비스 권한·HMAC·원본 알림 DB/소유자 검증은 유지한다.
- 읽음 완료는 정확한 204로 확인하고 후속 GET 실패와 분리한다. 미확정 쓰기는 자동 재전송하지 않고 쓰기를 잠근 채 GET 재확인을 제공한다. 공통 `CompanyState`로 조회·빈 목록·부분 장애·결과를 표시한다. 일시적 조회/형식 오류에는 이전 검증된 목록을 비활성으로 유지하고, 계정/권한 무효화는 이전 목록·배지·최신 연차 ID 및 OS 알림을 제거한다. Portal 본문의 서버 계정 범위가 무효화되면 새 문서를 열기 전 전체 읽음을 허용하지 않는다.
- 모바일 알림 카드의 종류/날짜 줄바꿈과 두 작업 버튼 배치를 정리했다. 알림 카드/요약/소스 배지를 공통 의미 토큰으로 바꾸고 다크 호환 덮어쓰기에서 전환된 알림 선택자를 제거하여 미읽음 강조선이 유지되게 했다. 모바일 다크와 PC 라이트 본문 및 실패 안내 팝업 이미지를 직접 확인했다.
- 루트 계약/DOM/생성기/CI 정책 176개, 전체 .NET 통합 84개가 통과했다. 신규 서버 검사는 실제 Portal 인증/SQLite와 격리 내부 HTTP로 잘못된 화면 계정의 읽기/쓰기가 원본 서비스에 전달되지 않는 것을 확인한다. 일정 TypeScript/Vite와 시트 클라이언트/서버 빌드·typecheck도 통과했다.
- Chrome 여섯 서비스 기존 화면 및 신규 알림 회귀 442개가 실패/재시도 없이 통과했다(`artifacts/browser-notification-session-final`). 추가 시간 초과 검사까지 포함한 집중 알림 13개도 통과했다(`artifacts/browser-notification-session-extended`). 320/1440px·light/dark, CSRF/정확한 대상, 전체 잠금, 200/401/403/409/503, 확인된 쓰기 뒤 조회 실패·GET 재확인, 계정 전환/해제/timeout, 반복 빈 목록/부분 장애/손상 응답을 검사했다. 모든 HTTP는 격리했으며 운영 알림을 읽음 처리하지 않았다.
- 최초 집중 브라우저 검사 4개는 테스트의 CSRF 헤더 이름 오기로 실패하여 실제 `X-Workspace-CSRF`로 바로잡았다. 추가 OS 알림 DOM 검사에서는 테스트 mount의 서비스 속성 누락을 발견해 실제 `data-company-service` 규약으로 수정하고 여섯 서비스 테스트를 다시 통과했다. 실패 실행은 최종 통과 집계에 넣지 않았다.
- 공통 생성 바이트·테마 205개 UI 소스 및 원본 여섯 ancestry/정확한 import tree/archive ref 21개, diff 공백 검사를 확인했다. 원격 게시/보호·운영 checkout·DB/설정·Docker는 변경하지 않았다. 최초 서버 렌더링 fallback, 프로필 설정과 다른 업무 UI, 원격 필수 검사 보호·이미지 출처·서비스별 배포/롤백 및 운영 이관은 별도 미완료이며 전체 목표는 진행 중이다.

## 40차: 프로필 사진 설정의 공통 폼·저장 버전 연결 (2026-09-10)

- 개별 파일 선택/저장/삭제 코드를 공통 `CompanyProfile`에 옮기고 실제 multipart Razor 폼을 `CompanyForm`에 연결했다. `CompanyState`가 사진 준비·실패·저장 결과를 표시하며, 기본 사진 변경은 `CompanyDialog`에서 확인한다. 전송 중 업로드·저장·삭제를 함께 잠그고 Bitmap/PNG 변환의 관찰 제한, 계정/권한 변경·해제 뒤 늦은 Bitmap/응답을 배제한다. 파일 초안은 현재 문서에만 보존한다.
- `/settings/profile` POST는 실제 antiforgery·중앙 인가와 현재 회사 ID를 대조한다. `ExpectedVersion`으로 새 사진 저장/삭제의 기존 DB 버전을 대조하고 SQL 조건이 맞지 않으면 409를 반환한다. 사진 크기/구조/CRC 검증과 DB 쓰기를 `AvatarStore`로 공유하여 기존 raw 사진 API의 형식·URL·DB를 유지했다. 버전 없는 raw API는 호환용 마지막 쓰기 우선 동작으로 남으며 별도 소비자 이관 없이 폐기하지 않았다.
- 전체 `workspace-form-v1` 결과의 작업·문자열 계정 ID·버전·사진 URL을 검증한 뒤에만 초안을 비우고 기존 쿠키/storage 프로필 갱신 신호를 보낸다. 확인된 저장과 이후 context 조회 실패를 구분하며, 실패/충돌/미확정 결과의 재확인은 GET만 수행한다. 이름·이메일·부서·역할은 이 폼에서 바꾸지 않는다. JavaScript 미지원 설정 UI는 안내를 표시하며 native HTTP POST의 CSRF·검증·리디렉션 호환은 유지한다.
- 공통 자산 생성 시 primitive API를 먼저 정의하고 마지막에 셸을 시작하도록 순서를 정리했다. 사진 저장 버튼은 공통 의미 토큰을 사용하고 긴 파일명도 모바일 폭 안에 표시한다. 루트 지침·프로필 계약·개발/앱 문서를 갱신했으며, 공통 폼/확인창/응답/계정/버전/해제 연결을 우회하는 대표 변이를 구조 검사에서 거부한다. 이 정적 검사는 동작·인가 증명을 대신하지 않는다.
- 루트 계약/DOM/생성기/CI 정책 177개와 전체 .NET 통합 87개가 통과했다. 신규 서버 검사는 실제 인증/Razor/SQLite로 사진 저장·이미지 GET·삭제·다른 계정/오래된 버전·중복/잘못된 입력·CSRF·DB 오류·native POST를 확인하고 실제 프로필 HTML/context/저장 응답 fixture를 생성한다. 기존 raw API 및 다른 사용자/서비스의 사진 디렉터리 테스트도 그대로 통과했다. 일정 TypeScript/Vite와 시트 클라이언트/서버 빌드·typecheck를 확인했다.
- Chrome 전체 605개가 실패/재시도 없이 통과했다(`artifacts/browser-profile-all`). 프로필 전용 17개는 320/1440px light/dark, Canvas 256×256 PNG·native multipart 토큰/버전, 키보드·취소/포커스, 전체 잠금, 손상/미확정/권한/충돌 응답, 읽기 전용 복구, 늦은 Bitmap·응답/계정/해제/timeout 및 변환 실패를 검사한다. 저장한 PNG를 실제 헤더 이미지 요청에 돌려주고 256px 이미지 로드도 확인하도록 보강한 뒤 17개를 다시 통과했다(`artifacts/browser-profile-final`). 모바일 다크 미리보기/상태와 PC 라이트 삭제 확인창을 직접 확인했다. 모든 네트워크/사진은 격리 합성 데이터이며 운영 프로필을 변경하지 않았다.
- 작성 중 발견한 신규 C# 테스트의 변수 선언 오류와 검사기의 공통 `CompanyDialog.confirm` 오탐을 수정했다. 실패 실행은 최종 통과 집계에 포함하지 않았다. 최종 생성 바이트·테마 206개 UI 소스·원본 여섯 ancestry/정확한 import tree/archive ref 21개와 diff 공백 검사를 확인했다.
- 원격 게시/보호·운영 checkout·DB 스키마/설정·Docker는 변경하지 않았다. 다른 남은 업무 UI, raw API 소비자 정리, 원격 필수 검사 보호·이미지 출처·서비스별 배포/롤백 및 운영 이관은 별도 미완료이며 전체 목표는 진행 중이다.

## 41차: 부서·프로젝트 등록/수정의 공통 폼 연결 (2026-09-10)

- 실제 조직 POST를 공통 `CompanyForm`/`CompanyState`/`CompanyDialog`에 연결했다. 확인 전후 입력, 전송 중 변경된 초안, 계정 범위 변경과 해제 후 응답을 검증한다. 전체 커밋 응답이 제출한 계정·관리 항목·기존 ID/버전 및 유효한 새 ID/버전과 맞을 때만 저장한 수정 페이지를 GET한다. 현재 문서의 중복 쓰기·미확정 결과 자동 재전송을 막으며 검색 입력만 바꾼 경우에는 이탈 경고를 만들지 않는다.
- 서버는 화면 회사 ID를 현재 계정과 대조하고 기존 인가/마스터 보호·트랜잭션·버전 concurrency token·멤버십·책임자·Leave outbox를 유지한다. 입력 예외와 버전 충돌을 구분하고 내부 DB 예외는 로그에만 남긴다. 프로젝트 색상의 끝 개행을 거부하고, 없거나 형식이 잘못된 수정 대상은 신규 등록 양식으로 잘못 저장되지 않도록 잠근다.
- HTML 실패는 원래 버전/ModelState와 허용된 업무 필드 원문을 보관한다. 현재 선택기에 없는 직원 ID도 원문에 남기고 재제출을 잠근다. Razor HTML 인코딩과 업무 필드 allowlist를 사용하며 인증 토큰·임의 POST 값은 보관하지 않는다. 초안은 문서를 닫으면 사라지고 새 탭 간 영구 멱등성은 제공하지 않는다.
- 아이콘은 아직 별도 raw 저장 경로이며 조직 정보와 원자적으로 저장된다고 안내하지 않는다. 선택된 파일/진행 중 아이콘 작업이 있으면 조직 제출을 막아 화면 이동으로 초안을 버리지 않게 했다. raw 아이콘의 버전/공통 편집기 전환은 남아 있다. 잠긴 조직 저장 버튼과 HTML 복구 원문은 공통 의미 색을 사용한다.
- 루트 계약/DOM/생성기/CI 정책 178개, 전체 .NET 통합 90개와 추가 마지막 조직 집중 3개가 통과했다. 새 서버 검사는 실제 인증/Razor/SQLite로 생성·기존 수정·native redirect·CSRF·계정/버전 불일치·잘못된 선택·DB 실패·HTML 원문과 스크립트 이스케이프를 검사한다. 새 조직 폼과 기존 Portal Chrome 회귀 144개가 실패/재시도 없이 통과했다(`artifacts/browser-organization-final`). 마지막 경계/비활성 표시 보강 뒤 조직 집중 22개도 통과했다(`artifacts/browser-organization-visual`). 모든 HTTP/계정/조직은 격리 데이터다.
- PC 라이트/모바일 다크 확인창과 모바일 다크 HTML 복구/잠긴 버튼을 직접 확인했다. 최초 서버 검사에서 테스트용 trigger의 테이블명 오기를 `Projects`로 수정했고, 기존 DOM 검사를 실제 공통 컴포넌트 로딩과 '제출/확인만으로 초안을 지우지 않음'에 맞춰 보강했다. 잘못된 GET 대상 검사 추가 중 전체 ModelState를 검사해 기본 tab 없는 URL이 거부된 회귀는 대상 id query 자체 검사로 수정했다. 실패 실행은 최종 통과 수에 포함하지 않는다.
- `packages/contracts/organization.md`, 구조·개발·앱 문서와 지침을 갱신했다. 대표 공통 폼/확인/계정/응답 우회는 구조 변이 검사에서 거부한다. 이 검사는 완전한 코드 파서나 서버 인가의 증명이 아니다. 생성 바이트·테마 206개 UI 소스·원본 여섯 ancestry/정확한 import tree/archive ref 21개와 diff 공백 검사를 확인했다. 이번에는 공통 자산 구현을 변경하지 않았으며 다른 다섯 앱의 브라우저 전체 검사를 새로 수행했다고 주장하지 않는다.
- 원격 게시/보호·운영 checkout·DB 스키마/설정·Docker는 변경하지 않았다. 남은 업무 UI와 raw 아이콘 편집기, 원격 필수 검사 보호·이미지 출처·서비스별 배포/롤백 및 운영 이관은 별도 미완료이며 전체 목표는 진행 중이다.

## 42차: 프로필·프로젝트 아이콘 공통 이미지 편집기 (2026-09-10)

- 프로필의 사진 준비/저장 수명주기를 `CompanyImageEditor`로 추출하고 `CompanyProfile`/`CompanyProjectIcon`이 각각 계정 사진과 프로젝트 대상/권한/응답만 연결하도록 했다. 기존 `company-entities.js`의 raw 업로드·Canvas·개별 확인 구현을 제거했다. 같은 `CompanyForm`/`CompanyState`/`CompanyDialog`를 재사용하며 늦은 Bitmap/응답·범위 변경·해제/timeout 보호를 유지한다.
- 실제 조직 화면에 별도 native multipart 아이콘 폼을 연결했다. 서버는 현재 회사 ID·관리자 권한·프로젝트 ID·기존 이미지 버전을 확인하고 저장/삭제한다. `WorkspaceImageStore`는 프로필/프로젝트 테이블을 닫힌 enum으로 구분하고 모든 값은 SQL 매개변수를 사용한다. 기존 PNG 구조/CRC 검증·이미지 GET 인가·DB 스키마 및 버전 없는 raw API 호환은 유지했다. 페이지 요청 1MiB·PNG 512KiB 제한은 문서화했으며 같은 페이지의 조직 요청에도 1MiB가 적용된다.
- 전체 확인 응답의 작업·계정·프로젝트·이전 버전·반환 경로/버전이 맞을 때만 파일 초안을 지우고 기존 쿠키/storage 갱신 신호를 발행한다. 충돌·권한·미확정 결과는 자동 재전송하지 않고 GET 재확인을 제공한다. 확인된 저장 이후 context 조회 실패는 저장 실패와 구분한다. 아이콘 저장은 조직 이름/멤버십/버전 초안을 유지하고, 조직 전송 중 아이콘 쓰기를 잠근다. 두 폼은 별도 트랜잭션이며 HTML 오류가 미전송 파일/조직 초안을 복원한다고 주장하지 않는다.
- 루트 계약/DOM/생성기/CI 정책 179개와 전체 .NET 통합 93개가 통과했다(`artifacts/server-project-icon-final/project-icon-final.trx`). 새 서버 검사는 실제 격리 인증/Razor/SQLite에서 생성·교체·삭제·버전/대상/CSRF·입력·DB 오류·native 오류/리디렉션과 비공개 읽기를 확인하고 프로필/조직 데이터가 바뀌지 않는지도 검사한다. 일정/시트 빌드 및 fixture 준비 71개가 통과했고, 시트 client/server typecheck도 확인했다.
- Chrome 전체 643개가 통과했다(`artifacts/browser-project-icon-all`, retries 0, failedTests 없음). 그중 프로젝트 아이콘 전용 16개는 320/1440px light/dark·Canvas 256px PNG·실제 multipart 값·저장된 이미지 로드·조직 초안 보존·확인 취소/포커스·권한/미확정/잘못된 대상·읽기 전용 복구·계정/프로젝트 범위·늦은 응답/해제/timeout·조직 전송 잠금을 검사한다. 프로필/조직과 묶은 집중 55개도 통과했다(`artifacts/browser-project-icon-initial`). 모바일 다크 미리보기와 PC 라이트 삭제 확인창을 직접 확인했다. 모든 HTTP/이미지는 격리 합성 데이터다. 쿠키 발행과 같은 문서의 이미지 갱신 검사를 실제 운영 다중 서브도메인 동시 갱신 증거로 확대하지 않는다.
- 작성 과정에서 raw SQL의 분석 경고를 매개변수 FormattableString 경로로 수정했다. 병렬 조직 fixture가 같은 context 파일을 덮어쓰는 문제를 부서/프로젝트별 파일로 분리했다. native 아이콘 실패의 별도 ModelState를 정리하고 대상이 없는 경우에도 오류가 보이도록 보강했다. 최종 전체 서버 검사에는 이 수정이 포함된다.
- 지침·이미지/조직 계약·개발/앱 문서와 여섯 앱의 생성 자산 버전 참조를 갱신했다. 대표 이미지 엔진/대상/버전 우회는 변이 검사로 검출하며 정적 검사를 완전한 인가 증명으로 간주하지 않는다. 생성 바이트·테마 208개 UI 소스·원본 여섯 ancestry/정확한 import tree/archive ref 21개 및 diff 공백 검사를 확인했다.
- 원격 게시/보호·운영 checkout·DB 스키마/설정·Docker는 변경하지 않았다. 기존 raw API 소비자 종료, 남은 업무 UI 전환, 원격 필수 검사 보호·이미지 출처·서비스별 배포/롤백 및 운영 이관은 별도 미완료이며 전체 목표는 계속 진행 중이다.

## 43차: 연차 승인·취소 승인·강제 삭제 공통 처리 (2026-09-10)

- 연차 승인 화면은 아직 일반 POST와 개별 실행 confirm을 사용했고 3초 자동 폴링이 처리 폼을 교체할 수 있었다. 승인/반려·취소 승인/반려·강제 삭제를 동일 `_ApprovalAction`과 `CompanyForm`/`CompanyDialog`/`CompanyState`에 연결했다. 확인 전후 대상/입력과 전체 응답을 대조하고 한 번에 하나만 처리한다. 공통 레이아웃/인가/페이지 등록과 원래 handler URL은 유지했다.
- 화면의 로컬 직원 ID와 신청 스냅샷을 handler에서 현재 값과 대조한다. ID·응답·감사 큐 version은 문자열로 취급하며 안전한 구형 숫자 version만 호환 수신한다. 기존 자기 신청 처리 금지·강제 삭제 역할/사유·연차 계산/가불/배정·감사/알림과 DB 스키마는 변경하지 않았다. 스냅샷은 읽기 시점 검증이며 원자적 DB 경쟁 제어나 요청 멱등성을 새로 제공하지 않는다. 기존 서비스의 업무 저장 뒤 감사/알림 오류는 이미 일부 반영되었을 수 있어 내부 내용을 노출하지 않는 미확정 응답으로 안내한다.
- 확인/쓰기/사유 입력 중 자동 DOM 교체를 막고 다른 신청의 삭제 사유를 저장 후에도 보존한다. 처리 확인된 신청만 반복 동작을 잠그며, 목록 이동/명시적 갱신으로 사유를 버릴 때 공통 확인을 사용한다. 배경 summary가 사용자의 승인 클릭을 삼키지 않도록 중단하고 오래된 조회를 배제한다. 최근 목록 쿼리는 성공한 조회 URL에 유지한다. 처리 완료와 후속 조회 실패를 구분하고 GET 복구가 POST를 재전송하지 않게 했다. 조회 거부/계정 변경은 이전 화면을 숨기고 해제 시 폼/확인창/타이머/조회 리스너를 정리한다.
- 버튼 간격과 승인/반려/위험/비활성 상태 및 건수 배지를 공통 의미 색으로 정리했다. 실제 화면 확인에서 발견한 모바일 표시 개수 줄바꿈과 PC 표 머리글/날짜 분할을 보완하고 넓은 표는 `.cw-table-scroll` 안에서만 스크롤하게 했다. 모바일 다크 저장 결과/비활성 버튼과 PC 라이트 확인창을 직접 확인했다.
- 루트 계약/DOM/생성기/CI 검사 180개, 전체 .NET 통합 99개가 통과했다(`artifacts/server-leave-approvals/leave-approvals.trx`). 마지막 표 구조 변경 후 실제 Leave fixture/서버 24개와 HTML 오류/부분 반영 검사를 보강한 승인 집중 6개도 통과했다. 신규 서버 검사는 실제 격리 Portal SSO/Leave/Razor/SQLite로 다섯 동작·문자열 ID/응답·CSRF·계정/상태/자기 신청/일반 직원·native 호환과 HTML 사유 인코딩을 확인한다. 신청은 변경됐으나 감사 쓰기가 실패한 사례도 500 미확정으로 검증한다. 최초 작성 중 감사 모델 속성 오기를 `TargetId`로 수정했고 실패 실행은 통과 수에 포함하지 않았다.
- Chrome 승인 집중 21개와 연차 전체 회귀 161개를 통과한 뒤, 표 레이아웃 및 자동 갱신의 정확한 큰 version/폼 재연결·진행 중 summary와 확인창 경쟁을 추가 검증했다. 최종 승인/기존 연차 셸/알림/Discord 163개가 실패·재시도 없이 통과했다(`artifacts/browser-leave-approvals-verified`); 승인 전용은 24개다. 320/1440px light/dark·문서 넘침·비활성 의미 색·확인 취소/키보드/포커스·중복 방지·사유 보존·GET 복구·401/403/409/422/500 및 손상 응답·범위/해제/timeout을 포함한다. 테스트는 합성 직원/신청과 격리 HTTP이며 운영 승인/삭제/Discord를 실행하지 않았다.
- 루트 지침·승인 계약·구조/개발/Leave 문서를 갱신하고 공통 처리/스냅샷/전체 응답 우회 변이 검사를 추가했다. 생성 바이트·테마 211개 UI 소스·원본 여섯 ancestry/정확한 import tree/archive ref 21개와 diff 공백 검사를 확인했다. 공통 런타임 자산 자체는 이번 단계에서 변경하지 않았으며 다른 다섯 앱의 전체 브라우저 검사를 새로 했다고 주장하지 않는다.
- 원격 게시/보호·운영 checkout·DB/설정·Docker는 변경하지 않았다. 연차 신청/달력/보정/정산 등 남은 업무 UI, 원격 필수 검사 보호·이미지 출처·개별 배포/롤백 및 운영 이관은 별도 미완료이며 전체 목표는 진행 중이다.

## 44차: 직원 연차 신청 공통 확인·저장·결과 처리 (2026-09-10)

- 기존 Apply는 일반 native POST와 모든 예외를 입력 오류로 표시하는 흐름이었다. 공통 `CompanyForm`/`CompanyDialog`/`CompanyState`를 연결하고 현재 로컬 직원·확인 당시 입력과 전체 저장 응답(문자열 ID·Pending 상태·정규화 필드·근무일/차감 일수·로컬 내역 URL/필터)을 확인한 뒤 결과를 반영한다. 기존 native POST/CSRF/SSO/공개 URL과 휴가 정책·DB 스키마는 유지했다.
- 날짜/유형 바인딩 오류·중복 필드·업무 기록 입력은 쓰기 전 거부한다. `LeaveRequestValidationException`은 CreateAsync의 확실한 사전 검증에만 사용한다. 신청 commit 뒤 감사/알림에서 실패할 수 있는 나머지 예외는 내부 내용을 노출하지 않는 unknown으로 안내한다. 미확정/충돌/권한 변경 뒤 반복 신청을 잠그고 내역 조회를 요구한다. 이것은 원자적 경쟁 제어나 영구 멱등성·알림 트랜잭션 도입이 아니다.
- 확인 취소/패널 재열기에서 초안을 보존하고 확인/전송 중 달력 날짜 변경을 막았다. 다른 POST 편집 초안이 있으면 성공 후 자동 이동하지 않으며 GET 필터 기본값은 업무 초안으로 오인하지 않는다. HTML 실패에서는 허용된 신청 필드만 인코딩해 보관한다. 입력 거부는 수정 가능하고 미확정은 잠긴다. 계정 변경·timeout·해제 뒤 늦은 결과는 적용하지 않는다.
- 신청 폼의 PC 3열/모바일 단일 열, 넓은 텍스트 입력과 비활성/내역 링크/원문 보관 색에 공통 의미 토큰을 적용했다. 실제 320px 다크와 1440px 라이트 확인창을 직접 확인했다. 나머지 연차 페이지의 고유 폼/달력 스타일 전체를 전환한 것은 아니다.
- 신규 실제 서버 검사 9개 및 전체 .NET 통합 108개가 통과했다(`artifacts/server-leave-application/leave-application.trx`). 격리 Portal SSO/Leave/SQLite에서 네 유형·주말/공휴일·중복 신청·현재 직원/CSRF/대신보기·native 호환·HTML 원문을 검사한다. 감사 insert trigger 실패 후 실제 Pending 신청이 남는 경우도 확인했다. 최초 네 테스트의 URL 기대값을 실제 Razor `/Leave/Index` 경로로 바로잡았으며 실패 실행은 통과로 세지 않았다.
- Chrome 신청/기존 승인/알림/Discord/Leave 셸 182개가 실패·재시도 없이 통과했다(`artifacts/browser-leave-application-verified`). 실패 상태가 단순 로딩 중이 아니라 실제 오류로 정착했는지 단언을 강화한 최종 신청 19개도 통과했다(`artifacts/browser-leave-application-final`). 최초 집중 실행의 해제 후 버튼 잠금 복원 문제는 공통 dispose 뒤 소비자 잠금을 재적용해 수정했다. 실제 운영 신청·알림·Discord는 수행하지 않았다.
- 루트 검사 181개가 통과했다. 새 서버 계약 소스를 생성기 격리 fixture에 포함하여 누락으로 실패하던 생성기 회귀를 수정했다. 지침·계약·구조/개발/Leave 문서와 우회 변이 검사를 갱신했다. 생성 바이트·테마 213개 UI 소스·기존 여섯 ancestry/정확한 import tree/archive ref 21개와 diff 공백 검사를 확인했다. 공통 런타임을 변경하지 않아 다른 다섯 서비스 브라우저 전체를 새로 실행했다고 주장하지 않는다.
- 취소 요청/철회·달력 강제 작업/외부 일정·보정/정산 등 업무 UI 전환은 남아 있다. 원격 게시/보호·이미지 출처·독립 배포/롤백·운영 이관 역시 미완료다. 원본 여섯 저장소, 운영 checkout·DB/설정·Docker는 변경하지 않았으며 전체 목표는 계속 진행 중이다.

## 45차: 직원 취소·철회 목록/달력 공통 처리 (2026-09-10)

- 목록의 일반 POST/개별 confirm과 달력의 숨김 폼 `submit()`을 동일 `_SelfActionForm`과 `CompanyForm`/`CompanyDialog`/`CompanyState`에 연결했다. 사용 기간·사유·신청 번호를 함께 확인하고 승인 전 즉시 취소/승인 후 취소 승인 대기/철회 후 승인 상태를 구분한다. 확인 당시 입력과 전체 저장 응답을 검증하기 전에는 완료나 문서 이동을 적용하지 않는다.
- 관리자 승인 해시 정의를 그대로 `LeaveRequestSnapshot.Compute`로 추출했다. 서버 현재 로컬 직원·신청 소유권·전체 신청 날짜/상태 기준값을 대조한다. 월 경계를 넘는 신청도 달력/목록/관리자 기준값이 동일하다. 신규 enhanced 요청은 기준값이 필수이고 값 없는 기존 native POST는 호환한다. 소유권/CSRF/중앙 세션·지난 승인 연차 취소 금지·가불/배정/DB/감사/알림 정책은 유지한다. 달력에서만 지난 날짜의 Pending 취소/CancelRequested 철회를 숨기던 불일치는 기존 목록/서비스 정책에 맞췄다.
- 신청/취소 동시 쓰기를 막고 확인/전송 중 목록·달력을 inert 처리하며 배경 읽기의 DOM 교체를 보류한다. 동적 목록 폼을 연결/해제하며 처리 중 폼 제거·계정 변경·해제·timeout 뒤 늦은 결과를 적용하지 않는다. 다른 신청/관리 초안이 있으면 성공 후에도 보존하고 새 탭 조회 링크를 제공한다. 미확정/충돌/거부는 자동 재실행하지 않으며 감사/알림 실패가 업무 DB rollback을 보장하지 않는다고 안내한다. 읽기 스냅샷은 원자적 CAS/영구 멱등성이 아니다.
- 최초 브라우저 검사에서 공통 확인창 Escape가 뒤의 달력 상세창도 닫는 충돌을 발견했다. 이미 처리된 키 또는 열린 native dialog가 있으면 기존 달력 키 핸들러를 보류하도록 수정했다. 확인 취소 시 원래 버튼으로 돌아가며 저장 관찰 중 beforeunload와 확인된 성공 이동을 구분한다. 처리 버튼 비활성/상태/조회 링크는 공통 의미 토큰을 사용한다. 최종 320px 다크와 1440px 라이트의 사용 기간·사유 포함 확인창을 직접 확인했다.
- 신규 실제 서버 검사 6개 및 최종 전체 .NET 통합 114개가 통과했다(`artifacts/server-leave-self-actions/leave-self-actions-final.trx`). 실제 격리 SSO/Razor/SQLite로 세 전환·소유권/기준값/CSRF/대신보기/지난 날짜·native 호환과 상태 저장 후 감사 실패를 검증한다. 화면 문구/기간 보완 후 Leave fixture/서버 39개도 통과했다. 테스트는 합성 직원/신청만 사용했다.
- 최종 Chrome 취소/철회·신청·승인·알림·Discord·Leave 셸 209개가 실패·재시도 없이 통과했다(`artifacts/browser-leave-self-actions-release`); 취소/철회 집중은 27개다. 목록/달력 세 동작, 기간/사유 표시, 320/1440px light/dark, 초안/포커스/문서 넘침, 정확한 응답/경로, 403/409/422/500, 동적 교체·확인 중 기준값 변경·경쟁 신청/취소·폼 제거·범위/해제/timeout을 포함한다. 이전 실행의 Escape 실패 3개는 통과 집계에 포함하지 않았다.
- 루트 계약/DOM/생성기/CI 검사 182개, 생성 바이트/테마 215개 UI 소스, 원본 여섯 ancestry/정확한 import tree/archive ref 21개 및 diff 공백 검사를 확인했다. 생성기 fixture에 공유 서버 해시 소스를 포함하고 지침/계약/구조/개발/Leave 문서를 갱신했다. 공통 런타임 자산 자체는 변경하지 않았으며 다른 다섯 앱의 전체 브라우저 검사를 새로 실행했다고 주장하지 않는다.
- 달력 관리자 강제 작업·외부 일정 편집, 보정/정산 등 남은 업무 UI와 원격 보호·이미지 출처·개별 배포/롤백·운영 이관은 미완료다. 원본 여섯 저장소와 운영 checkout·DB/환경·Docker는 변경하지 않았다. 전체 목표는 진행 중이다.

## 46차: 외부 일정 변경의 공통 폼용 서버 계약 (2026-09-10)

- 외부 일정 저장/삭제 handler가 모든 예외를 일반 입력 오류로 노출하고 잘못된 nullable 수정 ID를 신규 등록으로 해석할 수 있는 경로를 확인했다. 두 handler를 공통 서버 처리로 모으고 native URL/redirect와 기존 관리자·직원 대상 정책을 유지하면서 enhanced `workspace-form-v1` 응답을 추가했다.
- enhanced 요청은 현재 관리자·정확한 일정 ID·읽기 시점 fingerprint를 대조한다. 생성/수정/삭제 모드, 문자열 관리자/대상/일정 ID, 전체 정규화 입력, 이전/이후 fingerprint와 기존 달력 이동 필터를 확인 응답으로 반환한다. SQLite DateTime.Kind 왕복 차이는 ticks로 정규화한다. fingerprint는 원자적 DB CAS나 영구 멱등성이 아니며 기존 읽기-쓰기 경쟁 구간은 남는다.
- 잘못된 ID·중복/바인딩 오류·기간/구분/메모 오류는 저장 전에 거부한다. 다른 연차/강제 폼의 ModelState 오류는 이 요청에 섞지 않는다. DB 업무 저장 뒤 감사 기록 실패는 일부 반영 가능한 unknown으로 안내하고 내부 예외는 로그에만 남긴다. native 실패는 허용된 입력만 인코딩해 보관하고 외부 일정 쓰기 UI를 제거하며 새 탭 GET 확인을 제공한다.
- 신규 서버 검사 10개와 전체 .NET 통합 124개가 통과했다(`artifacts/server-leave-external/leave-external-server.trx`). 실제 격리 Portal SSO/Leave/Razor/SQLite에서 CRUD, 큰 ID, 응답 fingerprint 재사용, 10개 버전 필드, 관리자/일반 직원·공용/마스터/비공개/비활성 정책, CSRF, 잘못된 수정/삭제, 사라진 대상·오래된 기준값, DB 저장 실패/감사 실패 후 실제 반영, native 호환과 원문 인코딩을 검증했다.
- 실제 오류 Razor로 Chrome 320/1440px light/dark 복구 검사 4개가 통과했다. 기존 연차 신청·취소·승인·셸·알림·Discord를 포함한 최종 브라우저 213개도 실패/재시도 없이 통과했다(`artifacts/browser-leave-external-server-regression`). 모바일 다크/PC 라이트의 공통 오류 상태·복구 원문·새 탭 링크를 직접 확인했다. 테스트 HTTP와 계정/일정은 격리 합성 데이터다.
- 루트 계약/DOM/생성기/CI 정책 테스트 183개, 생성 바이트·테마 215개 UI 소스/20개 토큰, 원본 여섯 ancestry/import tree/archive ref 21개와 diff 공백 검사를 통과했다. 새 서버 계약·루트 지침·구조/개발/Leave 문서를 갱신하고 대표 계약 제거·raw 인코딩 우회 변이 검사를 추가했다. 이 정적 검사는 완전한 인가/코드 우회 방지 증거가 아니다.
- **외부 일정 클라이언트의 공통 폼/확인/초안 수명주기 전환은 아직 미완료**다. 현재 화면은 기준값 없는 native 호환 경로를 사용한다. 다음 작업은 서버 fingerprint를 실제 편집 폼에 연결하고 추가/수정/삭제·달력 교체·다른 연차 쓰기·계정 변경/timeout/해제를 통합하는 것이다. 관리자 강제 작업과 다른 남은 업무 UI, 원격 보호·이미지 출처·개별 배포/롤백 및 운영 이관도 여전히 남아 있다.
- 원본 여섯 저장소·원격·운영 checkout·DB/환경·Docker는 변경하지 않았다. 공통 런타임 자산 자체는 변경하지 않았고 다른 다섯 앱 전체 브라우저 재검사를 수행한 것으로 확대하지 않는다. 전체 목표는 진행 중이다.

## 47차: 외부 일정 편집의 공통 폼·확인·초안 수명주기 (2026-09-10)

- 실제 달력 칩에 서버 fingerprint를 렌더링하고 기존 저장/삭제 native 폼에 현재 관리자·기준값을 연결했다. `leave-external-schedules.js`가 공통 CompanyForm/CompanyDialog/CompanyState를 사용한다. 개별 외부 일정 삭제 confirm/submit을 제거하고 직원·기간·구분·메모를 확인한 뒤 제출한다. 모드·관리자/일정/대상 ID·이전/이후 기준값·입력·반환 경로/필터 전체를 검증한 뒤에만 결과를 반영한다.
- 날짜 재선택/상세창 닫기로 초안을 지우지 않는다. 다른 일정 편집과 초기화는 공통 폐기 확인을 받고, 다른 일정 삭제는 현재 편집 초안을 보존한다. 확인/쓰기 중 신청·취소/철회·관리자 native 작업이 겹치지 않게 하며, 기존 신청/취소 어댑터는 외부 일정의 실제 초안 기준값을 사용한다. 기본 날짜 설정 자체를 미저장 업무로 혼동하지 않는다.
- 초안/처리 중 달력 GET의 시작·DOM 교체·오류 redirect를 차단한다. 실패한 조회를 이유로 문서 이동해 초안을 버리지 않는다. 다른 POST 초안이 있으면 저장 확인 후에도 문서 이동 대신 새 탭 GET 확인을 제공한다. 현재 문서의 확인된/미확정 외부 일정 반복 쓰기는 잠그고 422 invalid만 교정 후 재시도한다. 이전 계정/해제/timeout·제거된 폼·전송 후 바뀐 입력에 늦은 응답을 적용하지 않는다. 강제로 제거된 DOM의 영구 초안 복구나 서버 롤백을 보장하지는 않는다.
- 삭제의 `name=id`가 HTMLFormElement.id 속성을 가려 생성 폼으로 잘못 판별되는 문제를 실제 브라우저 검사에서 발견해 getAttribute로 수정했다. 최초 테스트의 연차 날짜 선택 모드/비활성 월간 보기 클릭을 실제 사용자 흐름에 맞게 수정했다. 로딩 중 pointer 차단을 우회하는 강제 클릭 대신 늦은 프로그램 입력 변경으로 GET 경쟁 보호를 검증했다. 실패/중단 실행은 통과 집계에 포함하지 않는다.
- 외부 일정 입력/메모·비활성 색을 공통 의미 토큰에 맞췄다. 부서가 없을 때 빈 괄호를 없애고 모바일에서 설명과 초기화 버튼이 좁게 밀리지 않도록 줄을 나눴다. PC 라이트/모바일 다크 편집기·공통 확인창을 직접 확인했다. 기존 날짜 상세 프레임과 관리자 강제 연차 폼 자체의 공통 전환은 별도 미완료다.
- 실제 Razor/서버 fixture 검사를 추가했고 전체 .NET 통합 125개가 통과했다(`artifacts/server-leave-external-ui/leave-external-ui.trx`). 실제 격리 SSO/SQLite의 달력 fingerprint·두 native 폼의 관리자/버전/CSRF 연결을 확인한다. 기존 서버 계약의 CRUD/인가/입력/감사 실패/구형 native 호환 검사를 유지한다.
- Chrome의 외부 일정 집중 29개를 통과한 뒤 전송 중 입력 변경 및 입력 스타일 검사를 보강했다. 외부 일정 30개와 기존 연차 신청/취소/승인/셸/알림/Discord/오류 복구를 포함한 243개가 실패·재시도 없이 통과했다(`artifacts/browser-leave-external-ui-release`). 마지막 모바일 설명 배치 보완 후에도 동일 전체 243개가 통과했다(`artifacts/browser-leave-external-ui-final`, failedTests 없음). 최종 모바일 다크 편집기의 설명/버튼 분리를 직접 확인했다. 모든 HTTP와 계정/일정은 격리 합성 데이터이며 운영 일정/승인을 변경하지 않았다.
- 루트 계약/DOM/생성기/CI 정책 184개, 생성 바이트·테마 216개 UI 소스/20개 토큰, 원본 여섯 ancestry/import tree/archive ref 21개 및 diff 공백 검사를 통과했다. 지침·계약·구조/개발/Leave 문서와 대표 공통 연결/응답/초안 우회 변이 검사를 갱신했다. 정적 검사는 실제 인가/시각 검사와 별도 증거다.
- 원본 여섯 저장소·원격·운영 checkout·DB/환경·Docker는 변경하지 않았다. 공통 런타임 패키지 자체를 변경하지 않아 다른 다섯 앱의 브라우저 전체 재검사를 수행한 것으로 주장하지 않는다. 남은 관리자 강제 연차·보정/정산 등 업무 UI, 원격 필수 보호·이미지 출처·서비스별 배포/롤백·운영 이관은 미완료이며 전체 목표는 계속 진행 중이다.

## 48차: 달력 관리자 강제 연차 서버 계약과 오류 복구 (2026-09-10)

- AdminForceAdd/Delete native handler에 공통 폼 응답 계약을 연결했다. 현재 관리자·정확한 입력·전체 신청 스냅샷을 대조하고 문자열 관리자/대상/신청 ID·상태·사유·날짜/차감 일수·기존 필터 경로를 반환한다. native 성공 redirect와 기준값 없는 구형 문서 호환을 유지한다. 서버 계약과 정상 화면의 공통 클라이언트 전환은 별도다.
- 활성 실제 직원 대상은 화면의 직원 정책과 맞췄다. 공용/회사 마스터/비활성 대상 추가 및 대신보기 쓰기를 서버에서 거부하고 관리자에게 비공개 직원 관리를 계속 허용한다. 기존 과거 날짜/반차/미차감·즉시 승인·삭제 권한·전체 신청 삭제·배정 제거/가불 상환 복구를 유지했다. optional 사유 설정의 정규화도 유지한다.
- 업무 저장 뒤 감사/알림 오류는 롤백이 아니라 결과 미확정으로 안내한다. 사전 검증만 typed invalid로 반환한다. native 실패는 허용된 해당 작업 입력만 인코딩해 보관하고 강제 작업 UI를 숨긴 뒤 새 탭 GET 확인을 제공한다. 인증값/임의 POST/내부 예외는 표시하지 않는다.
- 최초 실제 왕복 검사에서 신규 추적 객체와 SQLite 재조회 사이의 날짜 Kind/소수 표현 차이로 기준값이 달라지는 문제가 발견됐다. tracked Reload만으로 해결되지 않아 AsNoTracking 실제 재조회로 신규 기준값을 만들고 일수 문자열을 정규화했다. 기존 공유 스냅샷 정의는 변경하지 않았다. 삭제 복구 테스트는 자동 발생한 기존 지급 전체 개수를 가정하지 않고 보존할 정확한 지급 건을 대조하도록 수정했다. 앞선 실패 실행은 통과로 집계하지 않는다.
- 새 서버 검사 18개를 포함한 전체 .NET 통합 143개가 통과했다(`artifacts/server-calendar-admin-full/calendar-admin-full.trx`, 실패/건너뜀 0). 실제 격리 SSO/SQLite·CSRF·큰 ID 추가→삭제 기준값 왕복, 날짜/상태/역할/직원·사유/중복 필드/부분 실패·native 원문 및 기존 배정/상환 경계를 검증했다.
- 실제 Razor 오류 복구를 외부 일정과 동일 브라우저 검사로 검증했다. 관리자 추가/삭제의 두 폭·두 테마 8개를 포함한 집중 12개가 통과했고 PC 라이트/모바일 다크 화면을 직접 확인했다. 새 탭도 격리 HTTP에서 GET만 수행하며 원문과 현재 문서를 유지한다.
- 기존 신청·승인·취소·외부 일정·알림·Discord·전체 Leave 셸/권한 검사를 포함한 Chrome 251개가 실패·재시도 없이 통과했다(`artifacts/browser-calendar-admin-full`, failedTests 없음). 루트 계약/생성/DOM/CI 정책 185개, 생성 바이트·테마 216개 UI 소스/20개 토큰, 원본 여섯 ancestry/import tree/archive ref 21개, diff 공백 검사를 통과했다. 지침·계약·구조/개발/Leave 문서와 대표 우회 변이 검사를 함께 갱신했다.
- **정상 달력 강제 추가/삭제의 공통 폼·확인창·초안 수명주기는 아직 미완료**다. 다음 단계는 실제 폼의 관리자/신청 기준값을 연결하고 사유 입력 확인창·다른 연차/외부 일정 편집·날짜 선택/GET 교체·계정 변경/해제를 함께 처리하는 것이다. 남은 업무 UI 및 원격 보호·출처/배포/롤백·운영 이관도 여전히 남는다.
- 원본 여섯 저장소·원격·운영 checkout·DB/환경·Docker는 변경하지 않았다. 공통 런타임 패키지를 변경한 것은 아니며 다른 다섯 앱 전체 브라우저 검사나 운영 반영 완료로 확대하지 않는다. 전체 목표는 진행 중이다.

## 49차: 달력 관리자 강제 작업 공통 확인·초안 보호 (2026-09-10)

- 정상 달력의 강제 추가/전체 신청 삭제를 `leave-calendar-admin.js`와 공통 폼·상태·확인창에 연결했다. native prompt/confirm/submit을 제거하고 추가 날짜를 직접 확인할 수 있게 했다. 삭제 확인창은 전체 사용 기간과 원래 사유·신청 번호를 표시하며 별도 삭제 사유를 입력한다. 사유 필수 여부는 실제 서버 설정을 따른다. 취소/Escape 후 삭제 사유 이어쓰기와 대상 변경/추가 초안 초기화 확인을 제공한다.
- 실제 Razor의 현재 관리자·전체 신청 스냅샷·문자열 ID·전체 날짜와 native CSRF/필터를 사용한다. 전체 응답의 작업·대상·이전/이후 기준값·상태·사유·일수·날짜·정확한 이동 경로를 확인한 뒤에만 성공을 반영한다. 잘못된 응답/권한/충돌/미확정 실패는 재전송을 잠그고 초안과 새 탭 GET 복구를 유지하며 검증 가능한 422는 수정 가능하다.
- 기존 신청·취소·외부 일정과 초안/진행 상태를 연결했다. 날짜 변경/늦은 GET 교체·오류 redirect, 확인/쓰기 중 다른 POST와 문서 이탈을 방어한다. 폼 교체/제거·계정 변경·해제·timeout 뒤 늦은 응답을 배제하고 컨트롤러/확인창을 정리한다. 폼의 이름 있는 id 입력이 속성을 가리지 않도록 식별은 getAttribute로 처리한다.
- 새 실제 Razor 검사 포함 전체 .NET 144개가 통과했다(`artifacts/server-calendar-admin-ui-final/calendar-admin-ui-final.trx`). 마지막 optional 사유 검사를 fixture 출력 환경과 무관하게 실행하도록 옮긴 후 해당 실제 Razor 집중 1개도 통과했다(`artifacts/server-calendar-admin-razor-final/calendar-admin-razor-final.trx`). 격리 SSO/SQLite와 native 필드를 사용하며 운영 데이터는 변경하지 않았다.
- 강제 작업 Chrome 집중 49개가 실패·재시도 없이 통과했다(`artifacts/browser-calendar-admin-ui-final`). 두 폭·두 테마, optional 사유, 전체 날짜/취소·재개/대상 변경, 잘못된 전체 응답, 403/409/422/500/HTML, 늦은 GET/쓰기, 범위/해제/timeout/DOM 제거, 다른 초안·POST 보호를 검증한다. 기존 Leave 8개 명세 251개도 통과했다(`artifacts/browser-calendar-admin-consumers`). 공통 런타임 패키지를 변경한 단계는 아니며 다른 다섯 앱 전체 브라우저 재검사를 주장하지 않는다.
- 직접 화면을 확인해 삭제 창의 과도한 폭과 날짜가 한 줄로 붙는 문제를 공통 `cw-confirm` 프레임으로 수정했다. 최종 모바일 다크 확인창의 전체 날짜·사유 입력·버튼 대비를 확인했고 320/1440px light/dark의 폭/줄바꿈/문서 넘침을 자동 검사했다. 루트 계약/생성/DOM/CI 정책 186개, 생성 바이트·원본 여섯 ancestry/import tree/archive ref 21개와 diff 공백 검사를 통과했다. 대표 우회 변이 검사와 지침·계약·구조/개발/앱 문서를 갱신했다.
- **다른 초안을 보존하는 것과 같은 문서에서 연속 저장할 수 있는 것은 다르다.** 현재 각 편집기의 문서 잠금은 확인된 성공 이후에도 남아 독립된 다른 초안의 저장을 막을 수 있다. 다음 단계는 공통 복수 폼 조정에서 확인된 성공과 미확정 쓰기를 구분하고, 서버 기준값/대상 및 초안을 보호하면서 독립된 작업을 재개하는 것이다. 기존 날짜 상세 프레임·보정/정산 등 업무 UI도 아직 남는다.
- 원본 여섯 저장소·원격·운영 checkout·DB/환경·Docker는 변경하지 않았다. 원격 보호·이미지 출처·서비스별 배포/롤백·운영 이관은 별도 미완료이며 전체 목표는 계속 진행 중이다.

## 50차: 복수 폼의 공통 작업 세션과 독립 초안 순차 저장 (2026-09-10)

- `CompanyForm.createSession()`으로 관련 폼의 확인/쓰기를 한 번에 하나씩 조정한다. 전체 응답이 확인된 성공은 다른 초안의 저장을 풀고 제출 전 대상/기준값을 소모한다. 이전 lease의 늦은 완료는 다음 lease를 해제하지 못한다. 미확정/충돌/권한 실패는 문서를 잠그고 자동 재전송하지 않는다. 서버 인가·업무 처리·CSRF·DB 스키마·URL은 바꾸지 않았다.
- 신청·취소·관리자 추가/삭제·외부 일정은 같은 세션을 공유한다. 신청 입력은 저장 후 읽기 전용으로 유지하되 다른 편집기를 잠그지 않는다. 취소/강제 삭제는 같은 신청/스냅샷을 공유하여 오래된 중복 버튼을 차단한다. 외부 일정 생성 후 정확한 ID·새 fingerprint·정규화 입력을 반영해 후속 수정을 중복 create로 보내지 않는다. 관리자 추가의 변경 없는 입력은 재전송하지 않고 초기화/변경한 새 의도를 구분한다.
- 초기 순차 저장 검사에서 저장된 신청 폼이 달력 날짜 선택 모드를 계속 붙잡는 문제를 발견했다. 저장된 폼이 보이는 상태에서도 달력 상세를 열도록 수정했다. GET 시작 이후 저장이 끝나면 기존 pending 검사만으로 늦은 조회를 막을 수 없어 세션 revision을 추가했다. 달력/내역 GET의 성공과 오류 redirect 모두 시작 시점과 현재 revision을 대조한다.
- 공통 세션 단위 검사 10개와 연결 우회 변이 검사를 포함한 루트 197개, 생성 바이트·테마 217개 UI 소스/20개 토큰, 원본 여섯 ancestry/import tree/archive ref 21개와 diff 공백 검사가 통과했다. 실제 격리 .NET 전체 144개가 통과했고 마지막 GET 보호 이후 실제 Razor 집중 1개 및 최종 fixture 준비 122개가 통과했다. 시트와 일정 빌드도 성공했다.
- 신청/관리자 추가/외부 일정의 여섯 순서·두 테마/폭, 한 편집기의 삭제→추가, 동일 신청의 취소/삭제 공유 기준값, 외부 일정 create→update, 두 번째 쓰기의 미확정/422/scope/이탈, 늦은 두 GET의 200/500을 포함한 집중 Chrome 23개가 통과했다(`artifacts/browser-form-session-revision`). 모바일 다크 저장 결과와 기존 초안이 유지된 화면을 직접 확인했다. 기존 연차 네 어댑터 회귀 125개도 초기 공통 연결 후 통과했다.
- 전체 여섯 서비스 최종 Chrome 회귀 827개가 실패·재시도 없이 통과했다(`artifacts/browser-form-session-final-all`, 12.0분). 최신 생성 자산과 실제 Razor fixture를 사용하며 원래 CS·계정/프로필/조직·알림·일정·시트·통계 및 새 연속 저장 검사를 포함한다. PC 라이트의 저장된 신청/안내와 모바일 다크의 외부 일정 저장 안내를 직접 확인했다. 처음 브라우저 채널 환경 누락으로 발생한 실행 실패, 실제 날짜 선택 모드 회귀, 테스트의 모호한 확인창 선택자를 수정한 이전 실패 실행과 GET 경쟁 보강을 위해 중단한 전체 실행은 최종 통과 수에 포함하지 않는다.
- 계약 `form-session.md`와 관련 도메인 계약·지침·구조/개발/앱 문서를 갱신했다. 공통 모듈 변경으로 모든 앱의 생성 자산 버전 참조를 갱신했다. 문서 내 세션 조정은 다중 탭 영구 멱등성·DB CAS·트랜잭션 통합·서버 롤백을 제공하지 않는다.
- 다음 업무 UI 전환 대상은 실제 소스에서 여전히 native 확인/전송을 사용하는 연차 보정/발생분 관리(`Admin/Adjustments`), 소멸·이월·보상(`Admin/Settlements`), 공휴일 등록/삭제/import(`Admin/Holidays`), 채널 웹훅 등록/삭제/테스트(`Admin/NotificationSettings`)와 기존 날짜 상세 프레임이다. 셸의 44개 등록/legacy adapter 0이라는 검사를 업무 본문 전체 완료로 확대하지 않는다.
- 원본 여섯 저장소·원격·운영 checkout·DB/환경·Docker는 변경하지 않았다. 원격 필수 보호·이미지 출처·서비스별 배포/롤백·운영 이관은 별도 미완료이며 전체 목표는 진행 중이다.

## 51차: 연차 정산의 공통 입력·확인·저장 계약 (2026-09-10)

- `/Admin/Settlements`의 소멸·이월·보상을 공통 폼·확인창·상태·작업 세션에 연결했다. 직원 초성 검색/프로필과 발생분 선택을 분리하고 일수/사유 초안을 유지한다. 최근 내역은 공통 표/가로 스크롤 및 직원·처리자 프로필로 표시한다. 보상은 정산 기록이며 실제 급여 지급이 아님을 명시했다.
- 현재 관리자, 실제 재직 직원·공용/회사 마스터 제외, 유효 발생분과 조회 기준일/발생분/배정·신청 상태/정산 목록 스냅샷을 서버에서 대조한다. 입력 중복·파싱 오류·enum·0.5일/잔여량/사유 오류와 충돌을 구분한다. 이월 발생분 생성과 정산 연결의 기존 트랜잭션, 처리일~1년 기간·감사 기록을 유지했다. DB 스키마·기존 URL·SSO·CSRF는 변경하지 않았다.
- 전체 확인 응답의 작업·문자열 관리자/직원/발생분/정산/생성 ID·이전 기준값·유형/일수/사유·처리일·정확한 내역 경로를 검증한다. 저장 후 입력은 읽기 전용으로 보관하고 최신 GET을 제공한다. 커밋 뒤 감사 오류·손상/HTML/미확정 응답은 자동 재전송하지 않는다. 확실한 422만 수정 가능하다. 계정 변경·DOM 제거·해제·timeout의 늦은 응답과 중복 제출을 배제하고 native 실패는 허용된 업무 입력 원문만 인코딩한다.
- native 필드의 그리드·라벨·컨트롤·전체 열을 공통 `primitives.css`의 명시적 클래스로 추출했다. 아직 전환하지 않은 모든 input에 일괄 적용하지 않는다. `native-fields.md`, `leave-settlements.md`, 지침·구조·개발/앱 문서와 연결 우회 변이 검사를 추가했다. 새 서버 검사 의존 파일이 생성기 격리 복사 목록에서 빠져 루트 검사가 실패한 것을 발견하고 실제 파일을 포함하도록 수정했다. 검사 예외로 우회하지 않았다.
- 격리 SSO/SQLite의 정산 13개 및 전체 .NET 157개가 통과했다(`artifacts/server-settlements-all/settlements-all.trx`). 실제 Razor 준비 135개, 시트/일정 배포 빌드가 성공했다. 마지막 Leave CSS 갱신 후 실제 Razor 집중 1개도 통과해 최신 자산 쿼리 fixture를 갱신했다. 루트 계약/생성/DOM/CI 정책 198개, 공통 생성 바이트·테마 219개 UI 소스/20개 토큰과 원본 여섯 ancestry/import tree/archive ref 21개, diff 공백 검사를 통과했다.
- 공통 필드 생성 후 여섯 서비스 전체 Chrome 857개가 실패·재시도 없이 통과했다(`artifacts/browser-settlements-all`, 12.7분). 추가 실제 색/배치 검사에서 Leave의 기존 `theme-dark input !important`가 공통 필드 배경을 덮는 문제를 발견해 opt-in 공통 필드를 제외했다. 마지막 변경은 Leave CSS에 한정되며 이후 정산 집중 34개가 모두 통과했다(`artifacts/browser-settlements-final`). 이 34개 중 추가 4개는 전송 없이 native min/step, 실제 1열/2열 좌표, 색·테두리·포커스 토큰과 내역 표 가로 넘침을 확인한다. fieldset의 계산된 CSS 문자열이 아닌 실제 좌표를 검사하도록 정정했다. 초기 스타일/검사 실패 실행은 통과 수에 포함하지 않는다.
- PC 라이트 저장 결과와 모바일 다크 확인창을 확인했고, 최종 모바일/PC 다크 입력·포커스·내역 표의 대비와 레이아웃을 직접 확인했다. 선택한 발생분의 조회 시점 잔여량을 저장 후 임의 갱신하지 않는다. 현재 정산 화면은 단일 편집 폼이고 다음 정산은 최신 화면에서 시작한다. 구형 기준값 없는 native POST는 호환 경로이며 DB CAS/영구 멱등성은 새로 보장하지 않는다.
- 다음 실제 업무 UI는 연차 보정/발생분 추가·삭제, 공휴일 관리/import, 채널 웹훅 설정 및 기존 날짜 상세 프레임이다. 원격 필수 보호·이미지 출처·서비스별 배포/롤백·운영 이관도 여전히 남는다. 원본 여섯 저장소·원격·운영 checkout·DB/환경·Docker는 변경하지 않았으며 전체 목표는 진행 중이다.

## 52차: 보정·발생분 관리 서버 계약과 native 복구 (2026-09-10)

- `/Admin/Adjustments`의 보정·추가·삭제는 원래 업무 코어와 저장/감사 경계를 유지하면서 `workspace-form-v1` 응답을 제공한다. 요청자·대상 직원·발생분 기준값을 대조하고 관리자 전용 읽기 Baseline handler를 추가했다. 공용/회사 마스터 제외를 조회와 쓰기에 일관되게 적용하며 퇴사/비공개 직원 과거 보정·음수 일수·동일 기준일 합산·기존 모든 배정/정산 합계의 삭제 제한은 유지했다.
- 해당 작업의 필드만 파싱·중복 검증한다. 잘못된 날짜/enum/반차 단위와 날짜·보정 합계 overflow를 쓰기 전에 거부한다. ID와 decimal 일수는 문자열로 확인 응답에 포함하고 실제 DB 재조회 값·이전/이후 hash·삭제 전 값을 반환한다. 업무 DB 반영 뒤 감사 실패는 unknown이며 예외 원문은 외부로 보내지 않는다.
- `LeaveGrantSnapshot`으로 발생분·배정/신청 상태·정산 hash를 공유했다. 정산은 여기에 조회일·가용량을 포함한다. 기존 열린 enhanced 정산 폼은 이전 hash로 충돌할 수 있어 최신 GET이 필요하지만 DB/업무 계산·URL·SSO/CSRF를 변경하지 않았다. 기준값은 원자적 DB CAS/영구 멱등성이 아니다.
- native 실패는 허용 업무 입력을 Razor 인코딩해 보관하고 변경 폼 대신 최신 내역 새 탭 GET을 제공한다. JS가 없어도 오류 원문을 읽을 수 있다. 원래 정상 native 보정 UI는 아직 공통 폼/확인/세션으로 연결하지 않았으며 이 단계를 화면 전체 전환 완료로 간주하지 않는다. 다음 연결의 같은 발생 슬롯 공유·다른 초안 보존·미확정 잠금·GET 재기준화 금지를 `leave-grants.md`에 명시했다.
- 실제 격리 SSO/SQLite의 새 16개와 정산 13개 집중 테스트가 통과했고, 전체 .NET 173개가 통과했다(`artifacts/server-grants-all/grants-all.trx`). 최종 오류 문구 fallback 변경 후 Razor 복구 1개를 다시 통과해 fixture를 갱신했다(`artifacts/server-grant-recovery-final/grant-recovery-final.trx`). 루트 계약/생성/DOM/CI 정책 199개, 테마 220개 UI 소스/20개 토큰 및 원본 여섯 ancestry/import tree/archive ref 21개 검증을 통과했다.
- 실제 Razor 복구 4개, 정산 34개, Leave 셸/역할별 회귀 99개로 Chrome 137개가 실패·재시도 없이 통과했다(`artifacts/browser-grants`, 1.2분). 모바일 다크와 PC 라이트 복구 화면의 오류·원문·링크·가로 넘침을 직접 확인했다. 정상 보정 화면의 전송/확인·복수 초안 수명주기 검증은 후속 UI 작업으로 남는다. 공통 브라우저 자산은 변경하지 않았다.
- 공통 구조·앱 문서·개발 지침 및 서버 계약 누락 변이 검사를 추가했다. 원본 여섯 저장소·원격·운영 checkout·DB/환경·Docker는 변경하지 않았다. 정상 보정 UI, 공휴일/채널 설정/날짜 상세 프레임, 원격 보호·이미지 출처·독립 배포/롤백·운영 이관은 여전히 미완료이며 전체 목표는 진행 중이다.

## 53차: 보정·발생분 공통 편집 UI와 독립 초안 (2026-09-11)

- 정상 보정/추가/삭제 폼을 `CompanyForm`/`CompanyDialog`/`CompanyState`와 하나의 공통 작업 세션에 연결했다. 기존 handler·native POST/CSRF, 퇴사/비공개 직원의 과거 보정·음수 일수·동일 기준일 합산·삭제 제한·저장/감사 경계를 유지한다. 정상 UI 연결이 남았다는 52차 기록은 이번 단계로 대체한다.
- 같은 직원·발생 유형·발생일·이전 hash를 세 작업이 공유한다. 확인된 저장은 독립 초안을 이어 쓰게 하지만 처리된 이전 기준값을 재사용하거나 자동 GET으로 재결합하지 않는다. 미확정 쓰기는 문서를 잠그고 새 탭 조회를 제공한다. 직원별 표 DOM과 읽기 결과를 보관하여 목록 왕복/순차 저장으로 다른 직원의 삭제 사유·보정/추가 입력을 지우지 않는다. 최초/후속 행은 같은 Razor partial을 사용한다.
- 조회 응답에 실제 요청자/날짜/삭제 및 사유 정책, 직원 이름과 정밀한 배정/정산/잔여량을 포함했다. UI 전송 직전 캡처와 전체 ACK, 64비트 문자열 ID·BigInt 소수 산술·UTC 윤년 만료일을 별도 도메인 계약으로 검증한다. 읽기 실패/15초 관찰 제한은 기존 목록을 보존하고 수동 GET만 재시도한다. 계정/해제/폼 제거·작업 revision 변경 뒤 늦은 응답은 배제한다.
- 일반 필드/표를 공통 클래스로 전환했다. 직접 화면 확인에서 비활성 삭제 버튼이 계속 빨갛게 보이는 문제를 발견해 opt-in `cw-button`을 공통 primitive에 추가했다. 기본/primary/danger·native 및 fieldset-disabled·키보드 포커스를 의미 토큰으로 관리한다. 공통 확인 details는 직원/프로젝트의 정확한 회사 ID와 기존 entity 렌더러를 선택적으로 소비하며 React 타입도 같은 API를 제공한다. Leave의 로컬 ID를 회사 ID로 추정하지 않는다.
- 실제 Razor 준비 152개, 서버 통합 174개 및 루트 계약/DOM/생성기/CI 정책 206개가 통과했다. 새 `checkLeaveGrantClient`와 변이 검사는 공통 소유자·전체 응답·정밀 값·행/버튼·초안 보존의 대표 누락을 거부한다. 원본 여섯 ancestry/import tree/archive ref 21개 및 공통 테마 223개 UI 소스/20개 토큰을 확인했다. 시트/일정 배포 빌드·타입 검사도 통과했으며 React 타입 확장 뒤 브라우저 번들 내용 해시는 동일했다.
- 보정 UI 집중 49개는 두 폭/테마·여섯 저장 순서·공유 슬롯·목록 왕복/수동 재조회·전체 ACK/403/409/422/500·계정/해제/폼 제거/timeout·선택적 사유·버튼 색/프로필을 통과했다. 이전 집중 실행의 단일 timeout 실패는 실제 30초 제한보다 짧은 21초만 기다렸던 테스트 오류였으며 31초로 바로잡았다. 공통 entity를 사용하는 DOM 단위 fixture 종료 시에는 observer를 정리해 종료 후 jsdom 예외를 제거했다. 실패 실행은 통과 집계에 포함하지 않는다.
- PC 라이트 확인창과 모바일 다크 삭제 상태, 최종 PC 다크 입력/저장 상태·모바일 다크 확인창·모바일 라이트 입력의 대비/배치/문서 넘침을 직접 확인했다. 테스트는 실제 격리 Razor 및 합성 HTTP/직원/발생분만 사용하고 운영 기록을 변경하지 않는다. 전체 여섯 앱 브라우저 회귀와 추가 초기 JSON 인코딩 회귀의 최종 결과는 아래에 기록한다.
- 여섯 앱 전체 Chrome 914개가 실패·재시도 없이 통과했다(`artifacts/browser-grants-ui-all`, 13.1분, failedTests 없음). 이후 Leave 삭제 확인창에 공통 danger 옵션만 연결하고 동일 49개 검사에 실제 위험 색/대상 표시·취소 후 사유 유지 단언을 보강했다. 최신 실제 Razor 6개를 다시 생성한 뒤 보정/복구/정산/Leave 셸 186개가 모두 통과했다(`artifacts/browser-grants-ui-final`, 1.9분). 모바일 다크/PC 라이트 삭제 확인창도 직접 확인했다. 공통 자산 런타임은 이 마지막 보완에서 바뀌지 않았다.
- 저장된 직원 이름/메모의 `</script>`·따옴표·한글을 실제 초기 JSON에 넣는 서버 회귀를 추가했다. HTML 실행 없이 원문과 큰 ID가 복원되는 것을 확인했고 최종 전체 .NET 175개가 통과했다(`artifacts/server-grants-ui-final/grants-ui-final.trx`). 마지막 루트 검사 206개, 시트 타입 검사 및 diff 공백 검사도 통과했다. 이는 로컬 격리 검증이며 원격 CI·운영 배포 성공 증거가 아니다.
- 남은 실제 업무 UI는 공휴일 관리/import, 채널 웹훅 설정, 기존 달력 날짜 상세 프레임이다. 특히 채널 웹훅은 URL 비밀값과 외부 테스트 발송을 일반 폼 원문/성공 안내에 그대로 복제하지 않도록 별도 계약이 필요하다. 생성된 새 페이지의 셸/권한/테마 검사는 있으나, 이후 새로 추가하는 모든 입력 폼의 공통 primitive 사용을 현재의 페이지별 marker 검사만으로 강제한다고 볼 수 없다. 기존 미전환 항목과 새 위반을 구분하는 일반 검사도 완료 감사 전 보강해야 한다. 원격 저장소·필수 보호·이미지 출처·개별 배포/롤백·운영 이관은 미완료다. 원격 대상은 비공개 `company-org/company-workspace` 안을 사용자에게 확인 요청했으며 답변 전 생성/게시하지 않는다. 원본 여섯 저장소·운영 checkout·DB/환경·Docker는 그대로다.

## 54차: 새 native UI 누락 검사와 감소 전용 이관 부채 (2026-09-11)

- 페이지별 marker 검사와 별개로 등록된 모든 앱 UI 루트를 조사하는 `check-ui-primitives.mjs`를 추가했다. 일반 입력·버튼·표·dialog, literal DOM 생성과 전역 confirm/prompt/alert를 검사한다. 기존 `check:ui` → 구조 검사에 연결하여 CI의 기존 필수 검사 경로에도 포함된다. 새 파일뿐 아니라 기존 파일에 추가한 raw 태그도 거부한다.
- 기준 커밋 `91b9dc29d48d29eb7d3e5b5ad66f2834d9a32c7c`의 123개 앱 소스에서 47개 파일·477회 표기/호출·439개 고유 서명을 기록했다. 파일 전체 예외가 아니라 경로·규칙·정규화한 태그/호출 hash·개수 및 파일별 사유/제거 조건을 고정한다. 53차의 Leave 업무 목록은 우선 전환 대상이며 모든 앱의 미전환 UI가 그것만 남았다는 뜻으로 확대하지 않는다. 공통 저장 계약에 연결된 기존 화면에도 native 스타일 표기가 남아 있다.
- 읽기 전용 보고서와 감소 전용 prune를 제공한다. 제거된 부채가 목록에 남아도 검사 실패이며, 신규 위반과 감소가 동시에 있어도 prune는 파일을 쓰지 않는다. 새 경로·서명·개수 증가를 자동 수락하거나 기준을 재생성하는 명령은 없다. 최초 기록은 현재 앱 파일에 변경이 없는 기준 커밋에서 한 번만 만들었다.
- 실제 생성 소유자의 정확한 출력 바이트를 대조한다. 임의 generated 경로나 주석은 제외 근거가 아니며, 버전만 찍는 HTML/Razor 본문은 계속 검사한다. 생성기 read/walk/outputs에 명시한 작업 루트를 전달해 격리 fixture를 호스트 파일과 혼동하지 않게 했다. 기본 빌드 자산 바이트는 변경되지 않았다.
- HTML/JSX/템플릿, 속성 안의 >·화살표, 잘못된 data-class·조건식·동적 접미사·중복 속성·HTML className, 정확한 부채/개수/메타데이터를 검사한다. 실제 여섯 앱 페이지 생성 fixture에 신규/기존 파일 raw 버튼, 가짜 generated 파일, 생성 어댑터 변조, 감소와 신규 위반의 동시 prune를 주입하여 거부를 확인했다. 공통 클래스 사용과 정상 감소는 통과한다. 테스트 파일은 conventional 경계로만 구분한다.
- 최종 루트 계약/DOM/생성기/CI 정책 215개가 실패·skip 없이 통과했고 집중 검사 10개도 통과했다. 원본 여섯 ancestry·exact import tree·archive ref 21개와 공통 생성 바이트, 20개 토큰/223개 테마 소스 및 diff 공백을 확인했다. 이 단계는 앱/공통 브라우저 런타임·서버 변경이 없으므로 이전 914개 브라우저 결과를 재실행했다고 주장하지 않는다.
- 계약 `ui-primitives.md`와 지침·구조/개발 문서에 범위와 한계를 명시했다. 임의 동적 코드의 완전한 AST 검사, checkbox/file 전용 공통 컴포넌트, 모든 폼의 전송/전체 응답/해제 수명주기, 실제 시각 품질 검증은 이 검사로 대체되지 않는다. 기존 부채의 단계적 실제 전환도 남는다.
- 원격 저장소 생성/게시 승인 답변은 아직 없으며 원격·원본 저장소·운영 checkout·DB/환경·Docker를 변경하지 않았다. 원격 필수 보호·이미지 출처·독립 배포/롤백·운영 이관은 미완료다. 전체 목표는 진행 중이다.

## 55차: 통계 조회 UI의 실제 공통 primitive 전환 (2026-09-11)

- 대시보드·결과·빌드/보스 목록과 상세의 일반 필드·기간/분류/정렬/설명·뒤로 이동 버튼 및 표를 공통 primitive로 전환했다. JS에서 생성하는 카탈로그·장비·완성 조합 버튼도 같은 공통 content 레이아웃을 사용한다. 게임 엔티티/이미지·차트·조회/정렬 키·native 제약·SSO/API/업무 데이터는 보존한다.
- 작은 정렬·도움말용 quiet/compact/icon 및 복합 내용 grid 버튼을 공통 CSS에 추가했다. pressed/selected는 실제 선택과 동일한 공통 의미 색을 사용하며 quiet hover와 disabled 우선순위도 검증한다. 분류 필터를 독립 tabpanel처럼 표현하지 않고 group/toggle button으로 정리했다. 표의 증감/표본 수준은 기존 클래스/값을 유지하면서 공통 data-tone과 키보드 행 포커스로 연결한다.
- 별도 입력/버튼 선택·hover·비활성 CSS를 제거했다. 라이트모드 th 배경·td hover의 개별 덮어쓰기와 node 버튼의 별도 테두리도 정리했다. 체크 라벨의 강제 display로 완성 조합 전용 옵션이 다른 분류에까지 보이던 문제를 고쳤다. 필터는 두 폭에서 줄바꿈하며 긴 표는 공통 내부 스크롤을 유지한다. 통계 로컬 변경 자산의 버전 쿼리도 갱신했다.
- 통계 HTML의 기존 이관 부채 94회를 감소 전용 prune로 제거했다. 전체 잔여는 383회/348개 서명이며 통계 JS의 native 강제 갱신 확인 호출은 아직 남아 있다. 단순 클래스 전환을 모든 갱신/조회 수명주기·공통 상태 안내의 완료로 보고하지 않는다.
- 루트 계약/DOM/생성기/CI 정책 215개와 통계 앱 41개가 통과했다. 앱 구문 검사, 시트/일정 빌드와 최신 실제 Razor 준비 153개도 통과했다. 원본 여섯 ancestry/import tree/archive ref 21개, 공통 생성 바이트·20개 토큰/223개 테마 소스 및 diff 공백을 확인했다. 서버·운영 DB는 변경하지 않았다.
- 기존 통계 화면/동작 42개와 새 색상·정렬·native 입력·조합 옵션·동적 버튼 집중 4개가 통과했다. 초기 집중 실행에서는 synthetic change와 blur의 중복, pointer focus와 keyboard focus-visible을 혼동한 테스트를 실제 Tab 조작으로 바로잡았다. 라이트모드 th 색 실패는 실제 개별 CSS 덮어쓰기로 확인해 제거했다. 표 의미 색 보강을 위해 중단한 첫 전체 실행과 실패 실행은 완료 집계에서 제외한다.
- PC 다크의 빌드 필터/분류·모바일 다크 필터, 최종 PC 라이트 상세와 모바일 다크 상세의 선택 표시/배치/대비를 직접 확인했다. PC 라이트 표의 선택 정렬·키보드 행 윤곽·의미 색과 모바일 다크 표의 실제 오른쪽 끝 열 접근 화면도 확인했다. 통계는 합성 API, 다른 앱은 격리 HTTP/실제 Razor fixture를 사용한다.
- 최종 여섯 앱 실행은 918개 중 917개 통과, 1개 종료 단계 시간 초과다(`artifacts/browser-statistics-primitives-final-all`, 10.7분). Leave 달력의 입력 수정·저장·이동·쓰기 수/오류 없음 단언이 모두 완료된 뒤 browser context close에서 30초를 초과했음을 trace로 확인했다. 같은 코드/동일 시나리오를 10회 반복하여 모두 통과했다(`artifacts/browser-statistics-primitives-teardown-recheck`, 17.4초). 최초 전체 실행의 failed 상태를 passed로 바꾸거나 모든 검사가 한 번에 통과했다고 보고하지 않는다. 재시도 설정·테스트 제한·제품 코드는 이 재검증을 위해 바꾸지 않았다.
- 통계 최종 46개 시나리오는 위 전체 실행에서 모두 통과했다. 이후 모바일 표의 실제 scrollLeft/마지막 열 위치와 스크롤 후 화면 증거를 추가한 집중 4개도 모두 통과했다(`artifacts/browser-statistics-primitives-final-controls`, 9.2초). 추가 검사는 앱/공통 런타임을 변경하지 않는다. 통합 필수 CI·운영 승인 증거는 여전히 별도 미완료다.
- 계약 `statistics-controls.md`와 공통 입력/버튼/표 문서 및 작업 지침을 갱신했다. 다음 통계 작업은 서버 202 접수/429 강제 허용과 완료 상태를 분리하고 공통 확인·전송·후속 읽기·계정/해제 수명주기를 연결하는 것이다. 원격 승인 답변 전 저장소 생성/게시와 운영 이관은 하지 않는다. 전체 목표는 진행 중이다.

## 56차: 통계 갱신의 실제 워커 접수 계약 (2026-09-11)

- 공통 갱신 UI 연결 전에 서버가 IPC send 직후 가짜 queued 상태와 202를 반환하던 경계를 수정했다. 실제 worker/요청 UUID 및 전체 publication 확인 응답을 기다리며 202에 acceptance=accepted를 추가했다. 기존 두 POST URL·회사 SSO/내부 인증·관리자 force·한 시간 제한·자동 집계를 유지한다.
- 집계 코어가 디스크 초기화 뒤 expected revision과 진행 중 작업을 확인한다. force도 진행 중 집계를 새 요청처럼 접수하지 않는다. 실행 번호는 프로세스 내 추적값이고 영구 작업 저장/멱등성 보장은 아니다. 접수 timeout/전송·연결 오류/불완전 응답 뒤 같은 워커에 재전송하지 않으며 정확한 늦은 응답이나 워커 교체로 서버 내부 대기를 해소한다. HTTP 성공과 실제 집계 ready/error·마지막 완료본 보존을 분리했다.
- 실제 코어 성공 경로 검증 중 원본 로그가 없는 날짜의 빠른 조회 GZip 파일을 열다가 ENOENT가 처리되지 않아 워커를 종료시킬 수 있는 문제를 재현했다. 원본 없는 날만 건너뛰고 원본이 있는 날짜의 파일 누락/CRC 손상은 pipeline 오류를 통해 집계 실패로 전달한다. 캐시 누락을 무조건 빈 결과로 숨기지 않는다. 초기에 이 문제로 실패한 테스트를 성공 증거에 포함하지 않았다.
- 통계 전체 58개가 통과했다(기존 41개 + 새 접수/실제 큐/압축 읽기/실행 검사 17개). 실제 app-server/analytics-worker 엔트리포인트와 fork IPC·인증·권한·429/202/409·집계 실패 후 완료 시각 보존을 격리 환경에서 확인했다. 외부 fetch를 전부 테스트 로더로 제한하고 운영 환경·키·DB·Azure에 연결하지 않았다. 기존 실제 SSO 검사에 역할/계정 헤더 위조 거부를 추가했다.
- 루트 `npm run check`의 공통 계약/DOM/생성기/CI 정책 215개가 통과했다. 앱 구문 검사·공통 생성 바이트·44개 등록 페이지·383개 잔여 primitive와 원본 여섯 ancestry/exact import tree/archive ref 21개 및 diff 공백을 확인했다. 공통 UI/CSS·의존성·CI 정책은 바꾸지 않았다.
- 통계 Chrome 46개가 모두 통과했다(`artifacts/browser-statistics-refresh-boundary-chrome`, 37.2초, .last-run passed). 첫 실행은 로컬 Playwright 전용 Chromium 미설치로 브라우저 시작 전에 46개 모두 실패했다(`artifacts/browser-statistics-refresh-boundary`). 기존 문서의 WORKSPACE_BROWSER_CHANNEL=chrome을 지정해 설치된 Chrome으로 재실행했고 제품/검사 정책은 이 사유로 바꾸지 않았다. 이 단계는 서버 변경으로 새 UI 시각 개선이나 여섯 앱 전체 브라우저 재실행을 주장하지 않는다.
- `statistics-refresh.md`·앱 README·개발/구조 문서·AGENTS에 접수/완료/미확정과 운영 이미지 단위 호환을 명시했다. 브라우저 native 확인창, 공통 확인/상태/전송 및 계정·문서·후속 조회 수명주기 연결은 다음 실제 전환으로 남아 있다. 서버 기반만으로 해당 UI 전환을 완료한 것으로 보고하지 않는다.
- 원격 생성/게시 승인 답변 전 새 원격·원본 저장소·운영 checkout/환경/DB/Docker는 변경하지 않았다. 원격 보호·배포 출처/롤백·운영 이관 및 전체 목표 완료 감사는 계속 미완료다.

## 57차: 통계 갱신의 실제 공통 확인·상태 UI 연결 (2026-09-11)

- 상단 갱신 버튼을 `refresh.js`의 CompanyDialog/CompanyState/CompanyForm 작업 세션에 연결했다. 비동기 집계 JSON API를 native 폼 저장으로 위장하지 않는다. 기존 native confirm/강제 자동 재시도·독립 publication 폴링을 제거하고 초기 준비 전 버튼을 비활성화한다. 일반 조회 오류도 공통 상태로 표시하며 쓰지 않는 status-message 스타일을 제거했다.
- 현재 계정·역할/live-demo/Title·worker 준비/접수 상태·서버 시각·revision을 조회하고 확인 의도를 고정한다. enhanced POST는 8KB 한도, custom header/JSON 및 현재 계정·역할/대상/force 인가와 원래 revision을 서버/큐에서 검증한다. 기존 두 URL의 레거시 응답과 SSO·내부 인증·기간 제한은 유지한다. 클라이언트와 worker가 동일 publication/전체 접수 응답 검증을 소비한다.
- 확인 취소는 POST 없이 끝나고, 확실한 거부와 미확정 전송을 구분한다. 미확정은 문서의 쓰기를 잠그고 GET만 제공한다. 계정 변경·문서 해제·timeout과 취소되지 않는 늦은 JSON을 배제하며, 새 확인/쓰기는 이전 overview GET도 무효화한다. 접수 후 runId의 완료/실패를 추적하고 완료본의 runId/ready/publishedAt이 맞는 조회만 화면 갱신 성공으로 표시한다. 완료 후 읽기 실패의 재확인은 POST를 반복하지 않는다.
- 실제 서버/worker 엔트리포인트 테스트에 enhanced context/현재 계정 거부/POST/전체 ACK 검증을 추가했다. 통계 69개가 통과했다. 첫 전체 실행에서는 Windows에서 부모 exit 직후 아직 worker가 닫지 않은 임시 SQLite 제거가 EBUSY로 실패했다. 테스트 정리를 상속된 파이프 close까지 기다리게 수정하고 전체를 다시 통과했다. 업무 단언 실패나 운영 DB 오류로 혼동하지 않는다.
- 새 브라우저 12개와 기존 통계 46개가 통과했다. 확인 취소/Escape·포커스·관리자 force·직원 cooldown, 접수/완료·읽기 실패, 충돌/미확정·timeout·계정/해제·늦은 JSON을 실제 앱과 공통 자산에서 검사한다. 초기 다크 시나리오의 잘못된 localStorage 키를 화면 확인으로 발견해 실제 OS 테마와 html data-theme 단언으로 고쳤다. 그 이전 이미지를 다크 검증 증거로 사용하지 않는다.
- 올바른 테마에서 통계 58개 전체가 통과했다(`artifacts/browser-statistics-refresh-ui-final`, 54.7초). 실제 모바일 다크 확인창과 PC 다크 완료 상태의 레이아웃/대비를 직접 확인했다. 마지막 사용하지 않는 로컬 상태 CSS 제거와 자산 버전/초기 disabled 정리 뒤에도 58개를 다시 통과했다(`artifacts/browser-statistics-refresh-release`, 약 1.2분). 공통 UI 소유 코드/테마는 변경하지 않았으며 이번 단계에서 여섯 앱 전체 회귀를 재실행했다고 주장하지 않는다.
- 루트 계약/DOM/생성기/CI 정책 215개가 통과했다. native confirm 부채 1회는 실제 제거 후 감소 전용 prune로 정리해 382회/347개 서명이 남는다. 생성기 감소 검사 fixture는 아직 남은 CS 이탈 확인을 대상으로 바꿨고 증가/부분 prune 거부 검증은 유지한다. 생성 바이트/44개 페이지/원본 여섯 ancestry·exact tree·21개 ref 및 diff 공백도 확인했다.
- 계약/README/작업 지침/구조·개발 문서를 현재 실제 연결 상태로 갱신했다. 일반 통계 overview 전체 데이터 검증·모든 로딩 시각 요소, 다른 앱의 남은 primitive/폼, 원격 보호·출처·배포/롤백·운영 전환은 미완료다. 기존 원격/운영 저장소·Docker·환경·DB는 변경하지 않았으며 전체 목표는 계속 진행 중이다.
- 마지막으로 공통 계정 이벤트보다 먼저 context의 역할 변경이 도착하는 경우도 이전 본문을 무효화하고, 접수 대기 중 바꾼 필터는 마지막 선택을 보존해 이후 GET으로만 적용하도록 보강했다. 새 두 회귀를 포함한 통계 브라우저 60개 실행의 종료 핸들은 더 이상 존재하지 않았으며 `artifacts/browser-statistics-refresh-complete/.last-run.json`의 passed/실패 없음과 현재 테스트 목록 60개를 재확인했다. 관찰이 끊겼다는 이유로 실행을 중복 시작하지 않았다.
- 인계 전 현재 코드에서 루트 215개와 통계 서버·계약 69개를 다시 실행해 모두 통과했다(각 약 11초/19초). 앱 구문·공통 구조·CI 정책·원본 여섯 이력/21개 ref·diff 공백 검사도 통과했다. 최종 산출물의 모바일 다크 확인창과 PC 다크 완료 화면을 직접 다시 확인했다. 이 검증은 로컬 격리 결과이며 운영 반영이나 원격 필수 보호가 완료됐다는 뜻은 아니다.

## 58차: 시트 컨트롤과 기록 정보의 공통 UI 전환 (2026-09-11)

- 시트 관리의 작업/이동 버튼, 수식·한국어 비교 검색과 select, 표 스크롤, 상태 pill을 공통 primitive로 연결했다. 개별 primary/ghost/danger, 검색 포커스/테마, 표 hover/글자·상태 색 CSS를 제거했다. 검색 필드는 표시 라벨을 제공하며 모바일에서 버튼 문구를 숨기지 않는다. 검색 결과 없음은 공통 empty 상태로 표시한다.
- 기존 무동작 스냅샷 상세 버튼은 `기록 정보`로 바꾸고 generated `useWorkspaceDisclosure`로 한 행만 펼치게 했다. 목록 API의 전체 기록 ID·작업 종류·대상/분석 ID·시각·셀 수만 표시한다. 키보드·ARIA·접기/펼치기·화면 재진입과 긴 ID의 줄바꿈을 공통 구현에 연결했다. 새 셀 조회/복원 API나 서버 데이터 변경을 추가한 것은 아니다.
- 기존 `useSheetActions`의 확인 문구·분석 기준/대상·전체 응답·후속 읽기, 서버 쓰기 허용·스냅샷/충돌 정책을 유지했다. 읽기 전용 수식 제거는 설명창을 열되 실제 실행을 막는 기존 UX를 보존한다. 이 스타일 전환으로 초기 분석/비교/스냅샷 읽기 전체 수명주기까지 완료한 것으로 보지 않는다.
- 루트 215개와 시트 단위 22개, 타입 검사·클라이언트/서버 배포 빌드, 실제 생성 서버의 격리 runtime 2개가 통과했다. 원본 여섯 ancestry/exact import tree/21개 archive ref, 공통 생성 바이트·44개 페이지·diff 공백도 확인했다. 감소 전용 prune로 12회를 제거해 잔여 부채는 370회/335개 서명이다. 검사 예외를 늘리지 않았다.
- 시트 브라우저 46개가 모두 통과했다(`artifacts/browser-sheet-controls-final`, 33.1초). 첫 실행의 모바일 두 실패는 End를 가로 끝 이동으로 가정한 테스트 오류였으며 ArrowRight 실제 이동과 마지막 열 접근 검증으로 고쳤다. 초기 44/46 결과를 성공으로 바꾸지 않았다. 최종 세 본문의 넘침·실제 테마 입력 색/44px 크기·상단 캡처를 보강한 집중 4개도 통과했다(`artifacts/browser-sheet-controls-visual-final`, 7.5초).
- PC 라이트 비교 화면, 모바일 다크 비교/기록 정보, PC 다크 수식 입력·표·실행 버튼을 직접 확인했다. 실제 React 번들/공통 자산과 합성 HTTP만 사용한다. 이번에는 공통 런타임/CSS를 변경하지 않았으므로 여섯 앱 전체 브라우저 재실행을 주장하지 않는다.
- 계약/README/구조·개발 문서와 AGENTS를 갱신했다. 시트 초기 읽기 계약/계정 변경 후 본문·늦은 응답 처리, 남은 앱별 폼/primitive·장식 CSS, 원격 보호·출처·독립 배포/롤백·운영 이관은 아직 미완료다. 원격 승인 답변 전 새 저장소 게시/기존 저장소 변경과 운영 이관은 하지 않는다. 전체 목표는 계속 진행 중이다.

## 59차: 시트 조회 응답과 본문의 계정 범위 연결 (2026-09-11)

- 기존 미커밋 `api.ts`/`sheetReads.ts`를 확인하고 실제 App의 독립 초기화/분석/비교 처리를 `useSheetData`로 연결했다. 설정·분석·기록을 모두 검증한 뒤 처음 표시하며, 일반 재조회 실패에는 마지막 정상값을 유지한다. 공통 WorkspaceState의 error/denied와 명시적 재시도를 사용하고 로딩 전 가짜 데모 배지/빈 원본 링크를 제거했다.
- 설정/분석/한국어 비교/스냅샷의 전체 필드·문서/행 대상·건수·중복·링크·날짜를 검사한다. 150개만 공개하는 분석 규칙과 전체 총계의 차이, blocked 원문의 빈 위치·문자열 셀·서로 다른 문서의 스냅샷 목록은 보존했다. 읽기 API의 기존 POST/GET과 same-origin/no-store를 유지하며 HTML/손상 JSON을 정상 결과로 표시하지 않는다.
- 초기/재분석/비교 채널에 30초 관찰 제한과 요청 객체 식별자를 연결했다. 취소를 무시하는 늦은 JSON/응답·이전 finally가 새 값/잠금을 바꾸지 않는다. 비교 중 이동은 해당 읽기만 취소하고 정상 비교값은 유지한다. 재분석/저장 후 갱신 성공에는 오래된 비교를 제거한다. scope-change/401·403/문서 해제는 이전 본문·기록·원본 링크를 지우고 저장 확인/후속 결과도 이전 본문을 복원하지 못하게 했다. bfcache 보관은 유지한다.
- 시트 단위 검사는 기존 22개에 응답/HTTP/실제 hook 및 문서 이탈 후 늦은 저장 검사를 추가해 39개가 통과했다. 타입 검사와 실제 React/서버 배포 빌드도 통과했다. 격리 생성 서버 검사 2개에서 실제 URL/자산/데모 조회·쓰기 차단·미인증 API 거부를 확인했다. 운영 Google/DB/환경/Docker를 변경하지 않았다.
- 루트 공통 계약/DOM/생성기/CI 정책 215개, 공통 생성 바이트/44개 페이지, 원본 여섯 ancestry/exact import tree/21개 archive ref, diff 공백을 확인했다. 127개 UI 소스에서 기존 primitive 부채 370회/335개 서명은 그대로이며 새 예외를 늘리지 않았다. 이 단계는 UI primitive 감소나 원격 CI 보호 설정 완료를 주장하지 않는다.
- 실제 Chrome 번들 검사 52개가 통과했다(`artifacts/browser-sheet-reads`, 52.1초). 이전 46개에 손상 응답/다른 대상·정상값 보존/403 후 본문 제거·재진입의 PC·모바일/두 테마 4개, 늦은 JSON/비교 중 이동 2개를 추가했다. 이전 쓰기 확인 테스트는 계정 변경 후 문서를 명시적으로 다시 여는 새 경계를 검사하며 합성 미리보기 응답은 실제 서버의 전체 필드로 보완했다. 모바일 다크와 PC 라이트 권한 안내 화면을 직접 확인했다.
- 계약/README/AGENTS·구조/개발 문서를 현재 구현과 한계로 갱신했다. 서버 expected actor/revision, 저장 후 묶음 조회의 관찰 제한, 남은 앱별 UI/폼, 원격 보호·출처·배포/롤백·운영 전환은 미완료다. 시트 셀별 스냅샷 복원/릴리스의 원래 미구현 업무를 새로 완성했다고 보고하지 않는다. 전체 통합 목표는 계속 진행 중이다.
- 마지막 non-persisted pagehide의 저장 후 늦은 읽기 배제 보강 후 단위 39개·타입/빌드·공통 구조를 다시 통과했다. 최종 실제 번들의 Chrome 52개도 재실행해 모두 통과했다(`artifacts/browser-sheet-reads-final`, 37.1초). 서버/공통 CSS는 이번 단계에서 변경하지 않았으며 다른 다섯 앱의 브라우저 전체 재실행이나 운영 검증으로 확대 해석하지 않는다.

## 60차: CS 네 화면의 공통 입력·작업 컨트롤 전환 (2026-09-11)

- Steam 환불·상품 지급/회수·로그 검색·플레이어 데이터의 일반 입력/라벨/그리드와 버튼을 공통 primitive로 연결했다. 개별 input/select/textarea 및 primary/secondary/danger, 행 작업/상세/변경 이동 버튼의 색·포커스·크기 복제를 제거했다. 기존 ID·native 검증·disabled·업무 API와 실행 의도/응답 수명주기는 유지했다.
- 동적 키/복사/삭제/상세 버튼과 플레이어 표는 공통 클래스가 명시된 정적 template로 만들고 사용자 값은 textContent/dataset으로 전달한다. 로그 보기 모드는 실제 aria-pressed로 공통 선택 색을 사용한다. 표 스크롤에 이름·키보드 진입을 제공하고 플레이어 필터 라벨은 보이게 했다.
- JSON 편집기의 투명 textarea는 앱 소유 diff canvas를 드러내는 용도로만 유지한다. 고정폭 글꼴/줄 높이·탭·커서/선택/스크롤·변경 이동과 GZip/lossless 원문을 보존했다. PC 화면 확인에서 닫기/삭제의 글자별 줄바꿈을 발견해 작업 열 공간을 조정하고 버튼 한 줄·셀 경계 단언을 추가했다.
- 실제 스타일 helper는 라벨 연결·공통 클래스뿐 아니라 계산된 두 테마 색·selected/disabled·일반 44px/compact 32px 크기를 검사한다. shell 초기 상태와 실제 업무 모듈 검사를 구분한다. 모바일 표의 ArrowRight 가로 스크롤도 확인한다. 최종 Chrome CS 전체 130개가 통과했다(`artifacts/browser-cs-controls-final`, 3.4분). 이전 실행 130개 및 집중 40개도 통과했으나 마지막 열 너비 수정의 최종 증거는 이 전체 실행이다.
- 최종 PC 라이트 플레이어 상세의 행 버튼, 모바일 다크 편집기/강조, PC 라이트 환불 초기 폼과 PC 다크 상품 초기 폼을 직접 확인했다. shell 캡처의 설정 확인 중 비활성 상태를 실제 운영 연결 성공으로 해석하지 않는다. 실제 운영 Steam/PlayFab/Azure에 쓰기를 실행하지 않았다.
- CS 구문 검사와 단위 97개, 루트 계약/DOM/생성기/CI 정책 215개가 통과했다. 공통 생성 바이트·127개 UI 소스·44개 등록 페이지, 원본 여섯 ancestry/exact import tree/21개 archive ref와 diff 공백을 확인했다. 실제 전환 후 감소 전용 prune으로 74회를 제거해 기존 부채는 296회/264개 서명이다. 검사 예외를 늘리지 않았다.
- `cs-controls.md`와 native 필드 계약·앱 README·AGENTS·구조/개발 문서를 갱신했다. 플레이어 동기 초안 폐기 confirm 2곳과 상품 clipboard fallback textarea 1곳, checkbox 등 별도 컨트롤·장식/옛 adapter CSS는 남는다. 공통 CSS/런타임 자체는 바꾸지 않아 여섯 앱 전체 브라우저 재실행을 주장하지 않는다.
- 원격 승인 답변 전 새 저장소 게시/기존 저장소 변경이나 운영 checkout/환경/DB/Docker 전환은 하지 않았다. 남은 앱별 UI/폼·원격 필수 보호·출처·독립 배포/롤백 및 운영 이관과 전체 완료 감사는 계속 진행 대상이다.

## 61차: Portal 신규·기존 계정과 조직 폼의 공통 컨트롤 (2026-09-11)

- `_AccountField`의 이름/이메일·유형/상태/역할·부서/입사일·프로젝트 검색을 공통 필드에 연결했다. 신규와 기존 상세는 동일 공통 2열/모바일 1열 그리드를 사용하며 계정 검색·부서/프로젝트 필터에 표시 라벨을 제공한다. 기존 필드 계약·prefix/제출값·기준값·required/disabled·공용 계정 입력 보존과 회사 마스터 역할 정책은 유지했다.
- 계정 등록/일괄 저장/되돌리기/상세/권한 전환과 조직 저장/프로젝트 아이콘 버튼을 공통 primitive로 전환했다. 기존 개별 입력·select 상태/포커스·검색·상세 버튼 CSS를 제거했다. 권한 표는 공통 표 및 이름 있는 키보드 스크롤 영역으로 연결하고 펼친 상세는 모바일 본문 폭을 유지한다. 링크 버튼·checkbox 스위치·카드 장식까지 모두 전환한 것은 아니다.
- 부서·프로젝트 이름/색상/직원 검색도 공통 필드로 연결했다. Razor bool 입력의 checkbox type 두 곳을 명시해 일반 입력 검사와 구분했다. 서버/저장 API·프로필/아이콘 버전·조직 별도 트랜잭션·native HTML fallback은 변경하지 않았다. 새 예외 없이 감소 전용 prune으로 기존 30회를 정리해 266회/234개 서명이 남는다. 이 중 두 곳은 checkbox 의미 명시이며 공통 텍스트 필드로의 전환으로 세지 않는다.
- 격리 Razor 생성/서버 통합 검사 153개가 통과했다. 실제 TestServer/임시 SQLite 출력의 계정/조직/아이콘·프로필·알림·페이지 계약을 사용하고 운영 DB/계정에 연결하지 않았다. 루트 계약/DOM/생성기/CI 정책 215개, 공통 생성 바이트·127개 UI 소스·44개 등록 페이지, 원본 여섯 ancestry/exact import tree/21개 archive ref 및 diff 공백을 확인했다.
- 신규/기존 계정의 관리자/마스터·두 너비/두 테마와 조직 생성/수정의 실제 계산 색·최소 크기·라벨/선택값·모바일 스크롤 집중 16개가 통과했다. 이후 Portal 셸/계정 저장·충돌/원문 복구·native fallback·조직·프로필·아이콘·알림 전체 Chrome 181개도 통과했다(`artifacts/browser-portal-controls-final`, 3.2분). 이번에는 Portal CSS만 변경했고 여섯 앱 전체 브라우저 재실행을 주장하지 않는다.
- 요소 전체 캡처에 고정 상단바/표의 화면 밖 영역이 포함되는 것을 발견해 실제 viewport 캡처를 추가했다. CSS smooth scroll 완료 전 캡처되는 문제는 테스트의 instant 이동과 이름 필드 위치 단언으로 수정했다. 최종 8개가 통과했다(`artifacts/browser-portal-controls-viewport-final`, 13.3초). PC 라이트 신규 계정, 모바일 다크 기존 직원 수정, 모바일 다크 프로젝트 폼을 직접 확인했다. 운영 화면 검증이나 서버 데이터 변경으로 해석하지 않는다.
- `portal-controls.md`, 공통 필드 계약·AGENTS·README·구조/개발 문서를 갱신했다. 다른 Portal 버튼·동적 checkbox·링크/장식, Leave/Schedule 미전환 UI, 원격 보호/출처/배포·롤백/운영 이관은 남는다. 새 원격 생성·푸시·원본 저장소/운영 환경·Docker 변경은 하지 않았으며 전체 목표는 계속 진행 중이다.

## 62차: 연차 감사 로그 공통 UI와 조회 수명주기 (2026-09-11)

- 감사 검색/표시 개수/페이지 입력·버튼·표를 공통 primitive에 연결했다. 개별 상세 toggle과 밝은 고정 pre 색을 제거하고 `CompanyDisclosure`의 한 행 펼치기·ARIA/키보드 및 공통 의미 색을 사용한다. 기존 모바일 카드 표와 이름 있는 키보드 스크롤 영역을 함께 유지한다. 감소 전용 prune으로 10회/9개 서명을 제거해 256회/225개가 남는다. 새 예외를 늘리지 않았다.
- `audit-logs.js`는 동일 출처 GET·요청 식별/취소·15초 관찰과 현재 로컬 직원/검색 조건/필수 HTML 대조를 연결한다. 일시 오류에는 정상 목록/입력을 유지하고 명시적 GET 재시도를 제공한다. 기존 오류 강제 redirect를 제거하고 계정/권한 변경에는 이전 본문을 지운다. 취소를 무시하는 늦은 HTML·이전 finally가 새 응답/필터를 덮어쓰지 않는다. 전체 HTML sanitizer나 모든 행/페이지의 별도 서명을 구현한 것은 아니다.
- 큰 감사 ID와 JSON 정수는 Razor 인코딩 원문으로 보존한다. 작업자 사진은 기존 로컬→회사 ID 매핑으로 연결하고 사진 없을 때 이름 첫 글자를 표시한다. 모바일에서 사진과 이름이 서로 다른 줄/열에 흩어지지 않게 묶었다. JavaScript가 없으면 상세를 모두 펼치고 기존 GET 폼/링크를 유지한다. 서버 인가·감사 DB/조회 정책·쓰기 API는 변경하지 않았다.
- 격리 Razor/서버 통합 154개가 통과했다. 새 감사 테스트는 임시 DB의 합성 12건으로 필터/페이지/개수·64비트 원문·HTML 인코딩과 연결 실패/비활성 계정 거부를 확인한다. 마지막 작업자 표시 수정 후 해당 서버 검사 1개도 다시 통과했다. 운영 계정/감사 로그를 읽거나 변경하지 않았다.
- 실제 Chrome 감사/기존 연차 셸 118개가 통과했다(`artifacts/browser-leave-audit-final`, 1.1분). 최종 모바일 작업자 정렬과 사진/초성 검색·로컬 ID 제출/조회 후 사진 유지 검증을 추가한 감사 집중 21개도 통과했다(`artifacts/browser-leave-audit-polish`). 실제 Razor/공통 자산과 합성 HTTP·프로필 이미지를 사용하며 운영 사진 검증을 주장하지 않는다.
- PC 라이트/다크와 모바일 다크의 실제 상세 화면을 확인했다. 라벨/44px 입력·계산된 두 테마 색/문서 넘침·native fallback·503/네트워크/잘못된 응답·401/403/범위·timeout·늦은 body 검사를 포함한다. 공통 CSS/런타임 자체는 수정하지 않았고 여섯 앱 전체 브라우저 재실행을 주장하지 않는다.
- 루트 계약/DOM/생성기/CI 정책 215개, 공통 생성 바이트·128개 UI 소스·44개 페이지, 원본 여섯 ancestry/exact import tree/21개 archive ref를 확인했다. 계약/AGENTS/앱 안내·구조/개발 문서를 갱신했다. 다른 앱별 UI·폼, 원격 보호/출처와 독립 배포·롤백/운영 이관은 남는다. 새 원격 생성·푸시·원본 저장소 및 운영 환경/Docker 전환은 하지 않았으며 전체 목표는 계속 진행 중이다.

## 63차: 팀 일정 버전 기록·개인 TODO 공통 컨트롤 (2026-09-11)

- 버전 프로젝트 선택/번호·출시일·패치/조치·상태/연결 버전과 TODO 신규/기존 입력을 공통 필드에 연결했다. 모든 이관 버튼은 기본/primary/quiet/danger 및 행 compact/content 변형을 사용한다. TODO 탭의 실제 aria-selected, 위험 버전 조건, disabled/readOnly/필수값/길이와 기존 이벤트·업무 hook은 보존했다. 신규/수정 TODO 모두 표시 라벨을 제공한다.
- 버전 표는 공통 표/이름 있는 키보드 스크롤로 전환하고 기존 disclosure/상세 폭을 유지한다. 개별 버튼/입력/표 색·선택/비활성·padding 복제를 제거하되 표 셀 여백·열 구조와 카드의 1열 정렬은 앱 배치로 유지한다. 실제 화면에서 안정 버전 카드가 중앙에 몰리고 표 제목이 조밀해진 것을 발견해 셀 12px과 content grid 열을 보완하고 위치 단언을 추가했다.
- 실제 계산 스타일 검사에서 다크 전역 hover가 공통 기본 버튼 색을 덮어쓰는 두 실패를 확인했다. 옛 hover에 `:where(:not(.cw-button))`를 적용해 공통 버튼을 제외하되 선택자 우선순위를 높이지 않았다. 이를 통해 아직 미전환 버튼 및 공통 상태/선택기의 hover 경계를 유지한다. 초기 스타일 집중 결과 6/8을 통과로 바꾸지 않았다.
- 팀 일정 단위 111개·타입 검사/실제 React 배포 빌드가 통과했다. 원래 TODO 추가/편집/완료/순서/삭제·미확정·버전 비교/충돌/저장/후속 읽기·역할/프로필/초성 검색/내비게이션 등을 포함한 Chrome 전체 96개가 통과했다(`artifacts/browser-schedule-record-controls-final`, 1.5분). 마지막 버전 표/카드 배치 변경은 두 너비/두 테마 집중 4개로 재검증했다(`artifacts/browser-schedule-record-controls-geometry`, 5.5초).
- `support/schedule-controls.mjs`는 이관한 실제 DOM의 클래스/라벨뿐 아니라 계산 색·44px/compact 크기·선택/disabled/hover를 검사한다. 모바일 표의 ArrowRight 이동 및 펼친 상세/문서 너비를 확인한다. 최종 PC 라이트 버전 목록/상세, 모바일 다크 버전 편집과 PC 다크·모바일 라이트 TODO 편집을 직접 확인했다. 합성 API를 사용했고 운영 기록/개인 할 일이나 DB를 변경하지 않았다.
- 루트 계약/DOM/생성기/CI 정책 215개와 공통 생성 바이트·128개 UI 소스·44개 페이지, 원본 여섯 ancestry/exact import tree/21개 archive ref 및 diff 공백 검사를 통과했다. 감소 전용 prune으로 38회/36개 서명을 제거해 부채는 218회/189개 서명이다. 검사 예외를 늘리지 않았다.
- `schedule-record-controls.md` 및 필드 계약·README·AGENTS·구조/개발 문서를 갱신했다. 기존 동기 이탈 확인·버전 편집 dialog 프레임, checkbox·상태 badge/카드 장식과 나머지 일정/연차 UI는 남는다. 이번 스타일 전환이 서버 경쟁 제어/멱등성 또는 다른 다섯 앱 전체 재검증을 의미하지 않는다. 원격 보호/출처·독립 배포/롤백·운영 이관은 계속 필요하며 새 원격 생성·푸시·원본 저장소/운영 환경 변경은 하지 않았다. 전체 목표는 계속 진행 중이다.

## 85차: 시트 실행의 공통 저장 프로토콜 연결 (2026-09-12)

- 수식 마이그레이션과 한국어 원문 갱신의 직접 JSON 쓰기를 조회 API에서 제거하고 generated `CompanyForm` transport로 연결했다. 30초 관찰 제한, 계정 변경·이탈, 공통 상태와 불확실 응답의 자동 재전송 금지를 다른 서비스와 같은 경계로 맞췄다.
- 서버 성공/충돌/입력 오류를 `workspace-form-v1` saved/conflict/invalid 응답으로 구분했다. 클라이언트는 실제 전송 본문과 작업·분석/미리보기·문서 ID 및 전체 실행 결과를 대조한 뒤에만 완료로 인정한다. Google 쓰기 허용, 최신 분석/미리보기 검사, 스냅샷과 실패 복구는 유지했다.
- 시트 타입 검사, 단위 41개, 실제 클라이언트/서버 빌드와 격리 운영 서버 2개가 통과했다. 루트 구조·계약·CI 정책 328개와 실제 Chrome의 공통 쓰기 흐름 PC/모바일·두 테마 4개도 통과했다(`artifacts/browser-sheet-write-protocol`). 운영 Google Sheets나 Docker는 변경하지 않았다. 서버 actor/revision 헤더, 영구 멱등성 키와 여섯 앱 전체 브라우저 회귀는 아직 남아 있다.

## 86차: 시트 실행 후 조회의 공통 관찰 연결 (2026-09-12)

- 저장 성공과 미확정 요청의 수동 재확인에서 설정·분석·스냅샷·한국어 미리보기를 `WorkspaceReadSession`의 단일 `after-write` 채널로 묶었다. 모든 API에 같은 abort signal을 전달하고 30초 제한, 최신 ticket, 화면·계정 변경 및 해제 취소를 통과한 결과만 본문에 적용한다.
- 화면 이동 뒤 취소를 무시한 늦은 묶음 조회가 새 화면을 덮지 않는 hook 회귀를 추가했다. POST 자동 반복 금지와 성공 영수증/후속 조회 실패의 분리는 유지한다. 시트 타입 검사·단위 42개·배포 빌드, 루트 328개와 실제 Chrome PC/모바일·두 테마 4개가 통과했다(`artifacts/browser-sheet-after-write-session`).

## 87차: 시트 실행의 회사 actor·기준 결합 (2026-09-12)

- 시트 설정 응답에 현재 회사 actor 문자열 ID를 추가하고, 실행 POST가 `X-Workspace-Actor`와 `X-Workspace-Sheet-State`를 전송하도록 했다. 서버는 요청마다 중앙 세션에서 확인한 actor 및 본문의 분석/미리보기 ID와 헤더를 정확히 대조한 후에만 Google 작업을 시작한다.
- 공통 transport를 통하지 않은 요청, 다른 직원 actor, 누락/이전 기준은 각각 권한 거부 또는 conflict로 실패한다. 긴 직원 ID는 숫자로 변환하지 않는다. 이 헤더는 영구 멱등성 키나 Google/DB 트랜잭션 revision을 대신하지 않는다.
- 순수 서버 경계 단위 검사를 추가해 시트 검사는 45개가 됐다. 타입 검사·배포 빌드·격리 운영 서버 2개, 루트 구조·계약·CI 정책 328개와 실제 Chrome PC/모바일·두 테마 4개도 통과했다(`artifacts/browser-sheet-actor-state`). 운영 계정·Google Sheets·Docker는 변경하지 않았다.

## 88차: 직원 충돌 비교 GET의 공통 관찰 연결 (2026-09-12)

- 직원 일괄 저장 충돌 뒤 실행되는 Review GET을 화면 전용 AbortController·timer에서 `CompanyReadSession`의 `account-review` 채널로 옮겼다. 전체 계정·선택지·지표와 현재 초안을 검증하는 기존 3-way 병합은 유지한다.
- 계정 범위 변경은 채널을 취소하고 비지속 페이지 이탈은 세션을 해제한다. 취소 신호를 무시하고 도착한 늦은 응답도 직원 기준 버전·입력·동적 프로젝트 선택지를 바꾸지 않는다. 구조 단위 5개와 실제 Chrome의 3-way 비교 4조합 및 범위 변경 3경로, 총 7개가 통과했다(`artifacts/browser-portal-account-review`). 운영 DB·계정·Docker는 변경하지 않았다.

## 89차: 업무 상세 일정 기간화와 인라인 수정 (2026-09-14)

- 업무 상세 일정에 종료일을 추가해 하루가 아닌 시작일~종료일 범위로 등록·수정할 수 있게 했다. 기존 단일 날짜 데이터는 배포 시 같은 날짜의 종료일로 안전하게 보정하며, 종료일이 시작일보다 앞선 입력과 300자 초과 제목은 서버에서 거부한다.
- 업무 상세 화면에서 상세 일정과 공용 TODO를 각각 인라인 수정할 수 있게 했다. 상세 일정은 업무 수정 권한을 따르고, 공용 TODO 내용은 등록자 또는 관리자만 수정하며 완료 처리는 기존처럼 함께 참여한 직원이 할 수 있다. 저장 실패 시 입력 중인 초안은 유지한다.
- `내 일정`의 업무 본문·상세 일정·공용 TODO 요약은 업무 카드 옆이 아니라 카드 바로 아래에서 한 덩어리로 표시한다. 기간 일정은 시작일과 종료일을 함께 표기한다.
- 일정 서버 70개, 프런트 단위 214개와 배포 빌드, 실제 브라우저 등록·기간 수정·TODO 수정 및 카드 아래 배치 검사를 통과했다. 운영 배포 전에는 일정 데이터 볼륨을 별도로 백업하고 이전 이미지 식별자를 롤백 기준으로 기록한다.

## 90차: 운영 작업 경로의 모노레포 단일화 (2026-09-14)

- Portal·Leave·Schedule·CS·Statistics·Sheet의 운영 `.env`를 각 `apps/<service>` 아래 Git 비추적 파일로 이관하고, 여섯 컨테이너의 Compose 작업 디렉터리를 모노레포 경로로 재등록했다. 포트·네트워크·볼륨·이미지는 유지했다.
- Sheet의 5개 런타임 JSON(12,240,097바이트)을 `apps/sheet/data`로 복사해 파일별 SHA-256을 확인하고, 서비스를 정지한 상태에서 다시 대조한 뒤 새 bind 경로로 전환했다. Google 서비스 계정은 기존 `C:/dev/docker/private` 읽기 전용 bind를 유지한다.
- 기존 분리 checkout 6개, 구형 개별 Cloudflare 터널 2개, 임시 UI 미리보기 1개와 분리 저장소를 다시 clone하던 구형 배치 5개를 `C:/dev/docker/쓰레기통/legacy-company-folders-20260914-1548`로 이동했다. 삭제가 아니므로 필요하면 원래 위치로 복구할 수 있다.
- 수입 보존 검사는 더 이상 과거 checkout을 요구하지 않고 모노레포의 import ancestry/tree/archive ref를 확인한다. 여섯 서비스의 공개/로컬 응답과 Docker 상태를 확인했으며 CS·Statistics·Sheet healthcheck는 healthy다.

## 91차: 팀 일정 월간 기간 리본 (2026-09-15)

- 월간 달력이 기간 업무를 날짜별 카드로 반복하던 구조를 주 단위 연속 리본으로 바꿨다. 겹치는 업무는 별도 레인에 두고 주 경계를 넘는 업무는 다음 주에도 기존 레인을 우선 사용한다.
- 리본에 프로젝트 아이콘·업무명·담당자 프로필과 이름·상태를 배치했다. 내 일정에서는 본문 요약도 유지하며 모바일에서는 달력 내부 가로 스크롤과 시작 칸의 정보 노출을 함께 보존한다.
- 원격 전체 회귀에서 통합 뒤 34px로 남아 있던 표시 기간 선택기가 공통 필드의 44px 최소 높이 검사를 실패하는 것을 확인해 공통 입력 기준으로 복구하고, 과거의 36px 이하 기대값도 같은 기준으로 갱신했다. IAP 프로젝트 시나리오 5개는 브라우저 준비 단계가 IAP 의존성과 프런트 산출물을 만들지 않아 실패한 것으로 확인해 CI 설치·빌드 대상에 IAP를 추가했다.
- 프런트 단위 220개와 일정 서버 70개, 배포 빌드, 모노레포 구조·계약·CI 정책 386개가 통과했다. 실제 Chromium에서 PC 라이트와 모바일 다크의 팀/내 월간 화면, 5일 리본 폭·담당자·공휴일·문서 넘침을 확인했다. 서버 API·DB·운영 일정 데이터는 변경하지 않았다.

## 92차: 새 업무 참여 프로젝트 기본 선택 (2026-09-15)

- 새 업무 폼은 최초 담당자가 참여 중인 활성 프로젝트 가운데 숫자 ID가 가장 작은 항목을 기본 선택한다. 프로젝트 배열의 표시 순서나 이름 정렬에는 의존하지 않는다.
- 미지정과 다른 활성 프로젝트는 계속 선택할 수 있으며, 폼을 연 뒤 담당자를 바꿔도 이미 정한 프로젝트를 자동으로 변경하지 않는다. 기존 업무 수정의 저장값과 보관 프로젝트 연결은 변경하지 않았다.

## 93차: 버전 기록 수정 안내와 삭제 (2026-09-15)

- 기본 버전과 마이너 카드에서 편집창 진입을 명확히 표시하고, 기존 내용·날짜·상태·문제/조치 수정을 유지하면서 삭제 작업을 추가했다. 삭제는 별도 위험 확인창에서 프로젝트·버전·기록 ID를 다시 보여준다.
- 기본 버전에 마이너가 남아 있거나 다른 버전의 복귀·해결 대상으로 연결된 기록은 삭제를 거부한다. 현재 Version과 서버 상태 토큰이 일치한 기록만 변경 이력과 함께 삭제하며 전역 감사 로그에는 삭제 직전 기록을 남긴다.
- 생성·수정·삭제는 같은 공통 전송·확인 수명주기와 전체 ACK 검사를 사용한다. 삭제 후 목록 조회만 실패하면 삭제 요청을 반복하지 않고 목록만 다시 확인한다.

## 94차: 모바일 공통 헤더와 본문 위치 정렬 (2026-09-17)

- 모바일 공통 헤더 높이 88px에 비해 본문 상단 여백이 선택자 우선순위 때문에 64px로 남아 첫 줄을 가리던 문제를 공통 CSS에서 수정했다.
- CS 모바일 내부 상단바는 고정 중첩 대신 일반 흐름으로 표시한다. 일정·CS·통계의 320px 다크 화면에서 내부 첫 줄이 공통 헤더 아래로 시작하는지 실제 브라우저로 확인했다.
- 업무 데이터·DB·인증 경로는 변경하지 않으며 APK 코드는 수정하지 않는다.

## 95차: 모바일 웹 자산 캐시 갱신 (2026-09-17)

- 실기기에서 94차 CSS 배포 뒤에도 이전 헤더 위치가 남아 있는 문제가 보고됐다. 공개 공통 CSS 응답에 4시간 캐시가 적용되는 것을 확인해 새 웹 자산을 장기간 재사용할 수 있는 경로를 정리했다.
- Android WebView는 시작할 때 HTTP 캐시만 비우고 로그인 쿠키·웹 저장소는 유지한다. Portal은 공통 CSS·JS와 서비스 워커에 `no-store`를 적용하며 서비스 워커는 CSS·JS를 네트워크 우선으로 읽고 오프라인에서만 캐시를 사용한다.
- 데이터 볼륨·업무 API·로그인 흐름은 바꾸지 않는다. 이전 APK와 이미지는 유지해 각각 되돌릴 수 있게 한다.

## 96차: 모바일 공용 헤더와 회사 로고 전수 점검 (2026-09-17)

- 이전 검사는 첫 화면 위치만 보았기 때문에 스크롤된 서비스 내부 상단바가 고정 공용 헤더 뒤로 들어가는 상황을 놓쳤다. CS·통계·시트의 내부 상단바는 모바일 공용 헤더 아래에서 sticky로 유지하고, 일정의 보기 전환 탭도 같은 기준 위치에서 유지한다. 일정 집중 보기의 시작 위치는 88px 모바일 헤더 높이를 사용한다.
- 공용 로고를 JavaScript inline `background-image`의 `data:` URI로 설정하던 방식은 일정·CS의 CSP에서 허용되지 않았다. 일곱 서비스가 허용하는 회사 포털 HTTPS PNG를 실제 `img`와 favicon으로 사용하고, 로드 실패 때는 `96` 문자가 남도록 했다. 생성 번들에서 대형 로고 data URI를 제거했다.
- 등록된 52개 페이지의 구조 검사, 여섯 서비스 모바일 라이트/다크 140개 브라우저 사례, 상품 관리 8개 경로, CS 운영 CSP 조건의 로고 검사에서 공용 헤더·아이콘과 스크롤 위치를 확인했다. 실기기 APK의 최종 화면 확인은 별도이며, DB·업무 API는 변경하지 않았다.

## 97차: 모바일 상단 공간 축소 (2026-09-17)

- 두 줄 88px 공용 헤더를 한 줄 56px로 줄이고 현재 페이지를 로고 옆에 표시한다. 좁은 화면에서는 서비스 링크를 펼치지 않고 서비스 메뉴 버튼을 유지해 페이지 제목이 사라지지 않게 한다.
- CS·통계·시트의 중복 제목만 모바일에서 숨기고 상태·작업 컨트롤은 일반 본문 흐름에 남긴다. 팀 일정은 보기 전환 한 줄만 공용 헤더 아래에 고정하며 분류·등록·필터는 스크롤된다. PC 배치는 그대로 유지한다.
- 공통 구조 52개 페이지 검사, 수정한 네 서비스 320px 다크 브라우저 59개 사례(초기 5건은 숨은 페이지 제목으로 발견해 수정 후 집중 9건 재검증), 일곱 서비스 등록 화면 390px 라이트 52건이 통과했다. 320px 팀 일정·시트 실제 렌더링을 확인했다. Android 실기기와 운영 배포는 별도 확인 대상이다.

## 98차: Android 시작 화면 로고 크기 보정 (2026-09-18)

- Android 12 이상에서 원본 회사 로고를 시작 화면 아이콘으로 직접 사용하던 설정을 중앙 128dp 로고와 투명 여백이 있는 전용 drawable로 교체했다. 시스템 원형 마스크로 로고가 확대·잘리는 문제를 줄인다. 이전 Android 시작 화면의 로고도 112dp에서 96dp로 줄였다.
- 앱 버전을 1.1.10(코드 15)으로 올렸다. 모바일 계약 테스트와 Android release 단위 테스트·서명 빌드가 통과했고 기존 1.1.9 APK와 서명 인증서가 일치한다. 실기기 시작 애니메이션 확인과 웹/운영 배포는 수행하지 않았다.

## 99차: 문서형 서비스의 메뉴 전환과 CS 상단 배치 보정 (2026-09-18)

- 회사 홈·연차·CS처럼 문서별로 서버가 렌더링하는 서비스의 동일 출처 이동에 공통 View Transition을 적용했다. 헤더와 사이드바를 별도 전환 대상으로 유지하고 움직임 줄이기 설정에서는 애니메이션을 끈다. 인증·폼 제출·서버 페이지별 스크립트는 기존 경계를 유지하며 팀 일정 같은 단일 문서 라우팅으로 바꾼 것은 아니다.
- CS 공통 CSS에 남아 있던 내부 상단바의 64px 상대 위치 이동을 제거해 본문 제목과 상단바의 중첩을 해결했다. CS 네 화면을 1080·390·320px 브라우저 레이아웃 12건에서 확인하고 동일 출처 브라우저 이동의 실제 전환 시작·도착을 1건 검증했으며, 공통 구조 52개 페이지 검사를 통과했다. 운영 배포와 인증된 실제 서비스 이동 검증은 수행하지 않았다.

## 100차: 통계 고유 사용자 지표와 완성 노드 기준 (2026-09-22)

- 계정 연동 UID를 원문 대신 해시로 저장하고, 기간 내 동일 계정을 한 번만 세는 `/users` 화면과 API를 추가했다. 캐릭터·스킨·무기·펫·스킬·유물·노드 사용률, 챕터 1~4 도달률, 단계별 최고 기록과 처음 관측된 Run 시간 구간을 제공한다.
- 노드·노드 조합·노드 포함 조합은 `110~119` 최종 노드를 장착한 완성 트리만 수집한다. 중간까지만 선택한 출정은 노드 관련 분모와 결과에서 제외한다.
- 모든 항목 툴팁을 body portal의 viewport 고정 배치로 전환해 왼쪽 사이드바와 카드 overflow에 가려지는 문제를 막았다. 원본 Azure 로그와 90일 TTL 정책은 유지하며 새 수집 리비전으로 다시 전개한다.
