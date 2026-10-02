# CS 관리 도구

플레이어 데이터의 초안 폐기 확인은 공통 확인창과 비동기 상세 전환을 사용합니다. 키/서버 변경·조회·원본 복원·추가/삭제 진입에서 원문과 대상 현재성을 대조하고 취소 시 유지합니다. 기존 업무 API와 native 페이지 이탈 보호는 그대로입니다. 구현/검증 경계는 [초안 전환 계약](../../packages/contracts/draft-transitions.md)을 참고하세요.

## 공통 입력·작업 UI

정적인 업무 제약·저장 형식 설명은 공통 `cw-callout`을 사용합니다. 제목·본문·inline code와 라이트/다크 대비를 공통으로 관리하며, 실제 저장 성공·오류를 표시하는 공통 상태 UI와 구분합니다. 새 안내를 추가할 때는 루트 `packages/contracts/static-guidance.md`를 따릅니다.

플레이어 데이터 저장·키 추가·영구 삭제의 확인 체크박스는 공통 `cw-check-control`/`cw-checkbox`를 사용합니다. 선택·포커스·두 테마와 입력 크기는 공통 UI가 소유하며 CS에는 긴 대상 문구와 폼 배치만 남깁니다. 체크 여부에 따른 저장 차단과 서버의 `confirmed` 검증은 기존대로 유지합니다.

상품 명령의 Dry Run과 기존 명령 병합 승인도 같은 공통 체크박스를 사용합니다. CS는 긴 실행 설명의 배치만 소유하며 Dry Run 강제·비활성, 병합 미리보기와 DataVersion 변경 시 승인 무효화는 기존 동작을 유지합니다.

로그 검색의 장기 범위 실행 확인도 공통 체크박스를 사용합니다. 24시간 초과 안내와 시간 파티션 검색의 확인 필요 여부, 요청의 `confirmLongRange` 값은 기존 로그 검색 도메인이 계속 소유합니다.

네 화면의 일반 입력·버튼·동적 행 작업·표는 모노레포 공통 primitive를 사용합니다. 별도 primary/secondary/danger 및 일반 입력 테마 CSS를 추가하지 않습니다. 상품 JSON 복사는 공통 `CompanyClipboard.copyText`를 사용하고 앱에서 fallback textarea를 만들지 않습니다. 플레이어 JSON 편집기의 투명 배경은 diff canvas를 위한 기능 예외입니다. GZip/lossless 원문과 기존 API·실행 확인은 유지합니다. 전체 경계는 루트 `packages/contracts/cs-controls.md`를 참고하세요.

## 공통 테마 소스 검사

모바일 상품 입력 결과는 오류 설명과 입력값을 줄바꿈하며 상태 배지를 다음 행에 표시합니다. 좁은 화면에서 설명이 한두 글자로 말줄임되지 않도록 검사합니다.

모노레포 루트 `npm run check:ui`는 `public`의 새 CSS/HTML/JS를 포함하여 `--cw-*` 참조와 공통 테마 소유권을 검사합니다. 페이지에서 새 이름을 임의로 만들거나 공통 값을 재정의하지 않습니다. 상품 입력 결과·상품 아이콘 바탕·명령 미리보기는 정의된 `--cw-raised`를 사용하며 `cs-product-commands.spec.mjs`에서 양쪽 환경, 모바일/PC, light/dark 계산값을 확인합니다. 운영 PlayFab 데이터는 검증에 사용하지 않습니다.

사내 CS 담당자가 Steam 결제 환불, PlayFab 상품 지급·회수, 플레이어 세이브 편집, Azure에 보관된 PlayFab 로그 검색을 처리하는 내부 웹 도구입니다.

직원 계정과 CS 접근 권한의 원본은 `company-portal` 하나입니다. CS는 자체 직원 계정이나 외부 Basic 로그인을 제공하지 않으며, 활성 회사 계정에 `cs.access`가 있을 때만 Company Portal SSO로 진입할 수 있습니다. `cs.access`는 조회, 환불, PlayFab 작업을 포함한 CS 전체 기능의 접근 권한입니다.

