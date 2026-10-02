# 팀 일정 버전 기록·개인 TODO 컨트롤

`Releases.tsx`와 `PersonalTodos.tsx`의 일반 입력/작업 버튼은 공통 primitive를 사용한다. 기존 업무 hook·API·저장/충돌 응답과 실행 의도를 UI 스타일 전환에서 변경하지 않는다.

- 버전 기록의 프로젝트 선택, 번호/출시일/패치·조치/상태/연결 버전은 `cw-form-field`와 `cw-form-control`을 사용한다. 편집 양식은 공통 그리드의 한 열 배치이며 기본/마이너 번호 두 칸만 도메인 배치다. 고정 버전 번호의 readOnly, 출시일 미기재, 상태별 필수 입력·허용 옵션/길이/범위는 유지한다.
- 일반 작업·더 보기·상세·편집창 닫기·저장은 `cw-button`을 사용한다. 버전 셀은 compact, 상세 카드만 content 배치를 사용한다. 미해결/건너뜀·롤백은 기존 판단 조건을 공통 danger 변형/표의 data-tone으로 연결한다. 해결된 기록을 계속 위험 버튼으로 표시하지 않는다.
- 버전 표는 `cw-data-table`과 이름/tabIndex가 있는 `cw-table-scroll`로 연결한다. 열 너비와 긴 본문 미리보기는 앱 책임이며 펼친 본문은 기존 `cw-table-detail` 폭을 유지한다. 표 가로 이동이 문서 전체를 넓히지 않도록 실제 키보드 스크롤과 viewport를 검사한다.
- 개인 TODO의 신규/기존 수정 입력은 모두 보이는 라벨을 제공한다. 작은 행 작업은 compact, 삭제는 danger, 할 일/보관함은 실제 aria-selected와 공통 선택 색을 사용한다. 입력/버튼 크기·선택·비활성·포커스·hover CSS를 개별 복제하지 않는다. 저장 수명주기는 `schedule-todo-writes.md`를 따른다.
- TODO 완료 checkbox는 `cw-check-control`/`cw-checkbox`의 42px 클릭 영역·18px 입력과 선택·focus·disabled 테마를 사용한다. 완료 API, 드래그/완료 행, 버전 상태 badge·카드 내부 배치/원문은 기존 도메인 표현으로 남으며 checkbox를 텍스트 필드로 허위 전환하지 않는다. 버전 편집 dialog는 `owned-modals.md`의 공통 drawer/hook에 연결한다. 기존 동기 초안 이탈 확인은 `edit.canLeave()`에 유지하며 새 Promise 확인창으로 치환하지 않는다.
- 기존 앱 다크 hover 규칙은 `:where(:not(.cw-button))`로 공통 버튼에서 제외한다. 제외 조건 때문에 선택자 우선순위를 높여 공통 상태/선택기의 버튼 스타일을 새로 덮어쓰지 않는다. 나머지 미전환 팀 일정 UI에 필요한 옛 스타일은 아직 남는다.

## 동작과 검증 경계

버전 목록/이력의 generated disclosure·응답 검증과 `useReleaseEditor`의 기준 버전/명시적 비교·저장/후속 읽기를 유지한다. TODO는 `usePersonalTodos`의 계정 범위·정확한 행/순서·확인·자동 보관·초안·미확정 처리 경계를 유지하고, 목록 GET의 수명주기는 `schedule-todo-reads.md`를 따른다. CSS 전환이 서버 인가, 업무 DB, 원자적 동시성 또는 멱등성을 새로 제공하는 것은 아니다.

`support/schedule-controls.mjs`는 이관한 두 루트의 실제 필드 라벨/44px 크기·계산 색과 버튼 compact/selected/disabled/hover를 검사한다. `schedule-shell.spec.mjs`에서 실제 빌드된 React와 공통 자산으로 PC/모바일·두 테마의 원래 조회/저장/오류/충돌·미확정·계정 변경/늦은 응답 시나리오를 함께 실행한다. 합성 HTTP만 사용하고 운영 데이터를 변경하지 않는다.
