# 공통 native 입력 필드

연차 대시보드의 신청/날짜 상세·목록 취소/철회·조회 필드도 같은 primitive를 소비한다. 업무별 기하와 기존 native 검증/저장·직원 선택 경계는 `leave-dashboard-controls.md`를 따른다.

연차 공휴일·채널 설정도 공통 필드/버튼/표를 사용한다. 가져오기 폼의 고유 ID·동일 전송 이름·JSON 원문과 아직 native인 저장/확인 경계는 `leave-admin-controls.md`를 따른다.

팀 일정 업무/댓글 Editor와 날짜 입력 진입부의 전환 및 popup/저장 수명주기 경계는 `schedule-task-controls.md`를 따른다. textarea의 읽기·편집 면적은 도메인 기하로 유지하며 일반 필드 기본 높이가 이를 덮어쓰지 않는지 확인한다.

팀 일정의 버전 기록과 개인 TODO도 일반 필드/버튼을 소비한다. 현재 전환·테마 우선순위와 checkbox/기존 편집 프레임 등의 경계는 `schedule-record-controls.md`를 따른다.

일반 문자열·숫자·날짜 입력, 단일 select, textarea는 `packages/workspace-ui/src/primitives.css`의 명시적 클래스를 재사용한다. 전송은 별도 `CompanyForm.attach`에 연결한다. CSS는 업무 검증·저장·초기화·필드 정의를 소유하지 않는다.

```html
<fieldset class="cw-form-fields">
  <label class="cw-form-field">이름
    <input class="cw-form-control" name="name" required>
  </label>
  <label class="cw-form-field cw-form-wide">메모
    <textarea class="cw-form-control" name="note"></textarea>
  </label>
</fieldset>
```

- `cw-form-fields`: 2열 기본 그리드, 600px 이하 1열, 내부 여백·간격·최소 너비. 페이지 내 위치/최대 폭은 소비자가 정한다.
- `cw-form-field`: 라벨·컨트롤·설명을 세로로 묶고 폭 축소·텍스트 색상을 통일한다.
- `cw-form-control`: 일반 native 컨트롤의 배경·테두리·글자·포커스·비활성을 의미 토큰으로 관리한다. checkbox/radio/hidden/file·버튼에는 붙이지 않는다. 다중 체크박스는 기존 공통 선택기를 사용한다.
- `cw-form-wide`: 전체 열을 사용하는 메모/도구 영역. `hidden`, native `disabled/required/min/step` 의미를 유지한다.
- 앱 전체 input/select를 덮어쓰지 않는다. 새로운 상태가 필요하면 공통 정의를 확장하며 페이지별 복제 CSS를 추가하지 않는다. PC/모바일·두 테마·기존 native 검증을 확인한다.

## 범위 입력

range는 텍스트 필드가 아니므로 `cw-form-control` 대신 `cw-range`를 사용한다. 보이는 라벨은 `cw-range-field`, 슬라이더와 현재 값은 `cw-range-control`로 묶고 output의 `for`를 input ID에 연결한다. 공통 CSS는 트랙·핸들·포커스·비활성·두 테마만 소유한다. `min/max/step/value`, 키보드에 따른 값 변경과 업무 선호 저장은 소비자가 유지하고 브라우저에서 함께 검증한다.

## Native 작업 버튼

계정·개인 설정·알림·Discord 및 정산의 기존 버튼도 `account-action-controls.md`를 따른다. 프로필 사진 프레임에는 버튼 배치만 두고 별도 skin/disabled opacity를 복제하지 않는다. native OAuth/SSO 이동과 알림·사진·정산 저장 수명주기는 보존한다.

`<button class="cw-button" data-variant="primary" type="submit">저장</button>`처럼 opt-in한다. 기본/primary/danger 변형이 있으며 최소 높이 44px, 포커스, hover, disabled를 공통 의미 토큰으로 표시한다. `fieldset[disabled]`에 속한 버튼도 `:disabled` 규칙을 따르므로 빨간 위험 버튼이 계속 실행 가능한 것처럼 보이지 않는다. 실행 권한·확인·전송은 CSS가 아닌 실제 disabled 속성과 공통 폼에서 처리한다. 기존 앱의 primary/danger 클래스와 혼합하지 않는다.

통계 필터처럼 서버 쓰기가 없는 입력은 공통 필드 CSS를 사용하되 필터의 조회 동작은 소비자가 유지한다. 현재 native 필드 소비자는 Leave 정산·보정/발생분과 통계 필터이며 공통 버튼은 보정/발생분과 통계의 정렬·기간·분석 종류·동적 상세 탐색에서도 사용한다. 다른 기존 업무 폼/버튼 스타일이 모두 전환됐다는 뜻은 아니다.