모든 CS 세부 화면은 Portal이 제공하는 공통 워크스페이스 바와 서비스 전환 메뉴를 사용합니다. 시스템·라이트·다크 테마는 `*.example.com`에서 공유되고, 모바일에서도 같은 상단 앱 메뉴를 사용합니다. 정식 진입 경로는 `https://company.example.com/workspace/cs`이며 기존 `cs.example.com` 직접 링크는 유지합니다. 세션 만료 시 현재 입력 화면을 보존한 채 공통 재로그인 안내를 표시합니다.

CS 내부의 정식 상세 경로는 `/refunds`, `/products`, `/logs`, `/players`입니다. 기존 `.html` 주소와 루트 주소도 북마크 호환을 위해 같은 화면으로 계속 제공됩니다.

## 기능

### Company Portal 통합

- 회사 홈의 CS 메뉴에서 진입
- Company Portal의 활성 직원 계정과 `cs.access` 권한 사용
- 회사 관리자와 마스터는 Company Portal 정책에 따라 CS에 항상 접근
- 직접 입력한 CS 하위 주소를 로그인 이후에도 보존
- 모든 CS 화면에서 회사 홈 이동 및 CS 세션 로그아웃 제공
- 실제 직원 ID, 이름, 이메일을 변경 작업 감사 로그에 기록
- CS 로그인은 기본 7일 유지되며 사용 중에는 만료 전에 자동 갱신

### Steam 결제 환불

- `ISteamMicroTxn/QueryTxn/v3` 거래 조회
- Order ID / Steam Transaction ID 자동 판별
- Steam ID와 거래 상태 검증
- `ISteamMicroTxn/RefundTxn/v2` 전체 환불
- JSONL 감사 로그
- 기본 설정은 Production + 환불 비활성화

Steam `RefundTxn`은 부분 환불을 지원하지 않습니다. 실행 시 원주문의 전체 금액이 환불됩니다.

환불 확인창은 공통 `CompanyDialog`를 사용합니다. 확인 직전에 현재 환경·실행 허용 설정·거래를 다시 읽고 실제 Order ID, Steam ID, 사유를 고정해 확인합니다. 조회에 Transaction ID를 사용해도 환불 대상은 응답의 실제 Order ID입니다. 숫자 ID는 JavaScript Number로 변환하지 않습니다. 전송 중에는 조회/환불 입력을 잠그고 자동 재전송하지 않습니다. 다른 주문으로 이동할 때 기존 사유/확인 번호를 지우는 것도 명시적으로 확인합니다.

`CompanyState`는 환불 응답과 이후 거래 재조회 결과를 분리해 표시합니다. **환불 확인 후 재조회 실패는 환불 실패가 아닙니다.** ‘거래 상태 재확인’은 읽기만 수행합니다. 불완전 응답·네트워크 장애·45초 관찰 제한은 처리 여부 미확정으로 안내하고 사유를 유지합니다. 같은 문서의 해당 주문은 다시 환불할 수 없으며, 이후 조회가 Succeeded여도 이 잠금을 자동 해제하지 않습니다. 새 탭/새 문서/서버 재시작까지 보장하는 영구 멱등성 기능은 아닙니다. Steam 및 감사 기록을 먼저 확인해야 합니다. 브라우저 abort는 서버 환불의 취소나 롤백이 아닙니다.

계정 범위 변경 시 이전 거래·입력은 제거하고 현재 문서의 작업을 차단합니다. 401/403 응답은 거래 표시를 제거하고 사유를 유지한 채 계정 확인을 요구합니다. 늦은 응답은 성공 안내나 초안 초기화에 사용하지 않습니다. 기존 서버의 CS 접근 권한, CSRF/Origin 검증, 속도 제한, 실행 허용 설정, 거래 재검증과 JSONL 감사 기록은 유지합니다.

