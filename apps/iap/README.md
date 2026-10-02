# Product Upload

사내 여러 게임의 인앱 상품 시트·가격표·스토어 업로드 관리 시스템.

**Google Play와 Apple 기존 상품은 일반 업로드에서 절대 수정하지 않습니다.** Steam은 현재 카탈로그 갱신을 허용합니다.

React·TypeScript / Express / PostgreSQL / DB 작업 워커 / Docker 구성입니다.

프로젝트 선택은 회사에서 현재 계정에 공개한 프로젝트 목록을 사용합니다. IAP 연결이 없는 프로젝트도 목록에 나타나며 선택 후 **프로젝트 연결 설정**에서 시트와 서버 프로필을 지정합니다. 선택 자체는 상품이나 연결을 생성하지 않습니다. 기존 상품·이력은 저장된 `portalProjectId`로만 매칭하고 이름으로 추측하지 않습니다.

상품 등록은 목록에서 **새 상품 추가 → 상세 설정 → 등록 검토 → 실행·결과 확인**으로 진행합니다. 새 상품은 프로젝트 Google Sheet의 `Products` 탭에 식별자 행을 먼저 추가하고, 이름·설명·번역·CSV 가격·판매 지역·심사 자료는 독립 상세 페이지에서 저장합니다. 시트 쓰기는 프로젝트 연결 프로필에서 별도로 허용해야 하며 기본값은 비활성입니다.

상단바·서비스 전환·계정 메뉴·알림·테마는 회사 포털의 `company-workspace.js`와 `company-workspace.css`를 직접 사용합니다. 사이드바와 본문은 공통 `cw-sidebar`, `workspace cw-main` 구조를 따릅니다. 별도 서비스 로고·상단바·계정 메뉴를 만들지 않으며 상품 스타일은 `.iap-app` 아래에 한정하고 `--cw-*` 테마 토큰을 사용합니다. 로컬 데모에서는 운영 포털의 인증 CORS 정책 때문에 상단 계정 조회가 실패할 수 있으며, 이를 위해 운영 접근 정책을 완화하지 않습니다.

## 로컬에서 확인

Node.js 22 이상에서 실행합니다. 데모는 메모리 저장소와 가상 스토어만 사용합니다.

```sh
npm ci
npm run build
node --import tsx scripts/demo.ts
```

브라우저에서 `http://localhost:4180`을 엽니다. 데모의 스타터 패키지는 기존 상품, 나머지는 신규 상품입니다. 모두 선택해 미리보기를 실행하면 기존 상품이 보호됩니다. 재시작하면 데모 데이터가 초기화됩니다.

```sh
npm test
npm run build
# 테스트 전용 PostgreSQL 연결을 DATABASE_URL 환경 변수로 지정한 뒤 실행
npm run test:db
```

## 운영 연결

운영은 [운영 안내](docs/OPERATIONS.md)를 따라 SSO·시트·테스트 스토어부터 연결합니다. 설정 예시는 [connectors.example.json](config/connectors.example.json)입니다. 기본값은 모든 실제 쓰기 비활성입니다. 모바일은 실제 테스트 증거가 없으면 서버에서 거부합니다.

- [보호 정책과 데이터 흐름](docs/DESIGN.md)
- [시트·가격·Unity 이관](docs/DATA.md)
- [검증 결과와 운영 전 확인](docs/VALIDATION.md)
- [Products 최소 입력 템플릿](docs/templates/Products.csv) — 번역·설명·가격은 웹에서 설정

현재 Google 생성은 검증된 구형 `inappproducts.insert` 호환 앱만 지원합니다. 새 모델로 전환된 앱의 생성과 임의 판매 국가 변경은 자동 대체하지 않고 차단합니다. Apple 최초 유형 심사와 미확정 외부 요청은 수동 확인 상태로 남습니다. 실제 계정 테스트·운영 배포·실결제 복원 검증은 로컬 자동 테스트와 별도로 진행해야 합니다.
