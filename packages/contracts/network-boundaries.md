# 브라우저 네트워크 경계

새 페이지와 업무 컴포넌트는 raw `fetch`를 직접 소유하지 않는다. 공통 읽기/쓰기 세션 또는 계약으로 검토된 앱 transport를 호출하며, 요청의 same-origin·redirect·media type·AbortSignal·현재 계정/대상·전체 응답 검증은 해당 소비자 계약을 따른다.

`network-boundaries.json`은 현재 브라우저 소스의 실제 raw 호출 파일과 개수를 봉인한다. 새 파일의 `fetch`·`XMLHttpRequest`·axios·`sendBeacon` 호출, 기존 파일의 호출 증가, 은퇴한 transport의 정책 잔존은 `check:ui`를 실패시킨다. dot 호출뿐 아니라 computed property, `fetch.call/apply/bind`, 전역 `XMLHttpRequest`와 `Reflect.get`의 알려진 literal 표기도 같은 목록으로 계산한다. 등록은 예외 면제가 아니라 호출을 소유하는 transport와 구체 계약을 지정하는 검토 경계다. 새 페이지 경로를 등록해 검사를 우회하지 않고 먼저 공통 소유자 또는 앱의 단일 transport로 이동한다.

이 검사는 주석을 제외한 정적 literal 호출 표기를 확인한다. 계산된 문자열·eval·런타임 반사나 임의 코드의 보안·응답 의미를 완전히 증명하지 않으므로 각 계약의 구조 변이·단위·서버·브라우저 검사를 유지한다. 서버의 내부 서비스/외부 API 호출, 테스트와 생성 어댑터는 별도 경계이며 브라우저 페이지가 비밀값을 소유해서는 안 된다.
