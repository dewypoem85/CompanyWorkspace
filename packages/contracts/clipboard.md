# 공통 텍스트 복사

업무 페이지는 클립보드용 textarea를 직접 만들거나 `navigator.clipboard`/`execCommand`를 직접 호출하지 않고 생성 자산의 `CompanyClipboard.copyText(value)`를 사용한다.

- 지원 브라우저에서는 `navigator.clipboard.writeText`를 우선 사용한다. API가 존재하지만 거부한 경우 성공으로 간주하거나 자동 재시도하지 않는다.
- 구형 브라우저 fallback textarea는 `packages/workspace-ui/src/clipboard.js` 한 곳만 소유한다. 화면과 접근성 트리에 노출하지 않고 실행 후 성공·실패 모두에서 제거한다.
- fallback은 기존 포커스와 문서 선택 범위를 복원한다. 복사할 값은 문자열로 변환하되 JSON을 parse/stringify하지 않아 64비트 정수 원문을 보존한다.
- 복사 성공 안내와 업무 요청 잠금은 각 소비자가 소유한다. 클립보드 성공은 서버 쓰기나 업무 처리 성공을 의미하지 않는다.

`clipboard.test.mjs`는 최신 API, fallback, 포커스·선택 복원과 실패 정리를 검사한다. 실제 CS 브라우저 검사는 JSON 원문, 두 복사 경로, 임시 요소 제거와 서버 쓰기 없음까지 확인한다.
