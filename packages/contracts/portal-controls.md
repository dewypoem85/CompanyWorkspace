# Portal 계정·조직 관리 컨트롤

신규 계정과 기존 직원 수정은 `account-fields.json`에서 생성된 필드 정의 및 동일 `_AccountField.cshtml` 렌더러를 사용한다. 일반 입력·표·작업 버튼의 표현도 공통 primitive를 소비한다. 등록/수정별 필드를 따로 복제하거나 한쪽에만 비공개·프로젝트 등의 설정을 추가하지 않는다.

- 이름·이메일·유형·상태·역할·부서·입사일은 `cw-form-field`/`cw-form-control`로 표시한다. `name`, prefix, 원래 값, required/maxlength/disabled 및 회사 마스터 전용 역할 정책은 보존한다. 공용 계정으로 바꾼 동안 비활성인 업무 필드의 초안을 지우지 않는다.
- 신규/기존 상세는 같은 `cw-form-fields`의 2열/모바일 1열 구조를 사용한다. 참여 프로젝트·비공개·권한 그룹은 전체 폭을 사용한다. 비공개 직원과 신규 계정의 권한 카드는 `cw-check-control`/`cw-checkbox`의 크기·선택·focus·disabled 테마를 사용한다. 입력 높이와 checkbox skin을 개별 label/input 규칙으로 다시 만들거나 테마별 배경을 복제하지 않는다.
- 계정·프로젝트·직원 검색에 표시 라벨을 제공한다. 엔티티 선택기는 기존 공통 프로필/아이콘·초성 검색·서버 필터링 목록을 유지하며 일반 입력 클래스가 선택기 계약을 대신하지 않는다.
- 권한 표는 `cw-data-table`, 이름과 tabindex가 있는 `cw-table-scroll`을 사용한다. 넓은 요약 행은 표 내부에서 스크롤하고 펼친 직원 상세는 공통 `cw-table-detail`의 모바일 폭을 유지한다. compact 권한은 native checkbox 의미를 보존한 `cw-switch-control`/`cw-switch`/`cw-switch-track`을 사용하고 앱은 표 열과 허용·차단·전체 문구만 소유한다. 상세 DOM과 switch skin을 복제하지 않는다.
- 수정할 수 없는 마스터 행의 계정 유형과 기본/전체 권한은 info `cw-state-pill`, 활성 상태는 success, 비활성 상태는 neutral tone을 사용한다. 편집 행을 공용 계정으로 바꿀 때의 연차 제외 결과도 neutral pill이다. Portal은 실제 계정 상태 판정과 공용 계정 여부에 따른 표시/숨김만 소유하며 pill의 padding·글자 크기·배경·글자색을 다시 정의하지 않는다.
- 일괄 저장·되돌리기·상세·검색 결과 권한 전환과 부서/프로젝트 저장은 `cw-button`을 사용한다. primary/quiet/compact는 공통 변형이다. 계정별 행 상태/열 구조·권한 스위치의 업무 의미는 앱이 유지한다.
- 조직의 이름/색상/직원 검색도 공통 필드다. 비공개/보관 bool Razor 입력은 `cw-check-control`/`cw-checkbox`를 사용하고 실제 `type="checkbox"` 의미를 유지한다. 참여 직원·프로젝트의 검색형 다중 선택은 정적 `cw-choice-group`과 공통 entity choice 소유권을 사용하며 단일 checkbox 카드로 가장하지 않는다. 프로젝트 아이콘의 저장/삭제 버튼은 공통 변형을 사용하되 이미지 준비/확인/저장과 조직 폼은 기존 별도 트랜잭션이다.

## 검증과 남은 경계

실제 Razor 응답의 신규/기존 모든 필드 존재와 제출값·비공개 변경·되돌리기·공용 전환·관리자/마스터를 검사한다. 브라우저 helper는 계산된 light/dark 색·라벨·최소 입력 44px/글자 크기·버튼 비활성/변형을 검증한다. 읽기 전용 결과의 info 색과 공용 전환 시 neutral 연차 제외 표시도 실제 계산 색 및 숨김 전환으로 확인한다. 모바일 표의 키보드 진입/가로 이동과 문서 넘침을 별도로 확인한다. 요소 전체 캡처는 고정 헤더나 넓은 표 영역을 포함할 수 있어 실제 viewport 캡처도 확인한다.

기존 공통 계정 저장·충돌 비교·원문 복구·전체 ACK·서버 역할/기준값 검증은 변경하지 않는다. JavaScript가 없는 native 폼 제출도 유지한다. 서버/운영 데이터·SSO·URL을 변경한 단계가 아니다.

기존 직원 표의 compact 권한 switch 표현은 공통화했지만 권한 상속·일괄 저장의 업무 의미는 Portal에 남는다. 링크 버튼과 동적 프로젝트 checkbox의 전체 생명주기는 남은 범위다. 앱 전체 UI 전환 완료로 보고하지 않는다. 공통 CSS/런타임을 변경하면 Portal만이 아니라 여섯 소비 앱을 검증한다.

## 계정 작업 버튼 보완

서비스 진입·통합 알림·개인 설정 버튼은 `account-action-controls.md`의 공통 primitive를 사용한다. 사진 저장/기본 사진 변경/브라우저 알림의 실제 disabled와 공통 전송·확인 연결은 유지하며 `.cw-profile-actions`는 배치만 소유한다. 이동 링크와 file 입력은 별도다.
