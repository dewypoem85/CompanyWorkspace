# CS 입력·작업 컨트롤

Steam 환불, 상품 지급·회수, 로그 검색, 플레이어 데이터의 일반 입력과 작업 버튼은 공통 `primitives.css`를 소비한다. 업무 API·권한·확인 의도·요청 수명주기는 기존 각 모듈의 책임이다. 스타일 전환을 서버 계약 변경이나 전체 폼 전환 완료로 해석하지 않는다.

## 소유권

- 정적인 업무 안내 아홉 개는 `static-guidance.md`의 `cw-callout`을 사용한다. 기존 `.notice.success` 등의 고정 글자색을 복원하지 않는다. 실제 작업 결과의 공통 상태 렌더러와 실행 확인·저장은 그대로 유지한다.
- 일반 input/select/textarea는 `cw-form-control`, 표시 라벨은 `cw-form-field`, 기본 그리드는 `cw-form-fields`/`cw-form-wide`다. 기존 type/required/min/max/disabled와 업무 입력 검증을 보존한다.
- 버튼은 `cw-button`의 primary/danger/quiet, compact, icon/content 변형을 사용한다. 개별 배경·포커스·hover·비활성·선택 색을 덧씌우지 않는다. 로그 간단히/상세 모드는 실제 `aria-pressed`가 공통 선택 색을 결정한다.
- 동적 행 작업/키/복사/삭제/로그 상세 버튼과 플레이어 표는 공통 클래스를 포함한 정적 template로 만든다. 사용자 키·값·명령은 template 문자열에 보간하지 않고 textContent와 dataset으로 전달한다. JSON 복사는 `clipboard.md`의 공통 `CompanyClipboard.copyText`만 사용한다.
- 표는 `cw-data-table`과 이름 있는 `cw-table-scroll` 영역을 사용한다. 스크롤 영역은 tabindex로 키보드 진입을 제공한다. 업무 열 너비·줄바꿈은 앱이 소유한다. 플레이어 작업 열은 닫기/삭제가 한 줄로 보이고 셀 밖으로 나가지 않도록 공간을 확보한다.
- 네 화면의 환경/모드, Steam 거래·ID 검증, 로그 작업, 상품 미리보기 상태는 `cw-state-pill`과 `data-tone`을 사용한다. 초기 설정 확인은 `neutral`, 실제 응답은 업무 의미에 따라 `success`/`warning`/`danger`로 갱신한다. CS 전용 `badge-*` class와 라이트·다크 팔레트는 두지 않는다.
- 플레이어 데이터 저장·키 추가·영구 삭제의 명시적 확인은 `cw-check-control`/`cw-checkbox`를 사용한다. 공통 계층이 두 테마의 선택·hover·focus와 18px 입력을 소유하고 CS에는 긴 대상 문구의 줄바꿈과 폼 배치만 남긴다. 체크 여부가 기존 저장 버튼 활성화와 요청의 `confirmed` 값에 연결되는 동작은 유지한다.
- 상품 명령의 Dry Run과 기존 명령 병합 승인도 같은 checkbox primitive를 사용한다. 앱에는 긴 설명 정렬만 남기며 읽기 전용 설정의 Dry Run 강제/disabled, 미리보기 토큰·DataVersion·기존 값 변경 시 병합 승인 무효화와 실제 요청 값은 바꾸지 않는다.
- 로그 검색의 장기 범위 실행 확인도 같은 checkbox primitive를 사용한다. 앱은 제목·설명의 크기와 줄바꿈만 소유하고 선택·focus·두 테마 색과 입력 크기는 복제하지 않는다. 장기 검색 판정, 확인 전 실행 차단과 요청의 `confirmLongRange`는 기존 도메인 계약을 유지한다.

## 코드 편집기 예외

JSON textarea도 공통 컨트롤이지만 diff canvas를 드러내는 투명 배경과 고정폭 글꼴·줄 높이·탭 간격은 편집기의 기능이다. 이를 일반 textarea에 확산하지 않는다. GZip/lossless 원문, 선택·커서·스크롤, 변경 줄 이동과 단일 상세 패널 재사용을 유지한다. 전체 JSON을 일반 parse/stringify로 바꾸지 않는다.

## 남은 범위

플레이어 초안 폐기는 `draft-transitions.md`의 공통 확인·비동기 상세 전환과 적용 직전 현재성 검증을 사용한다. 상품 JSON 복사와 구형 브라우저 fallback은 공통 클립보드 소유자에 연결했다. 현재 정적 CS 문서의 사용자 노출 checkbox와 업무 상태 pill은 공통화했지만 radio/hidden/file와 동적·검사 밖 컨트롤, 다른 개별 장식/옛 테마 adapter CSS까지 모두 제거한 단계는 아니다. 새 예외를 늘리지 않고 실제 전환 후 감소 전용 debt prune을 사용한다.

## 검증

CS 구문 검사·단위 검사와 `tooling/browser-tests/cs-` 전체를 실행한다. `support/cs-controls.mjs`는 실제 계산된 색·최소 크기·라벨 연결·selected/disabled 및 상태 pill의 tone별 공통 배경/글자색을 검사한다. 공통 상태 렌더러가 소유한 버튼과 앱이 만드는 native 버튼의 소유권을 구분한다. shell 검사는 초기 neutral 상태와 레이아웃을, 각 업무 검사는 실제 모듈의 읽기·확인·쓰기·늦은 응답과 의미 tone 전환을 검증한다. PC/모바일·두 테마 캡처는 자동 단언과 별도로 직접 확인한다. 공통 CSS/런타임 자체를 변경하면 여섯 앱 회귀 범위로 확대한다.