### PlayFab 상품 지급·회수

- 라이브 / 테스트 PlayFab 서버 선택, 라이브 기본
- 여러 PlayFab UID 입력
- CSV, 쉼표, 줄바꿈 입력 지원
- 젬, 영혼석, 기도석, 균열석, 마일리지
- 캐릭터, 스킨, 무기, 펫, 패키지
- 캐릭터·펫·스킨·무기 숫자 ID 직접 입력
- 입력 즉시 카탈로그 아이콘·이름·ID와 형식 오류·미등록 ID 상태 표시
- UID별 독립 UUID 요청 ID 생성
- `지급` / `회수` 명령 독립 관리
- UserReadOnlyData 전용 저장
- UID별 기존 동일 키와 병합 후 JSON 비교 및 명시적 병합 승인
- 재화 수량 합산, 캐릭터·스킨·무기·펫 중복 제거, 패키지 순서·중복 유지
- 실행 직전 JSON 값 / 키 존재 여부 / DataVersion 재검증
- Dry Run / Mock / 실제 쓰기
- 실패 UID만 동일 요청 ID로 재실행
- 현재 명령 조회 / JSON 복사 / 선택 키 수동 삭제
- 결과 CSV 다운로드
- JSONL 감사 로그

PlayFab 호출은 백엔드에서만 수행합니다.

실행·실패 UID 재시도·대기 명령 삭제는 공통 확인창을 사용합니다. 확인한 환경·UID·미리보기 토큰·병합 승인·사유를 전송 전 다시 확인하며 전송 중 입력과 중복 제출을 잠급니다. 실패 UID 재시도는 최초 요청 ID와 직전 실행 모드를 유지합니다. 현재 Dry Run 체크를 바꾸어도 재시도의 모드를 바꾸지 않습니다. 새 미리보기는 새 요청 ID를 발급하므로 이전 실제 실행 결과가 있으면 별도 확인을 요구합니다.

명령 등록 결과는 게임 내 지급·회수 완료와 구분합니다. 삭제 성공 뒤 조회가 실패해도 삭제를 실패로 표시하거나 반복하지 않습니다. ‘명령 상태 재확인’은 읽기만 수행합니다. 실제 쓰기 응답이 불완전하거나 통신/45초 관찰 제한으로 확인되지 않으면 초안을 유지하고 현재 문서의 추가 쓰기와 새 미리보기를 잠급니다. 현재 명령 조회와 감사 기록으로 확인해야 하며 조회만으로 이 잠금이 해제되지는 않습니다. 브라우저 abort는 PlayFab 작업 취소가 아닙니다. 계정 범위 변경은 이전 결과·입력을 제거하고, 401/403은 결과를 제거한 채 현재 문서의 작업을 차단합니다.

응답은 UID 집합·요청 ID·환경·실행 모드·결과 건수까지 검사한 뒤 반영합니다. 기존/병합 명령 표시에는 lossless pretty formatter를 사용해 큰 정수를 보존합니다. 서버의 기존 스냅샷·병합·쓰기 허용·감사·재시도 정책은 유지하며 새 탭/서버 재시작까지 보장하는 영구 멱등성 기능을 추가한 것은 아닙니다.

- 조회: `Server/GetUserReadOnlyData`
- 등록·수정·삭제: `Server/UpdateUserReadOnlyData`

브라우저에는 Secret Key를 전달하지 않습니다.

### PlayFab 플레이어 데이터

