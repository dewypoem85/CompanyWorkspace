# CS Steam 환불 조회 계약

Steam 거래를 확인하는 configuration과 transaction query는 읽기다. 실제 금전 상태를 바꾸는 refund 요청과 분리하며, 환불 성공·실패·불확실 결과를 조회 결과로 추론하거나 자동 재실행하지 않는다.

- `CompanyReadSession`의 `steam-config` 채널은 최초 설정과 환불 확인 직전 configuration을 읽고, `steam-query` 채널은 최초 transaction query·확인 직전 재검증·환불 후 상태 확인·수동 복구를 관찰한다. `steam-history` 채널은 Steam ID 단독 검색 시 서버의 증분 거래 보고서 색인 결과를 읽는다.
- configuration과 단건 transaction query는 45초, 최초 전체 보고서 동기화가 포함될 수 있는 Steam ID history는 120초 관찰 제한과 최신 ticket 판정을 사용한다. 새 화면 작업, 계정 범위 변경과 비지속 pagehide는 읽기를 취소하며 취소를 무시한 늦은 JSON body는 거래·설정·내역·환불 가능 상태에 반영하지 않는다.
- 모든 요청은 한 same-origin checked JSON transport를 사용하고 브라우저 캐시와 자동 redirect를 거부한다. configuration은 `validateSteamConfig`, transaction query는 요청 Order/Steam ID를 포함한 `validateSteamQuery`, Steam ID history는 해당 Steam ID만 포함하는 `validateSteamHistory`를 통과해야 한다.
- 서버는 PlayFab 라이브 `SteamMicroTxnProductsJson`을 짧게 캐시해 Steam Item ID에 상품명·상품 키·설명을 연결한다. 카탈로그를 읽지 못하거나 ID가 없더라도 거래 조회는 막지 않고 미등록 상품과 원래 Item ID를 표시한다. 이 표시용 메타데이터는 환불 전 거래 signature에 포함하지 않는다.
- Steam ID history의 각 행은 상품 요약을 바로 표시하고 공통 `CompanyDisclosure`로 같은 표 안의 주문·상품 상세를 연다. 상세 보기는 입력값을 바꾸거나 transaction query를 추가 실행하지 않는다. 펼친 상세의 별도 환불 검토 버튼을 사용한 경우에만 해당 주문과 Steam ID를 입력하고 transaction query로 다시 검증한 뒤 기존 환불 화면으로 이동한다.
- 실제 refund만 별도 변경 허용 목록과 기존 operation 수명주기·CSRF·45초 관찰을 사용한다. 실행 전에는 설정과 거래 전체 signature를 다시 확인하고, 응답은 `validateSteamRefund`로 검증하며 미확정 결과는 같은 주문의 반복 환불을 잠근다.
- 환불 후 query 실패는 확인된 환불 성공을 실패로 바꾸지 않는다. 사용자의 명시적인 상태 재확인은 읽기만 수행하며 refund를 다시 보내지 않는다.

구조 검사는 세 읽기 채널, 해제·최신 판정, 읽기/변경 허용 목록과 단일 transport를 고정한다. 브라우저 회귀는 큰 정수 ID, Order ID·Steam ID 단독 검색, 초안 확인, 설정/거래 변경, timeout, 권한·계정 변경, 늦은 transaction query와 refund 응답을 합성 Steam 서버로 검사한다.
