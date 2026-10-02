# 제공 CSV와 스토어 가격

사용자가 제공한 `resources/pricing-matrix.csv`에서 KOR 소비자가격 하나를 상품 상세에서 바로 선택한다. 별도 가격표, 프리셋 생성, 이름 입력이나 확정 단계는 없다. 상품을 저장할 때 같은 CSV 행의 국가별 소비자가격을 Google의 같은 국가·통화 가격과 Steam의 통화별 대표 국가 가격으로 자동 연결한다. Google·Steam 가격을 직접 추가하거나 수정하는 입력은 제공하지 않는다.

`src/shared/price-markets.ts`는 지원 Google 국가, Steam 통화, Steam 통화별 대표 Apple territory 규칙을 제공한다. 실제 Apple 판매 지역과 통화는 App Store Connect territories API에서 읽고, ISO alpha-3 코드를 Google alpha-2 코드와 국가명으로 연결한다. 두 스토어의 통화가 다르거나 지원 목록에 없으면 제외하며 일반 법정 통화나 환율로 값을 만들어내지 않는다.

- [Google 배포 국가·통화 안내](https://support.google.com/googleplay/android-developer/answer/10532353?hl=en), [가격 변환 응답의 국가·통화](https://developers.google.com/android-publisher/api-ref/rest/v3/monetization/convertRegionPrices)
- [Apple territory의 currency 속성](https://developer.apple.com/documentation/appstoreconnectapi/get-v1-territories), [Apple 가격 통화 자료](https://www.apple.com.cn/newsroom/pdfs/App-Store-Pricing-Update.pdf)
- [Steam 현재 사용 가능한 통화](https://partner.steamgames.com/doc/store/pricing/currencies?l=english) — Live 통화만 포함, 지역별 USD 그룹이나 폐기된 TRY/ARS는 통화 코드로 받지 않음.

등록 파일: `resources/pricing-matrix.csv`. 자료 반영일: 2026-09-15. SHA-256: `b42d36de0bf6f1d4d69c68fd07b164b7757a0b386714dd5b3ca5ea6ce1a4882f`. 가격 범위, 세금, 지원 가격 포인트 및 계정의 판매 가능 여부 검증을 이 파일만으로 대체하지 않는다. 운영 쓰기 활성화에 필요한 기존 계정 검증 절차는 유지한다.

API는 클라이언트에서 가격 지도를 받지 않고 매트릭스 파일 버전과 KOR 가격 ID만 받는다. 서버가 원본 CSV의 같은 행을 다시 검증해 Google·Steam 가격과 내부 버전을 직접 생성한다. 동일한 가격과 매트릭스 버전을 다시 선택하면 기존 내부 버전을 재사용한다. 가격 선택은 스토어에 쓰기를 보내지 않으며 기존 모바일 상품 보호도 유지한다.