- 라이브 / 테스트 PlayFab 서버 선택, 라이브 기본
- PlayFab UID를 한 번 조회해 `UserData`, `UserReadOnlyData`, `UserInternalData`의 모든 키와 값을 한 화면에 표시
- 전체 키·값 미리보기 표, 키/값 검색, 상세 편집
- 선택한 행 바로 아래에서 한 번에 하나만 펼쳐지는 인라인 상세 편집
- 공통 상세 펼치기를 사용하며 접기/검색 후 재열기에도 초안·사유·확인 체크·커서·스크롤 보존
- 조회·저장 중 대상 변경/편집과 중복 제출 잠금, 모바일 표 스크롤과 상세 입력 너비 분리
- 각 저장소에서 PlayFab 방식의 키 추가·수정·삭제
- JSON과 일반 문자열을 키별로 자동 판별하고 JSON은 lossless pretty 편집
- 원본 대비 수정·추가 줄 배경 강조, 삭제 위치 표시, 이전·다음 변경 블록 바로가기를 제공하는 실시간 diff 편집기. 변경 요약은 공통 상태 pill을 사용하며 수정은 warning, 추가는 success, 삭제는 danger로 표시
- `SaveData-Compression`의 `gzip-v1:{원본바이트수}:{Base64 GZip}` 검증·자동 해제
- 세이브 수정 시 `SaveData-Compression` 갱신 및 기존 `SaveData` 제거
- ES3 JSON의 64비트 정수 및 문자열 토큰 보존
- 추가·수정·삭제 직전 대상 키를 다시 조회해 중복 생성과 동시 변경 충돌 차단
- 처리 사유와 최종 확인 체크 후 저장
- 공통 확인창/입력 모달과 결과 안내, 대상·원문·편집 토큰 확인 후 편집 기준 갱신
- 추가·삭제 성공 후 목록 장애를 구분하고 읽기만 재시도, 충돌/미확정 응답과 계정 변경 시 초안 보존
- 일반 키는 선택한 키만, 세이브는 압축 키 갱신과 레거시 키 제거를 한 요청으로 처리
- 담당 직원, 사유, 변경 전후 크기·해시를 JSONL 감사 로그에 기록
- 데이터 원문은 감사 로그에서 제외

압축 키가 없거나 손상되면 기존 `SaveData`를 폴백으로 표시합니다. 저장할 때는 원문을 BOM 없는 UTF-8로 GZip 압축하고 표준 Base64로 변환하며 원본 바이트 길이를 기록합니다. 최대 압축 해제 크기는 32MB입니다. 자세한 운영 절차는 `docs/playfab-player-data.md`를 참고하세요.

모든 CS 화면의 상단에서 시스템·라이트·다크 테마를 선택할 수 있으며 선택값은 브라우저에 보관됩니다.

### PlayFab 로그 검색

Azure Blob Storage의 다음 형태로 저장된 PlayFab Parquet 로그를 검색합니다.

```text
logs/
└─ data/
   └─ title=EF17D/
      └─ date=20260814/
         └─ hour=03/
            ├─ part-....snappy.parquet
            └─ ...
```

검색 기능:

- 라이브 Title 고정 검색
- 기간 제한 없는 검색 및 최근 1/6/24시간, 7일, 30일 빠른 선택
- `EventData` JSON 본문 자유 문자열 검색
- 모든 단어 포함 / 정확한 문구 / 하나라도 포함
- PlayFab UID 선택 필터
- 이벤트 이름 선택 필터
- 최신순 / 오래된순
- `Logs[].Message`만 보여주는 기본 간단히 보기 / EventData 상세 보기 전환
- 결과 CSV 다운로드
- 즉시 작업 ID를 반환하는 백그라운드 검색, 진행률 조회와 페이지 재진입 시 작업 이어보기
- 동일 직원·동일 조건 검색의 중복 실행 방지 및 최근 완료 결과 재사용
- 장기 검색 예상 파티션·비용 안내와 명시적 실행 확인, 실행 중 취소
- 시간 파티션 단위 공정 큐로 장기 작업의 독점 방지
- Azure 목록 페이지 처리와 최대 결과 수 기반의 고정 메모리 사용
- 누적 Blob 개수에 의한 강제 중단 없음
- 검색 감사 로그

