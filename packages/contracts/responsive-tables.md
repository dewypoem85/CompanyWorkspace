# 공통 반응형 업무 표

일반 업무 목록은 `cw-data-table`을 사용한다. PC에서는 비교 가능한 표를 유지하고 모바일에서 레코드별 카드가 필요하면 `data-layout="cards"`를 명시한다. 달력과 상세 펼치기 표를 자동으로 카드로 바꾸지 않는다.

## 마크업과 소유권

```html
<div class="cw-table-scroll" tabindex="0" role="region" aria-label="직원 연결 현황">
  <table class="cw-data-table" data-layout="cards" role="table">
    <thead><tr><th scope="col">직원</th></tr></thead>
    <tbody><tr>
      <td data-label="직원"><div class="cw-table-value">직원 표시</div></td>
    </tr></tbody>
  </table>
</div>
```

- 표의 실제 열 제목과 각 셀의 `data-label`은 서버/렌더러가 함께 제공한다. 모바일 레이블을 만들기 위해 JavaScript로 DOM을 재구성하지 않는다.
- 각 셀의 원래 값·프로필·폼 전체를 하나의 `cw-table-value`에 둔다. 모바일의 레이블과 값은 같은 grid 행 높이를 사용하여 긴 제목도 다음 셀을 침범하지 않는다. 내부 폼·CSRF·hidden 기준값과 이벤트 연결은 변경하지 않는다.
- 값이 없는 열 제목에는 빈 레이블을 사용한다. 전체 열을 차지하는 빈 결과 셀은 기존 `colspan`과 `data-label=""`을 함께 유지한다.
- 첫 셀이 행 제목인 환경/보안 현황은 `data-layout="key-value"`와 `th scope="row"`를 사용한다. 이 변형은 모바일에서 실제 행 제목을 값 위에 표시하며 가상 열 제목이나 값 wrapper를 요구하지 않는다.
- 공통 CSS가 표·셀·스크롤 프레임·모바일 카드·포커스·테마와 `aria-current="true"` 행 강조를 소유한다. 앱은 업무 열/너비/긴 메모의 읽기 면적을 소유한다.
- 720px 이하에서 cards/key-value가 전환된다. PC의 큰 표는 프레임 내부에서 스크롤하며 문서 전체 너비를 늘리지 않는다.
- cards의 실제 thead는 모바일에서도 접근성 트리에 유지한다. 명시적 table role과 scope를 보존한다. 브라우저 구조 검사는 모든 스크린리더의 실제 낭독 검증을 대신하지 않는다.

## 현재 Leave 소비자

신청 내역, 승인/취소 승인 대기열과 최근 신청, 직원 연결/잔여 현황, 개인/관리자 사용 통계, 보안 현황이 이 변형을 사용한다. 승인 폼의 일반 사유 입력·작업 버튼도 공통 native primitive를 사용한다.

Leave의 `leave-record-tables.css`와 `approval-forms.css`에는 업무 너비·배치만 둔다. `mobile-tables.js`의 이전 레이블 주입은 미전환 감사 표에 남으며 같은 파일의 달력 GET 폼 동기화도 필요하므로 파일 자체를 삭제하지 않는다. 달력·감사 상세 표와 이동 링크는 이 단계의 전환 범위가 아니다.

## 자동 검사와 실제 검증

`check-ui-primitives.mjs`는 literal opt-in 표의 table role, 실제 th와 scope, cards의 레이블 및 첫 value wrapper를 검사한다. wrapper 누락·잘못된 scope·레이블 누락·미지원 변형은 변이 검사로 확인한다. 이 변형 안의 literal 중첩 표는 거부하여 내부 표의 제목을 빌려 통과하지 못하게 한다. 이는 임의 동적 표를 분석하는 AST 검사나 레이블 의미의 완전한 검증이 아니다.

`leave-shell.spec.mjs`의 실제 Razor 시나리오는 셀/열 제목 대응, wrapper, 모바일 레이블 높이와 문서 폭을 검사한다. 승인/직원 취소/복수 초안의 기존 브라우저 시나리오로 원래 작업 수명주기를 함께 확인한다. 공통 CSS 변경은 여섯 앱 전체 브라우저 회귀 대상이다. 실제 캡처 확인과 종료된 명령 결과는 이관 기록에 별도로 남긴다.

`leave-record-tables-native.spec.mjs`는 JavaScript를 비활성화한 실제 Razor/CSS에서 table/header 역할·전송값·모바일 카드와 key-value 배치를 검사한다. runtime 테마 해석기는 JavaScript이므로 이 격리 CSS 검사에서는 html에 테마값을 명시한다. 기본 native 문서의 시스템 테마 자동 선택을 증명하는 검사가 아니다. 긴 합성 열 제목을 넣어 제목 높이와 다음 셀의 경계가 겹치지 않는지도 확인한다. 실제 스크린리더 낭독이나 운영 저장 검사가 아니다.