- `data-variant="quiet"`: 정렬/설명/뒤로 이동 등 배경을 강조하지 않는 버튼이다. hover/키보드 포커스/비활성은 여전히 공통 소유다.
- `data-size="compact"`: 표 안의 작은 작업에 최소 높이 32px와 공통 간격/12px 글자를 사용한다. 일반 작업의 44px 기본은 바꾸지 않는다.
- `data-layout="icon"`: compact 설명/아이콘 버튼의 32px 정사각형 영역이다. 읽을 수 있는 이름 또는 aria-label을 필수 제공한다.
- `data-layout="content"`: 엔티티/복합 정보 버튼 내부를 grid로 배치한다. 업무별 열 구조는 앱이 정하고 버튼 배경·테두리·상태는 공통 소유한다.
- `aria-pressed="true"` 또는 `aria-selected="true"`는 공통 선택 색상을 사용한다. quiet 버튼도 hover로 선택 표시를 지우지 않으며 disabled가 선택 색상보다 우선한다. ARIA 상태는 실제 선택 동작과 일치해야 한다.

생성 자산을 갱신하고 공통 CSS 변경 시 여섯 앱의 회귀 검사를 실행한다. 통계의 필터/정렬/동적 탐색 상세 범위와 남은 업무 수명주기는 `statistics-controls.md`를 따른다.

시트 관리의 작업 버튼·검색/select·표는 같은 primitive를 소비한다. 필터와 실제 시트 쓰기는 구분하며, 스냅샷 메타데이터 펼치기는 generated disclosure로 연결한다. 실제 연결과 남은 범위는 `sheet-controls.md`를 따른다.

## 기록 카드와 셀 등록 영역

- `data-variant="record"`는 프로젝트/분류의 식별 색을 갖는 카드다. 소비자는 검증된 CSS 색을 `--record-accent`로 전달하며 배경/hover/선택/비활성은 공통 CSS가 관리한다. 누락 시 공통 accent/line으로 대체한다. 앱에서 `--cw-*` 토큰을 재정의하는 방식은 사용하지 않는다.
- `data-emphasis="low|high"`는 기록의 약한/강한 강조이며 기본/low/high의 색 혼합은 공통 소유다. 선택 및 disabled가 모든 강조보다 우선해야 한다. 프로젝트 색이나 배경색만으로 상태를 설명하지 않고 제목/유형/실제 ARIA를 유지한다.
- content/compact 변형과 함께 사용할 수 있으며 카드의 열/배치·폭·날짜 구간·테두리 모양은 소비자가 소유한다. hover/disabled 배경을 앱의 task-card/milestone-chip 규칙으로 다시 덮지 않는다.
- `data-layout="overlay"`와 quiet는 position:relative 셀 전체를 덮는 명시적 작업 버튼이다. 기존 셀 전체 클릭을 작은 아이콘 버튼으로 축소하지 않는다. 접근 가능한 이름이 필수이며 선택적 `data-overlay-hint` 장식은 aria-hidden으로 두고 hover/키보드 포커스에서 표시한다. focus outline은 셀 내부이며 기본 최소 크기/비활성은 공통 규칙을 유지한다.
- 카드 선택/강조/disabled 우선순위, 셀 전체 기하와 키보드 등록, 기존 상세·드래그 ID를 실제 브라우저에서 검증한다. 공통 CSS 변경이므로 생성 자산 및 여섯 앱 브라우저 회귀도 갱신한다.

## 표의 의미 색과 키보드 진입

Portal 신규·기존 직원은 같은 `_AccountField`의 공통 필드/그리드를 사용하고 부서·프로젝트 폼도 이를 소비한다. 권한 스위치·링크 버튼 등과의 경계 및 실제 렌더링 검증은 `portal-controls.md`를 따른다.

CS 네 화면의 일반 입력·동적 버튼도 공통 primitive를 사용한다. 코드 편집기의 diff canvas 예외와 초안 전환 경계는 `cs-controls.md`를 따르고, JSON 복사는 `clipboard.md`의 공통 소유자를 사용한다.

`cw-data-table`의 td에 `data-tone="success|danger|warning"`을 지정하면 공통 의미 색상을 사용한다. 앱의 임의 클래스 색이 기본 td 글자색에 가려지지 않게 명시적으로 연결한다. 데이터값/정렬/접근성 의미는 소비자가 소유한다. `tabindex`가 있는 본문 행의 focus-visible은 공통 hover 배경·accent 윤곽을 사용하며, CSS만으로 행에 상세 클릭/키보드 동작을 만들지는 않는다.
