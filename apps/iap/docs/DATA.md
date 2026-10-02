# 프로젝트·최소 시트·웹 설정

## 프로젝트

회사 포털의 프로젝트 ID·이름을 사용한다. `프로젝트 · 연결`에서 공통 목록 중 하나를 선택한다. 신규 IAP 연결은 `portalProjectId`에 묶이며 같은 프로젝트를 중복 연결할 수 없다. 이름은 포털 목록에서 읽어 표시한다. 기존 `gameId`는 상품·작업·Unity 연결의 내부 키이므로 변경하지 않고 포털 프로젝트 ID를 별도 연결한다. 이미 연결한 프로젝트를 다른 프로젝트로 바꾸는 기능은 없다.

포털은 기존 세션 검증 API의 `?include=projects`에서 인증된 IAP 사용자가 볼 수 있는 프로젝트 목록만 반환한다. 포털 변경을 함께 배포해야 운영에서 목록을 조회할 수 있다. 읽기 실패를 빈 목록이나 임의 프로젝트 생성으로 대체하지 않는다. 로컬 데모의 프로젝트 ID `1`은 가상 값이며 실제 포털 ID로 이관하지 않는다.

## 시트 규격

프로젝트마다 파일 하나, 모든 프로젝트에 같은 `Products` 탭과 다음 5개 헤더를 사용한다. [빈 입력 템플릿](templates/Products.csv).

| 필드 | 의미 |
|---|---|
| productKey | 필수. 프로젝트 내 고유 결제 키 |
| name | 필수. 시트 내부 식별용 이름. 최초 웹 초안의 이름으로만 사용 |
| googleId | Google 사용 시 실제 상품 ID |
| appleId | Apple 사용 시 실제 상품 ID |
| steamId | Steam 사용 시 양의 uint32 ID, 텍스트로 보관 |

유형·가격·설명·번역·게임 전용 필드는 시트에 두지 않는다. ID는 최초 사용 후 변경·삭제할 수 없다. 빈 행은 무시하고 중복 ID와 헤더 밖 데이터는 거부한다. 시트에서 빠진 상품은 웹에 남기고 업로드에서 제외한다.

