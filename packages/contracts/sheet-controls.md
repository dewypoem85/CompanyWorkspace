# 시트 관리의 공통 컨트롤

시트의 React 본문은 공통 `cw-button`, `cw-form-field`/`cw-form-control`, `cw-data-table`/`cw-table-scroll`, `cw-state-pill`, `WorkspaceState`를 사용한다. native 버튼·검색·select·표의 테마/포커스/비활성 상태를 별도 primary/ghost/danger/search-box CSS로 다시 구현하지 않는다. 공통 코드는 직접 수정한 generated 파일이 아닌 packages 소유자를 통해 변경한다.

- 수식 분석·탭/검색 필터·한국어 원문 비교/상태 필터와 표시 건수 제한은 기존 앱이 소유한다. 필터는 서버 쓰기가 아니므로 native 저장 폼으로 감싸지 않는다. 검색 라벨은 항상 표시하고 좁은 화면에서는 세로로 배치한다. 결과 없음은 공통 empty 안내로 구분한다.
- 상단 Google 연결/데모 상태는 각각 `cw-state-pill`의 success/warning tone을 사용한다. 앱은 연결 문구와 모바일 숨김 여부만 소유하고 점·크기·간격·색·라이트/다크 팔레트를 다시 만들지 않는다. 이 표시가 서버의 실제 쓰기 허용이나 인증 성공을 대신하지 않는다.
- 수식 제거·한국어 갱신은 `sheet-writes.md`의 공통 확인·저장 transport와 정확한 확인 문구·분석/미리보기 ID·대상·전체 실행 영수증을 유지한다. 수식 제거의 읽기 전용 설명창은 열 수 있지만 실제 확인 버튼은 비활성화된다. 서버 쓰기 허용/충돌/스냅샷·복구 정책은 UI 색상으로 대체하지 않는다.
- 긴 표는 이름 있는 키보드 진입 가능 영역 안에서 가로 스크롤한다. 바깥 문서의 overflow를 잘라 문제를 숨기지 않는다. 표 열/내용 배치는 앱이 소유하고 배경/글자/hover/상태 색은 공통 소유다.
- 스냅샷의 `기록 정보`는 목록 API에 이미 포함된 전체 기록 ID·작업 종류·문서/분석 ID·생성 시각·셀 수만 표시한다. React generated `useWorkspaceDisclosure`가 공통 `CompanyDisclosure`에 연결하고 한 번에 한 행을 연다. 본문은 초기 `hidden`으로 유지하며 이후 hidden/ARIA/열림 상태를 React가 중복 제어하지 않는다. 클릭·Enter/Space·화면 재진입 모두 같은 연결을 사용한다.
- 이 펼치기는 셀별 수식/원문 조회, 스냅샷 복원 또는 새 API 요청을 수행하지 않는다. 기존의 무동작 상세 버튼을 기록 정보로 명확히 바꾼 것이며 아직 구현되지 않은 복구 편집기를 완료한 것으로 보고하지 않는다.

검증은 시트 타입/단위 검사·실제 배포 빌드·격리 실행 검사와 `tooling/browser-tests/sheet-shell.spec.mjs`에서 수행한다. 실제 React 번들/공통 자산, 합성 시트 API로 세 화면의 PC/모바일·두 테마, Google/데모 tone과 계산 색, 검색/선택/빈 결과·상태 대비·확인 취소/권한 제한·키보드 표 이동·단일 펼치기와 긴 ID를 검사한다. 운영 Google Sheets는 변경하지 않는다.

앱 초기 분석/비교/스냅샷의 응답 검증과 계정 변경 후 본문 제거는 `sheet-reads.md`를 따른다. 저장 후 후속 읽기도 `sheet-writes.md`의 공통 read session을 사용한다. 서버 actor/revision 계약, 레거시 장식/셸 CSS 정리, 셀별 스냅샷 상세·릴리스 업무는 별도 남은 작업이다. primitive 예외 감소를 해당 동작의 완료 증거로 사용하지 않는다.
