# 통계 조회 UI 공통화

대시보드·게임 결과·빌드/보스 목록과 상세의 입력/버튼/표는 같은 공통 primitive를 사용한다. 게임 이미지·차트·집계 계산·서버 저장소·조회/갱신 API와 권한은 통계 앱 소유이며 이 단계에서 변경하지 않는다.

- 기간/날짜/버전/게임 모드/최소 단계, 결과/빌드/보스 세부 검색은 `cw-form-field`와 `cw-form-control`이다. native type/min/max/step과 기존 조회 지연을 유지한다. `afterFirstMiddleBoss`, `combinationNodes`, `bossLinked`는 `cw-check-control`/`cw-checkbox`이며 공통 18px 입력과 선택·hover·focus·disabled 테마를 사용한다. 모바일 필터의 일반 입력 100% 폭 보정은 checkbox에 적용하지 않는다.
- 기간과 분석 종류는 실제 선택값을 `aria-pressed`에 반영하고 공통 선택 색상을 사용한다. 분석 종류는 별도의 tabpanel이 아니라 같은 표의 분류 필터이므로 group/toggle button 의미를 사용한다.
- 정렬은 기존 header `aria-sort`와 방향을 보존한다. 활성 정렬만 공통 primary, 나머지는 quiet 버튼이다. 설명 버튼은 compact/icon 및 키보드 포커스를 사용하고 기존 설명 내용을 유지한다.
- 정적 버튼과 JS에서 만드는 카탈로그·캐릭터 장비·완성 조합 버튼 모두 `cw-button`이다. 복합 내용은 공통 content layout과 앱별 grid 열을 결합한다. 회사 직원/프로젝트 선택기로 게임 캐릭터를 잘못 대체하지 않는다.
- 모든 통계 표는 `cw-data-table`/`cw-table-scroll`이며 문서 폭이 아니라 표 내부에서 가로 스크롤한다. 표의 읽기 전용 값·정렬 키·상세 URL/브라우저 이력은 바꾸지 않는다. 기존 라이트모드의 th 배경과 td hover가 공통 색상을 덮지 않게 한다.
- 증감/표본 수준의 기존 positive·negative·warning·good·low·medium 의미는 공통 표의 `data-tone="success|danger|warning"`으로 연결한다. 값·정렬 class·문자열 원문은 그대로다. 키보드로 상세 행에 진입하면 공통 표의 focus-visible 색/윤곽을 사용한다.
- 조합 노드 옵션은 완성 조합에서만 표시한다. 앱의 `check-label`은 정렬과 조건부 hidden만 소유하며 공통 label display·간격·배경·테두리·색·입력 크기를 덮지 않는다.
- 상단 집계 상태는 `cw-state-pill` 하나를 사용한다. 초기 확인은 `neutral`, 데모·계정 확인 필요는 `warning`, 집계 중은 `info`, 완료는 `success`, 오류는 `danger`다. 통계 앱은 문구와 최소 폭만 소유하며 별도 live class·색상·크기 skin을 만들지 않는다.
- 모바일 상단에서는 상태를 숨기지 않는다. 작업 영역이 한 줄을 고집해 문서 폭을 늘리지 않도록 줄바꿈하고, 긴 집계 시각 pill은 가용 폭 안에서 말줄임한다.

`statistics-shell.spec.mjs`는 실제 통계 문서·CSS·JS와 공통 생성 자산을 로드하고 합성 통계 API만 연결한다. 46개 검사는 여섯 경로·세 폭·두 테마·역할·필터/이력/상세 새로고침과 두 폭/테마의 실제 색 토큰·선택/정렬/Tab 포커스·native 숫자 유효성·공통 클래스·동적 버튼·옵션 표시·문서 넘침을 확인한다. 세 checkbox는 공통 class·18px 크기·선택 배경과 조건부 표시를 함께 검사한다. 앱 단위 69개는 실제 서버/worker 접수 경계와 표 의미 색 매핑/문자열 원문 보존을 포함한다. 직접 화면 확인과 자동 검사를 구분하여 이관 기록에 남긴다.

이관 부채의 통계 HTML 94회 표기는 감소 전용 prune로 제거한다. 통계 갱신은 `statistics-refresh.md`에 따라 공통 확인·상태·작업 세션 및 실제 서버/worker의 계정·역할/대상·revision 대조와 전체 접수 응답에 연결했다. native confirm 한 회의 부채도 제거했다. 현재 단순 CSS 전환을 갱신 요청 수명주기나 모든 상태 안내의 공통화 완료로 보고하지 않는다. 임의 dynamic factory를 정적 태그 검사 하나로 완전히 검증한다고도 주장하지 않는다.