PlayFab UID를 입력하면 각 Parquet에서 `EntityLineage_master_player_account` 컬럼을 먼저 읽어 해당 UID가 없는 파일을 제외한 뒤 EventData를 읽습니다. UID를 입력하지 않으면 선택 기간의 Parquet EventData를 모두 검사하므로 검색 비용이 더 큽니다.

Parquet 읽기는 `hyparquet`의 HTTP Range 읽기를 사용합니다. Azure Storage SAS Token은 백엔드 환경변수에만 두며 브라우저에 전달하지 않습니다.

## 실행

### 1. 환경변수 생성

```bash
cp .env.example .env
```

예시:

```dotenv
STEAM_PUBLISHER_KEY=
STEAM_APP_ID=2712460
STEAM_USE_SANDBOX=false
STEAM_REFUND_ENABLED=false

PLAYFAB_LIVE_TITLE_ID=
PLAYFAB_LIVE_SECRET_KEY=
PLAYFAB_TEST_TITLE_ID=
PLAYFAB_TEST_SECRET_KEY=

PLAYFAB_PRODUCT_COMMANDS_MOCK_MODE=false
PLAYFAB_PRODUCT_COMMANDS_TEST_ENABLED=true
PLAYFAB_PRODUCT_COMMANDS_LIVE_ENABLED=false
PLAYFAB_PRODUCT_COMMANDS_CONCURRENCY=4

PLAYFAB_PLAYER_DATA_MOCK_MODE=false
PLAYFAB_PLAYER_DATA_TEST_ENABLED=true
PLAYFAB_PLAYER_DATA_LIVE_ENABLED=false

AZURE_PLAYFAB_LOG_STORAGE_ACCOUNT=dungeonslasherlogs
AZURE_PLAYFAB_LOG_CONTAINER=logs
AZURE_PLAYFAB_LOG_PREFIX=data
AZURE_PLAYFAB_LOG_SAS_TOKEN=
AZURE_PLAYFAB_LOG_CONCURRENCY=4
AZURE_PLAYFAB_LOG_JOB_CONCURRENCY=4

COMPANY_PORTAL_URL=https://company.example.com
COMPANY_SSO_ISSUER=company-portal
COMPANY_SSO_SHARED_SECRET=Portal_Leave_CS에_동일한_32자_이상_키
CS_SESSION_MINUTES=15
CS_INTERNAL_PORT=3100

COOKIE_SECURE=false
TRUST_PROXY=false
```

실제 SSO 키, Secret Key와 SAS Token은 `.env` 또는 배포 환경의 Secret 저장소에만 넣으세요. SSO 키는 Company Portal, Leave, CS에 동일하게 설정하며 저장소에 커밋하지 않습니다.

로그 검색용 SAS에는 대상 Container에 대한 최소 `Read` + `List` 권한만 부여하는 것을 권장합니다. 쓰기/삭제 권한은 필요하지 않습니다.

### 2. Docker 실행

```bash
docker compose up -d --build
```

기본 바인딩은 `127.0.0.1:3000`입니다. 외부 접근은 Cloudflare Tunnel, Tailscale, 사내 VPN 또는 HTTPS 리버스 프록시를 권장합니다.

### 로컬 Node 실행

Node.js 20 이상:

```bash
npm install
npm run check
npm test
npm start
```

로컬 실행도 Company Portal SSO 설정이 필요합니다. `npm start`는 외부 Basic 인증으로 대체 실행되지 않으며, 필수 SSO 설정이 없으면 시작에 실패합니다.

## PlayFab 운영 권장 순서

1. 테스트 Title ID / Secret Key 설정
2. `PLAYFAB_PRODUCT_COMMANDS_TEST_ENABLED=true`
3. 라이브 쓰기는 `false` 유지
4. 웹에서 테스트 서버 선택
5. Dry Run으로 대상과 JSON 확인
6. 테스트 UID에 실제 명령 등록
7. 게임에서 `회수 → 지급` 처리 확인
8. 완료 후 UserReadOnlyData 키 삭제 확인
9. 운영 준비가 끝난 뒤 필요한 경우에만 라이브 쓰기 활성화

