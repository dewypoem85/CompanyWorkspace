# 공통 UI primitive 검사와 기존 이관 부채

새 기능을 기존 앱에 추가해도 공통 버튼·입력·표·창 사용을 검사한다. 페이지 등록/상단 셸 검사와 업무 폼의 전송·응답 계약 검사는 별도로 유지한다. 클래스 하나가 있다고 업무 동작까지 검증된 것은 아니다.

## 사용 기준

| native UI | 공통 소유자 |
| --- | --- |
| 일반 input/select/textarea | `cw-form-control` 및 `native-fields.md`의 필드/라벨/그리드 |
| 단일 checkbox control | `cw-check-control` label과 `cw-checkbox`; 선택·focus·disabled 테마는 공통 소유, 실제 name/value/hidden fallback은 소비자 소유 |
| compact boolean switch | `cw-switch-control`, native `cw-switch` checkbox와 바로 뒤 `cw-switch-track`; 앱은 업무 라벨·표 배치만 소유 |
| range input | `cw-range`와 `cw-range-field`/`cw-range-control`; 일반 텍스트 필드 클래스로 대체하지 않는다. |
| button | `cw-button`, `native-fields.md`의 primary/danger/quiet/record 및 compact/content/overlay 규약 |
| table | `cw-data-table` 및 공통 가로 스크롤 프레임 |
| dialog | `CompanyDialog.present`의 `cw-dialog-form`, 공통 확인창의 `cw-review`, 또는 `owned-modals.md`의 `attach`/generated hook에 연결한 `cw-modal` |
| 실행 확인 | `CompanyDialog.confirm` / React generated `confirmWorkspaceAction` |
| 텍스트 복사 | `CompanyClipboard.copyText` 및 `clipboard.md` |
| 정적인 업무 안내 | `static-guidance.md`의 `cw-callout`, 명시적 tone·note 역할·제목/본문 |
| 읽기 전용 상태·분류 | `cw-state-pill`과 명시적 `data-tone`; 앱은 판정·문구·조건부 노출만 소유 |
| 제목 옆 단순 개수 | `cw-count-badge`; 상태 tone을 부여하지 않고 앱은 주변 배치만 소유 |
| 일시적 업무 알림 | `CompanyToast.show`/`dismiss`; 앱은 안정된 ID·의미·문구와 업무 후속 동작만 소유 |

직원/프로젝트 표시·검색은 해당 공통 엔티티 컴포넌트를 사용한다. `<input type="submit">`에 버튼 클래스를 붙이지 않고 `<button type="submit" class="cw-button">`을 쓴다. 이미 공통 API가 내부에서 만드는 native 요소를 앱에 복사하지 않는다.

## 자동 검사 범위

정적 안내의 literal `role="note"`/`cw-callout`은 section 소유자·tone·제목/본문을 요구하고 live 상태 초기화 혼용을 거부한다. 작성된 inline code를 보존하며 실제 대비/긴 문자열은 별도 브라우저 검사로 확인한다. 정적인 안내와 비동기 작업 결과를 구분한다.

반응형 카드 표는 `responsive-tables.md`를 따른다. 명시적 cards/key-value 변형에 table role·실제 header scope를 요구하며 cards는 서버 레이블과 셀의 첫 `cw-table-value` wrapper도 검사한다. 열 제목/값 대응과 긴 레이블의 실제 높이는 브라우저에서 검증한다.

`cw-modal`은 클래스만으로 통과하지 않는다. 같은 소스의 `useWorkspaceModal` 또는 `CompanyDialog.attach` 호출, 접근 가능한 이름을 요구하고 JSX/native open·onCancel·onClose 중복 소유를 거부한다. 외부 파일을 임의 탐색해 연결을 추정하지 않는다. 이는 호출과 해당 ref의 모든 데이터 흐름을 증명하는 AST 검사가 아니므로 실제 소비자의 구조/변이·DOM/브라우저 검증도 유지한다.

