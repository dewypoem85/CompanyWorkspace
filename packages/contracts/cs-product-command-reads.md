# CS 상품 명령 조회 계약

상품 지급·회수 화면의 configuration, preview와 lookup은 읽기다. 실제 명령을 등록하는 execute와 대기 명령을 제거하는 delete 요청과 분리하며, 읽기 실패를 이유로 쓰기를 자동 재전송하지 않는다.

- `CompanyReadSession`의 `product-bootstrap` 채널은 회사/PlayFab 설정과 실행 직전 configuration을 읽고, `product-preview`는 기존 명령 및 병합 결과 preview를, `product-lookup`은 현재 지급·회수 명령 lookup과 삭제 후 상태 확인을 관찰한다.
- 세 채널은 45초 관찰 제한과 최신 ticket 판정을 사용한다. 새 화면 작업, 계정 범위 변경과 비지속 pagehide는 읽기를 취소하며 취소를 무시한 늦은 JSON body는 설정·미리보기·명령 목록에 반영하지 않는다.
- 모든 요청은 하나의 same-origin checked JSON transport를 사용하고 캐시와 자동 redirect를 거부한다. configuration, preview, lookup은 각각 현재 계정·환경·UID·요청 ID·DataVersion을 포함한 도메인 validator를 통과한 뒤에만 표시한다.
- execute와 delete만 별도 변경 허용 목록과 기존 operation·CSRF·45초 관찰 경계를 사용한다. Dry Run execute도 서버가 발급한 미리보기와 요청 ID를 소비하는 명령 작업이므로 읽기 세션에 넣지 않는다.
- 실행 전에는 configuration과 입력·미리보기 만료를 다시 확인한다. 미확정 execute/delete는 추가 쓰기와 새 요청 ID 발급을 잠그며, 삭제 후 lookup 실패는 확인된 삭제를 실패로 바꾸거나 delete를 반복하지 않고 사용자의 명시적인 lookup만 허용한다.

구조 검사는 세 읽기 채널, 해제·최신 판정, 읽기/변경 허용 목록과 단일 transport를 고정한다. 브라우저 회귀는 라이브/테스트, Dry Run, 부분 실패·재시도, 병합·스냅샷 변경, timeout, 권한·계정 변경과 늦은 preview/lookup/execute 응답을 합성 PlayFab 서버로 검사한다.