## 로그 검색 설정 순서

1. Azure Storage Account에서 로그 Container를 확인합니다. 현재 기본 Container 이름은 `logs`입니다.
2. Container 범위의 SAS를 생성하고 최소 `Read` + `List` 권한만 부여합니다.
3. `AZURE_PLAYFAB_LOG_STORAGE_ACCOUNT`, `AZURE_PLAYFAB_LOG_CONTAINER`, `AZURE_PLAYFAB_LOG_SAS_TOKEN`을 설정합니다.
4. 실제 Blob 구조가 `data/title={TitleId}/date=YYYYMMDD/hour=HH/`라면 `AZURE_PLAYFAB_LOG_PREFIX=data`를 사용합니다.
5. `PLAYFAB_LIVE_TITLE_ID`, `PLAYFAB_TEST_TITLE_ID` 중 로그가 존재하는 Title ID를 설정합니다.
6. `AZURE_PLAYFAB_LOG_JOB_CONCURRENCY`로 동시에 실행할 직원별 검색 작업 수를 정합니다. 기본값은 4, 최대값은 8입니다.
7. 컨테이너를 재생성한 뒤 `/playfab-logs.html`에서 짧은 기간으로 먼저 검색합니다.

## 보안

- Publisher Key와 PlayFab Secret Key는 서버 환경변수에서만 사용
- Azure Storage SAS Token도 서버 환경변수에서만 사용
- 인증정보를 HTML / JavaScript / API 응답 / 감사 로그에 포함하지 않음
- 로그 검색 감사 기록에는 검색어 원문 대신 SHA-256 해시를 기록
- Company Portal 중앙 로그인 및 `cs.access` 검증
- 외부에서 접근할 수 없는 루프백 내부 서버와 프로세스 시작 시 생성되는 임시 게이트웨이 인증정보
- 클라이언트가 보낸 `x-company-*` 헤더 제거 후 검증된 SSO 사용자 정보만 내부 전달
- CSRF 검증
- Origin 검증
- 요청 제한
- HTTPS 리버스 프록시 권장

HTTPS 프록시 뒤에서는 다음 설정을 권장합니다.

```dotenv
COOKIE_SECURE=true
TRUST_PROXY=true
```

## 감사 로그

Docker volume의 `/app/data`에 JSON Lines 형식으로 기록됩니다.

```text
/app/data/refund-audit.jsonl
/app/data/playfab-product-command-audit.jsonl
/app/data/player-data-audit.jsonl
/app/data/playfab-log-search-audit.jsonl
/app/data/company-access-audit.jsonl
```

감사 로그의 운영자는 Company Portal 직원의 `userId`, `userName`, `userEmail`로 기록됩니다. 로그 검색 감사 로그에는 IP, 환경, Title ID, 검색 기간, UID/이벤트 필터, 검색어 SHA-256, 결과 수, 검사 파일 수와 소요 시간도 기록합니다. SAS Token과 검색어 원문은 기록하지 않습니다.

## 검증

```bash
npm run check
npm test
```

루트 CI에서는 추가로 Docker build와 테스트 전용 설정을 사용한 임시 컨테이너 `/health` smoke test를 수행합니다. 운영 환경 파일·데이터 볼륨·운영 네트워크는 사용하지 않습니다.

## 상세 문서

```text
docs/playfab-product-commands.md
docs/playfab-player-data.md
docs/playfab-log-search.md
docs/company-sso.md
```

## 통합 워크스페이스 UI (2026-09-07)