이관된 읽기 전용 상태는 앱이 의미·문구·노출 조건과 필요한 배치 여백만 소유한다. 예를 들어 Leave 가불은 승인 대기열·최근 내역·직원 신청 내역·달력 상세 모두 warning state pill을 사용하고, 과거 승인 건의 `사용 완료` 보조 상태는 neutral pill을 사용한다. 앱 전용 색·크기·테마 보정으로 다시 분기하지 않는다. 페이지 전용 CSS만 검사해서는 전역 CSS의 숨은 재정의를 놓칠 수 있으므로 소비 화면이 함께 로드하는 앱 CSS를 합쳐 검사하고, 개발 미리보기도 실제 상태 primitive 계약을 따른다.

상태 pill이 의미 점 `<i>`를 포함하면 점의 크기·원형·현재 tone 색은 공통 primitive가 소유한다. 앱은 상태 판정과 문구만 제공하며 연결·동기화 같은 개별 상태별로 점 skin을 복제하지 않는다.

정적인 준비 완료 표시도 실제 상태이면 같은 규칙을 사용한다. 예를 들어 시트 운영 개요의 `READY`는 success pill이며, 작은 영문 라벨이라는 이유로 별도 색·크기·점 skin을 만들지 않는다.

토스트는 입력 오류, 조회 완료, 복사 완료처럼 현재 화면을 가리지 않고 즉시 알려야 하는 결과에만 사용한다. 성공 알림은 기본 5초 뒤 닫히고 오류·권한 문제는 사용자가 닫을 때까지 유지한다. 같은 업무 알림은 안정된 `id`로 최신 내용만 남긴다. 로딩, 쓰기 결과, 일부 실패, 처리 여부 미확정과 복구 동작은 계속 확인할 수 있는 인라인 `CompanyState`로 남긴다. 필드 입력 오류는 토스트만 띄우지 않고 해당 컨트롤의 `aria-invalid`·`aria-describedby`, 바로 아래 오류 문구와 포커스를 함께 제공한다. 앱별 toast DOM·palette·timer 구현을 복제하지 않는다.

동일 화면에서 같은 의미를 요약·상세로 반복할 때도 동일한 tone 계약을 사용한다. 예를 들어 회사 홈의 서비스 사용 가능 개수 요약과 개별 서비스의 사용 가능 표시는 모두 success이며, 요약만을 위한 별도 점·팔레트를 만들지 않는다.

변경 비교 요약도 읽기 전용 상태로 취급한다. 수정은 warning, 추가는 success, 삭제는 danger `cw-state-pill`을 사용하며 앱은 비교 판정·개수·이동 동작만 소유한다. 비교 전용 클래스에 배경·글자색·크기·테마를 다시 만들지 않는다.

업무 도메인의 상태도 같은 원칙을 따른다. 예를 들어 일정 버전 기록은 안정·해결 완료를 success, 불안정·롤백·건너뜀을 danger, 미기재를 neutral로 표시한다. 앱은 상태 판정과 카드 안 배치만 소유하고 상태별 전용 pill skin을 만들지 않는다.

단순 개수는 성공·경고 같은 상태가 아니므로 state pill의 tone으로 표현하지 않는다. 제목과 함께 표시하는 수량은 `cw-count-badge`가 숫자 크기·정렬·테마를 소유하고, 앱은 문맥과 주변 간격만 소유한다.

`tooling/check-ui-primitives.mjs`는 서비스 계약에 등록한 UI 소스 루트를 테마 검사와 공유한다. HTML/Razor, JS 템플릿과 JSX의 literal native 태그, literal `createElement` 호출, 전역 confirm/prompt/alert를 검사한다. 동적 클래스는 증명 가능한 **공백으로 끝난 literal prefix**만 인정한다. 조건식의 한쪽 분기나 `data-class`·다른 속성에 적힌 공통 클래스는 인정하지 않는다.

공통 생성기의 정확한 출력만 앱 중복 검사에서 제외하고 출력 바이트가 원본 소유자와 동일한지 대조한다. 임의 `generated/` 폴더, 파일명, 주석은 예외가 아니다. **버전 쿼리만 갱신하는 HTML/Razor의 본문은 생성 UI가 아니므로 계속 검사한다.** 지정 vendor 경계와 conventional `.test.*`/`.spec.*`/`__tests__/` 파일은 앱 UI 집계에서 제외한다. 테스트 파일을 실제 앱 UI로 가져오는 것을 허용한다는 의미가 아니다.

정적 검사 한계:

