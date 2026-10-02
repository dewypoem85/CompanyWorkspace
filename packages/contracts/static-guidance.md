# 정적인 업무 안내

업무 제약·저장 형식·검색 범위 설명에는 공통 `cw-callout`을 사용한다. 정적인 설명은 요청 성공/실패가 아니며 `CompanyState.render`의 대상이 아니다. 이 컴포넌트는 JavaScript 초기화 없이 작성된 제목·본문·inline code를 그대로 표시한다.

```html
<section class="cw-callout" data-tone="warning" role="note">
  <strong>처리 순서</strong>
  <p>게임은 <code>회수 → 지급</code> 순서로 처리합니다.</p>
</section>
```

## 소유권과 의미

- `section`, `role="note"`, 명시적 tone, 직계 `strong` 제목과 `p` 본문을 함께 사용한다. 공통 사이드바의 `aside`와 혼동하지 않는다.
- tone은 `neutral`, `info`, `warning`, `danger`다. 기능 설명에 `success`를 사용해 처리가 이미 성공한 것처럼 보이게 하지 않는다. 위험도는 색만 아니라 제목과 본문으로 설명한다.
- `primitives.css`가 의미 토큰, 제목/본문 대비, padding, 경계선, 줄바꿈을 소유한다. 앱은 카드 간 grid·배치와 업무 문구만 소유한다. 고정된 밝은 글자색이나 앱별 light/dark 반전 스타일을 추가하지 않는다.
- 안내 제목은 14px, 본문과 inline code는 13px 이상으로 표시한다. 공백 없는 긴 문자열도 화면 안에서 줄바꿈하되 원문은 변경하지 않는다.
- `aria-live`, `role="alert"`, `data-workspace-state`를 붙이지 않는다. 실제 로딩·성공·실패·권한 상태는 기존 공통 상태 렌더러와 요청 수명주기를 사용한다. 정적 안내는 실행 확인이나 서버 권한 검증을 대체하지 않는다.
- 현재 소비자는 CS 네 업무 화면의 정적 안내 아홉 개다. 다른 앱의 남은 안내·badge·장식까지 이관 완료한 것은 아니다.

## 검증

`check-ui-primitives.mjs`는 literal `role="note"`/`cw-callout`의 소유자·tone·제목/본문과 live 상태 혼용을 검사한다. 누락/잘못된 형태의 변이 테스트를 유지한다. 이 검사는 HTML parser나 전체 접근성 검사, 임의 클래스 이름을 쓰는 모든 유사 UI의 의미 분석은 아니다.

`cs-shell.spec.mjs`는 실제 HTML/CSS의 320/390/1440px·두 테마에서 아홉 안내의 제목/본문/code 계산 대비(4.5:1 이상), 글자 크기·넘침을 검사한다. 실제 업무 모듈은 별도 CS 업무 회귀로 확인한다.

`callouts-native.spec.mjs`는 JavaScript를 끈 채 네 tone, 320/390/720/1440px, 두 테마, 긴 제목·공백 없는 code·다음 카드와의 경계를 검사한다. 자동 테마 해석기는 JavaScript이므로 이 검사는 선택된 html 테마값을 명시한다. 기본 문서의 자동 테마 해석까지 검증했다고 주장하지 않는다.

공통 CSS 변경이므로 두 React 빌드·Razor fixture 재생성 후 여섯 앱 전체 브라우저 회귀와 실제 캡처 확인을 수행한다. 합성 HTTP/데이터만 사용하며 운영 PlayFab·Azure 요청을 발생시키지 않는다.