- 플레이어 데이터의 조회·설정 오류·검색 빈 결과는 다른 CS 작업과 같은 공통 상태 UI로 표시하며 개별 토스트는 사용하지 않습니다. 조회가 실패하면 이전 결과/편집 초안을 남기고 새 조회가 성공할 때까지 쓰기를 잠급니다. ‘다시 확인’은 읽기만 수행하며 초안 폐기는 별도로 확인합니다. 취소/관찰 시간 초과는 서버 변경 롤백이 아니고, 계정 변경이나 해제 뒤 늦은 응답은 적용하지 않습니다. JSON 수정 배경과 네 화면의 환경·거래·작업·미리보기 상태 pill은 공통 light/dark 의미 색상으로 동작합니다.

- 상단바는 Company Portal의 `/js/company-workspace.js`, `/css/company-workspace.css`를 공통 사용합니다. 로고의 홈 이동, 종 모양 알림, 개인 설정/로그아웃, 권한별 서비스 전환, 테마를 한 곳에서 제공합니다.
- 서비스 내부 메뉴는 `.cw-sidebar`에만 배치합니다. 각 서비스에 별도 계정·알림·테마·회사 홈 버튼을 추가하지 않습니다. 900px 이하에서는 상단 메뉴 버튼으로 하위 메뉴를 엽니다.
- 테마는 의미별 `--cw-*` 토큰을 사용합니다. 선택/미선택 상태는 `aria-current` 또는 `aria-pressed`와 함께 표현하며 색 반전 필터를 사용하지 않습니다.
- `/api/workspace/context`가 실제 계정과 허용된 서비스만 반환합니다. 관리자 계정은 모든 서비스를, 공용 계정은 부여받은 서비스만 볼 수 있습니다. 화면 숨김과 별개로 각 서비스 백엔드도 권한을 검증합니다.
- 개인 설정 `/settings/profile`: 사진만 변경 가능합니다. 브라우저에서 가운데를 256×256 PNG로 변환하고 서버에서 크기/CRC/압축 해제 크기를 검증합니다. 이름·부서·역할 수정 API는 제공하지 않습니다.
- SSO 토큰과 서비스 세션에 `sid`가 포함됩니다. 서비스는 HMAC 서명된 60초 토큰(`aud=workspace-session`)으로 Portal의 `/api/internal/workspace/session`에서 세션과 최신 권한을 확인합니다. 로그아웃은 현재 브라우저의 sid를 폐기하므로 모든 하위 서비스의 기존 세션이 거부되며 다른 기기의 세션은 유지됩니다.
- 내부 인증 연결 실패는 503으로 실패 처리하며 인증을 우회하지 않습니다. Node 서비스의 내부 주소는 `COMPANY_PORTAL_INTERNAL_URL`(기본 `http://company-portal:8080`), Leave는 `CompanyPortal:InternalUrl`, Schedule은 `Portal:InternalUrl`입니다. Docker `company-services` 네트워크와 서비스 간 동일 SSO 키가 필요합니다.
- 알림 원본 DB는 각 서비스에 남습니다. 내부 GET `/api/internal/company-notifications?format=workspace-v2`는 `{items,unreadCount}`, 형식 미지정은 기존 배열을 반환합니다. 내부 POST `.../read?id=ID` / `.../read`는 서명 토큰의 사용자 소유 알림만 읽음 처리합니다. Portal은 권한 있는 출처만 조회하며 일부 실패를 UI에 표시합니다.
- Portal의 쓰기 API는 인증 쿠키와 `X-Workspace-CSRF`를 함께 검증하고 허용된 서비스 origin에만 CORS를 제공합니다. 각 서비스 CSP의 `connect-src`, `img-src`는 `https://company.example.com`을 허용합니다.
- 배포 시 Portal DB와 DataProtection 키를 백업하고 Portal 및 모든 하위 서비스를 함께 갱신합니다. 새 `WorkspaceSessions`/`WorkspaceProfiles` 테이블은 추가 방식이며 기존 직원·업무 데이터를 이동/삭제하지 않습니다. 구버전 서비스 세션은 최초 접근 시 한 번 SSO 재연결이 필요할 수 있습니다.