- 임의로 평가되는 문자열/태그명, 별칭·computed factory 호출과 모든 JSX/Razor 문법을 해석하는 AST 검사기가 아니다. 인접한 동적 JSX, literal 코드 예제는 추가 검토가 필요하다.
- hidden/checkbox/radio/file는 일반 텍스트 필드 검사 대상이 아니다. 특히 checkbox/file를 `cw-form-control`로 허위 전환하지 않는다. 단일 checkbox는 `cw-check-control`/`cw-checkbox`를 사용하되 현재는 이관한 소비자 계약이 누락을 강제하며, 검색형 다중 선택은 `cw-choice-group`이 별도로 소유한다. range는 별도 `native-range` 규칙으로 `cw-range`를 강제하며 값 범위·출력·업무 저장은 소비자 계약으로 검증한다.
- DOM으로 즉시 생성한 hidden 입력은 비시각적 전송 용도로만 예외다. 일반 컨트롤은 공통 컴포넌트 또는 공통 클래스의 정적 템플릿으로 연결한다.
- 필드 wrapper/라벨 접근성, 임의 개별 CSS, 확인창의 실제 연결/해제, 폼 전송·전체 응답·늦은 응답 보호를 이 검사 하나로 증명하지 않는다. 해당 계약/서버/브라우저 회귀 및 실제 화면 검증을 함께 수행한다.
- 저장소 정책과 검사 자체를 바꾸면 강제 수준도 바뀐다. 원격 필수 CI/보호 설정 없이 로컬 검사를 원격 병합·배포 차단 완료로 보고하지 않는다.

## 이관 부채: 늘릴 수 있는 허용 목록이 아님

`ui-primitive-debt.json`의 최초 기준은 `91b9dc29d48d29eb7d3e5b5ad66f2834d9a32c7c`다. 기존 123개 앱 소스를 조사하여 47개 파일의 477회 표기/호출(439개 고유 서명)을 기록했다. 화면에서 서로 다른 477개 기능이 고장 났다는 뜻은 아니다. 이미 공통 폼/저장 계약에 연결됐어도 버튼 스타일 등이 아직 native일 수 있다.

105차 이관에서 기록 부채는 0이 되었고 목록은 `sealed: true`로 봉인했다. 이후 `sealed` 해제나 `files`/`entries` 복원은 실제 앱 코드 위반이 없어도 검사 실패다. 새 예외를 등록하는 방식으로 공통 primitive 사용을 우회하지 않는다.

각 항목은 파일 경로·검사 규칙·공백을 정규화한 opening tag/호출의 SHA-256·개수를 고정한다. 파일별 사유와 제거 조건도 필수다. 따라서 새 파일로 복사, 기존 파일에 같은 버튼 하나 추가, 기존 raw 태그를 다른 개별 스타일로 변경하면 실패한다. 단순 줄 이동/버튼 본문 문구 변경은 새 primitive로 세지 않는다.

새 코드가 실패했다고 이 목록의 경로·서명·개수를 늘리지 않는다. 최초 기록 이후 자동 수락/기준 재생성 명령은 제공하지 않는다. 기존 기능을 공통 UI로 전환하고 실제 동작을 검증한 뒤 감소분만 정리한다. 기존 동기식 초안 이탈 확인은 Promise 확인창으로 단순 치환하면 탐색/취소 의미가 깨지므로 별도 수명주기 전환이 필요하다. CS의 명시적 비동기 상세 전환과 아직 남은 일정 닫기/라우팅 경계는 `draft-transitions.md`를 따른다.

```text
npm run check:primitives       # 기존 부채와 현재 코드를 대조
npm run ui:debt                # 위치·종류·코드 표기의 읽기 전용 JSON
npm run ui:debt:prune          # 이미 제거된 서명/개수/파일 정책만 감소
npm run check                 # 생성 바이트·구조·테마·primitive·CI 정책·회귀
```

prune는 새 위반이 하나라도 남으면 파일을 쓰지 않는다. 감소와 신규 위반이 동시에 있는 경우에도 부분 갱신하지 않는다. 이전 UI가 없어졌는데 부채만 남으면 일반 검사도 실패하여 정리를 요구한다. 정책 확장이 꼭 필요한 경우 검사 범위 변경으로 별도 검토해야 하며, 작업을 통과시키기 위한 예외 추가는 금지한다.