사용자가 지정한 [던전슬래셔 시트](https://docs.google.com/spreadsheets/d/17xLm2qAiGRcrkYRtMoeVC0PxysDg1Y5DAXLuf79tLcc/edit)는 `Products` 5개 열과 공통 작성가이드로 변경했다. 기존 양식은 숨김 백업으로 보존했다. 실제 상품 행은 비어 있다. 서버는 `Products`만 읽으며 시트에 쓰지 않는다. 이전 11개 열 양식은 조용히 버리지 않고 오류로 안내한다. 기존 내용은 JSON으로 먼저 초기 이관하고, 시트 백업 후 5개 열로 바꾼다.

## 웹 설정의 소유권

상품 상세에서 기본 한국어 상품명·설명, 번역 이름·설명, 상품 유형과 제공 CSV의 가격을 설정한다. 웹 데이터베이스가 이 내용의 원본이다. 단순 조회 캐시가 아니다. 저장할 때 불변 스냅샷과 새 revision을 만들며 오래된 화면의 저장을 거부한다. 웹에서 편집한 내용은 시트 및 초기 이관 JSON 재가져오기로 덮어쓰지 않는다. 시트 `name`은 `sourceName`으로 갱신하고 판매용 이름은 보존한다.

상품 목록은 Google Play·App Store·Steam 실제 조회 결과를 `업로드 필요`, `일부 플랫폼 업로드`, `업로드 완료`, `상태 확인 필요`로 나눈다. 세 플랫폼 모두 존재할 때만 완료로 표시하고, 권한·연결·응답 실패는 미등록으로 추정하지 않는다. Steam 전체 PlayFab 카탈로그는 상태 조회 한 번에 읽어 각 상품 ID를 찾는다. 사용자가 숨긴 상품은 `product_visibility` 웹 설정으로만 제외하며 시트, 카탈로그 snapshot, 스토어 상품, 업로드 이력은 변경하지 않는다.

상품 목록에 들어오면 Google Play, App Store, Steam의 전체 상품 목록을 스토어별로 한 번씩 자동 조회하고, 웹 상품의 스토어 ID와 로컬에서 대조해 플랫폼 상태를 채운다. 상품 수만큼 원격 API를 반복 호출하지 않는다. 응답 전에는 `확인 중`, 연결 정보가 없는 스토어는 `미연결`, 실제 조회 오류만 `확인 실패`로 표시한다.

`스토어 상품 확인`은 같은 등록 상태를 수동으로 새로 고치면서 Google 최신·기존 일회성 상품 목록, Apple 앱의 IAP 목록과 번역, Steam/PlayFab 전체 카탈로그를 읽어 10분짜리 불변 조회 스냅샷을 만든다. Apple 목록 응답은 상품 관계에 있는 번역 ID와 포함된 번역 객체를 연결해 추가 상품별 API 호출 없이 읽는다. App Store 현재 가격은 별도 일정 API를 사용하므로 결과 화면의 `App Store 현재 가격 전체 읽기`에서 가격이 비어 있는 모든 Apple 상품을 순차 조회한다. 개별 실패는 다른 상품 조회를 중단하지 않으며 실패한 상품만 다시 시도할 수 있다. 스토어에만 있는 상품은 새 웹 상품 또는 기존 상품의 빈 스토어 ID 연결 대상으로 표시한다. 웹 내용이 비어 있는 상품은 Google Play 번역을 우선 사용하고 없는 언어를 App Store 번역으로 보완한다. 이미 설정한 웹 내용은 자동으로 덮어쓰지 않으며 상품 편집기에서 스토어별 번역을 명시적으로 다시 불러올 수 있다. ID 충돌은 저장을 거부한다. 조회와 웹 저장 과정에서 connector의 생성·수정 메서드는 호출하지 않는다. 가격은 스토어 금액을 임의로 변환하지 않고 제공 CSV에서 정확한 값을 별도로 선택한다.

스토어에서 처음 가져온 상품은 `sourceKind=remote`로 기록한다. 이후 최소 시트를 다시 가져와도 이 상품을 시트 누락으로 처리하지 않으며, 시트에 같은 상품 키가 정식으로 추가되면 시트 원본으로 전환한다. `sourceKind`는 웹 원본 관리용 메타데이터이므로 Unity manifest에는 포함하지 않는다.

최소 시트에서 처음 가져온 상품은 `unconfigured` 유형과 `UNCONFIGURED` 가격표를 가진 초안이다. 웹 설정 전 신규 업로드를 차단하고 Unity manifest에서도 제외한다. 최초 웹 설정 이후 유형을 변경할 수 없다. ID·구매 이력 키·GUID·보상은 웹 내용 편집으로 바꾸지 않는다. 내용 변경 시 revision이 달라져 이전 게임 준비 확인과 업로드 계획은 다시 검증해야 한다.

`JSON 파일로 가져오기`는 Unity 초기 이관 형식 (`products` 배열 또는 상품 배열)을 지원한다. 이관 JSON에는 기존 type·pricePresetKey·localizations 및 legacyName·saveName·assetGuid·legacyPrice가 포함될 수 있다. 최소 시트와 서로 다른 입력 규격이다. 기존 구매 이력·GUID는 서버에 보존하고 이후 시트에서 입력할 필요가 없다.

## 가격과 캐시

사용자가 제공한 `resources/pricing-matrix.csv`를 세 스토어 공통 가격의 원본으로 사용한다. 상품 상세에서 KOR 소비자가격을 검색해 바로 선택하며, 별도 가격표나 프리셋을 생성·확정하는 화면은 없다. 상품 저장 시 같은 CSV 행에서 Google 국가별 가격, Steam 통화별 가격과 내부 불변 스냅샷을 자동 생성한다. 이 스냅샷은 업로드 재현과 감사에만 사용하며 기존 모바일 상품에는 반영하지 않는다.

Apple은 국가별 금액을 직접 입력받지 않는다. `resources/pricing-matrix.csv`를 서버에서 읽어 전체 파일 SHA-256을 버전으로 사용한다. 현재 등록 파일은 원본 809행, 175개 국가, 43개 통화이며 KOR에서 선택 가능한 680개 고유 소비자가격을 제공한다. KOR 가격이 없거나 0인 행은 선택 목록에서 제외하고, 선택 행에서도 비어 있거나 0인 국가 가격은 제외한다. `proceeds`는 정산 예상액이므로 판매 가격 생성에는 사용하지 않는다. 클라이언트는 매트릭스 버전과 가격 ID만 전송하고 서버가 원본 행을 다시 읽어 검증한다. 상품별 예외가 필요하면 App Store 설정에서 해당 상품의 `pricePoints` 전체 목록을 직접 읽어 검색한다. 이 목록에는 Apple이 계정과 상품에 허용한 확장 가격도 포함되며, 선택은 상품 ID·연결 fingerprint·24시간 캐시 ID에 묶어 서버에서 다시 검증한다. 다른 상품에서 읽은 가격 포인트와 변조된 금액은 저장하지 않는다.

Google은 Apple territory의 ISO alpha-3 코드를 Google alpha-2 코드로 바꾸고, 두 스토어의 통화가 정확히 같은 국가만 Apple 소비자가격을 복사한다. Steam은 지원 통화별로 지정한 대표 Apple territory의 가격을 사용한다. 예를 들어 KRW=KOR, USD=USA, EUR=DEU, JPY=JPN이다. 국가나 통화가 대응하지 않으면 가장 가까운 가격이나 다른 통화로 바꾸지 않고 제외한다. 클라이언트가 가격 지도나 다른 금액을 추가해 전송하면 엄격한 요청 형식 검증으로 거부한다.

가격 포인트 ID는 상품별이다. 선택한 CSV 가격을 신규 상품에 적용할 때 그 상품의 KOR 가격 포인트를 다시 조회하여 정확히 하나가 일치할 때만 대한민국 기준 가격 하나와 base territory를 설정한다. 다른 판매 지역은 수동 가격을 만들지 않아 Apple의 자동 가격 조정을 유지한다. 적용 직전 KOR 통화도 재확인한다. 기존 수동 가격 데이터는 상품 상세에서 CSV 가격을 다시 선택해야 신규 운영 업로드에 사용할 수 있다.

프로젝트에 기존 Apple 상품이 없어도 공통 가격 매트릭스에서 가격을 선택할 수 있다. 판매 지역 선택은 Apple territories API의 현재 국가·통화를 별도로 읽는다. 매트릭스 파일을 교체하면 파일 해시가 바뀌며 열린 화면의 이전 선택 요청은 거부된다. 기존에 확정한 내부 가격 버전은 감사와 작업 재현을 위해 그대로 보존한다.

상세 화면의 스토어 설정은 판매 지역·예외 문구·심사 자료를 보관한다. 원격 스토어 조회값은 실제 등록 상태다. 웹 초안이나 캐시로 원격값을 대체하지 않는다. Google·Apple 기존 상품에 대한 일반 업로드 쓰기 0건 정책과 상품별 일회성 승인 절차를 유지한다.

Steam은 기존 DungeonSlasher CloudScript 구조에 맞춰 Apple의 통화 단위 가격을 저장하고, 배포할 때 KRW는 원 단위 정수, 그 외 통화는 최소 화폐 단위 정수로 변환한다. 미선택 상품과 알 수 없는 필드를 보존한다.

## Unity 이관

도구 소스는 게임 저장소의 `Assets/NSP/Editor/IapWebManifestImporter.cs`입니다. `product-upload`에 게임 저장소를 복사하지 않습니다.

1. 게임 변경 전 현재 브랜치와 IAP DB/에셋 상태를 확인합니다.
2. Unity `NSP > 데이터 > 인앱결제 > 웹 상품 관리 > 초기 이관 JSON 내보내기`를 사용합니다. 이 기능은 게임 에셋을 변경하지 않습니다. 스토어 상품만 내보내며 번역은 실제 스토어에 맞춰 웹에 작성합니다.
3. 웹의 초기 데이터 가져오기로 JSON을 가져옵니다. 시트에는 5개 식별 열만 옮깁니다. legacyName·saveName·GUID·가격 enum은 초기 이관 기록에 보관하고 시트 재가져오기로 덮어쓰지 않습니다. 기존에 같은 ID를 공유하는 게임 에셋이 여러 개면 자동으로 하나를 선택하지 말고 담당자가 정식 상품 키와 연결을 정리합니다.
4. 인증된 웹에서 manifest를 내려받습니다. 형식은 `schemaVersion: 1`, `gameId`, `revision`, `products`입니다. 제품 항목은 공통 키·타입·각 스토어 ID·프리셋 참조·Unity 보존 식별값을 포함합니다.
5. Unity의 `manifest 검증 및 가져오기`로 전체 사전 검증 결과를 확인합니다. 기존 에셋에는 보상·가격·구매 이력·ID를 쓰지 않습니다. 새 상품은 `WebDrafts`에 `isDeprecated=true`로 생성하고 **런타임 DB에는 추가하지 않습니다**. 보상/UI/조건 검증 후 기존 상품 에디터에서 명시적으로 등록합니다.
6. `ProjectSettings/IapWebManifestBindings.json`은 게임별 키→에셋 GUID와 revision을 보관합니다. 다른 gameId 가져오기는 차단합니다. 신규 가격 enum은 명시적으로 매핑해야 하며 지원하지 않는 가격을 가장 가까운 등급으로 바꾸지 않습니다.
7. 기존 구매 테스트 계정으로 소비성 지급/비소모성 복원/Steam 통화 결제를 검증한 후 웹에 현재 revision과 준비된 상품 키·검증 근거를 등록합니다.

Importer 실행이 자동으로 실결제와 복원 검증을 대신하지 않습니다. 웹 manifest만으로 상품을 출시하지 않으며, 이력 키나 보상 로직 변경은 별도 게임 코드 검토 대상입니다.

웹의 `게임 프로젝트 적용 확인`은 위 4~7단계 수행 결과를 현재 catalog revision과 선택 상품 키에 묶어 기록하는 배포 전 조건이다. 스토어 연결 상태를 뜻하지 않으며 상품 생성·수정 요청도 보내지 않는다. 상품 내용이나 revision이 바뀌면 이전 확인은 더 이상 현재 버전에 유효하지 않다.

## 외부 API 근거

- [Google 생성 전용 insert](https://developers.google.com/android-publisher/api-ref/rest/v3/inappproducts/insert)
- [Google 최신 일회성 상품 목록](https://developers.google.com/android-publisher/api-ref/rest/v3/monetization.onetimeproducts/list)
- [Google 기존 인앱 상품 목록](https://developers.google.com/android-publisher/api-ref/rest/v3/inappproducts/list)
- [Google 생성/수정 겸용 patch](https://developers.google.com/android-publisher/api-ref/rest/v3/monetization.onetimeproducts/patch)
- [Apple 상품 버전 생성](https://developer.apple.com/documentation/appstoreconnectapi/post-v1-inapppurchaseversions)
- [Apple 앱의 인앱 상품 목록](https://developer.apple.com/documentation/appstoreconnectapi/get-v1-apps-_id_-inapppurchasesv2)
- [Apple 번역 생성](https://developer.apple.com/documentation/appstoreconnectapi/post-v2-inapppurchaselocalizations)
- [Apple 판매 지역 조회](https://developer.apple.com/documentation/appstoreconnectapi/get-v1-territories)
- [Apple 가격 포인트 조회](https://developer.apple.com/documentation/appstoreconnectapi/get-v2-inapppurchases-_id_-pricepoints)
- [Apple 가격 포인트 자동 환산 조회](https://developer.apple.com/documentation/appstoreconnectapi/get-v1-inapppurchasepricepoints-_id_-equalizations)
- [Apple 인앱 상품 가격 설정](https://developer.apple.com/help/app-store-connect/manage-in-app-purchases/set-a-price-for-an-in-app-purchase/)
- [Apple IAP 심사 조건](https://developer.apple.com/help/app-store-connect/manage-submissions-to-app-review/submit-an-in-app-purchase/)
- [Steam Microtransactions](https://partner.steamgames.com/doc/features/microtransactions/implementation)
