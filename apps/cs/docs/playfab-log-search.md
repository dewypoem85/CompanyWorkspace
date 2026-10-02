# PlayFab Azure 로그 검색

CS 웹 도구에서 Azure Blob Storage에 Export된 **라이브 PlayFab** Parquet 로그의 `EventData` 본문을 검색하는 기능입니다.

## 대상 Blob 구조

```text
Container: logs

data/
└─ title={PLAYFAB_LIVE_TITLE_ID}/
   └─ date=YYYYMMDD/
      └─ hour=HH/
         └─ part-....snappy.parquet
```

로그 검색에서는 라이브/테스트 선택을 제공하지 않습니다. 현재 백업 대상이 라이브 Title 하나이므로 `PLAYFAB_LIVE_TITLE_ID`를 고정 사용합니다.

`date`와 `hour`는 UTC 파티션으로 취급합니다. 브라우저의 `datetime-local` 입력은 사용자 로컬 시간으로 입력받은 뒤 ISO UTC 시각으로 백엔드에 전달합니다.

## 검색 대상 컬럼

샘플 PlayFab Export Parquet 기준:

```text
Timestamp
EventId
FullName_Name
FullName_Namespace
Entity_Id
Entity_Type
EntityLineage_master_player_account
EntityLineage_title_player_account
EventData
```

본문 검색은 `EventData` 전체 JSON 문자열에 대해 수행합니다.

PlayFab UID 필터가 있으면 먼저 `EntityLineage_master_player_account` 컬럼만 읽어 해당 UID가 파일에 존재하는지 확인합니다. UID가 없는 파일은 EventData를 읽지 않습니다.

## 검색 방식

- `all`: 공백으로 나눈 모든 검색어가 EventData에 포함
- `any`: 검색어 중 하나 이상 포함
- `exact`: 입력한 검색 문자열 전체가 그대로 포함

대소문자는 구분하지 않습니다.

예:

```text
스킨 젬
기도석 구매
MISSION_120
영혼석 획득
```

## 기간 및 정렬

Blob이 `date/hour` 파티션으로 나뉘어 있으므로 검색 기간과 겹치는 시간 폴더만 조회합니다.

- 검색 기간 제한 없음
- 결과 수: 최대 500건

최신순 검색은 최신 시간 파티션부터, 오래된순 검색은 과거 시간 파티션부터 처리합니다. 한 시간 파티션의 모든 Parquet 파일을 확인한 뒤 결과 수가 충분하면 다음 시간 파티션 검색을 중단합니다.

24시간을 넘는 전체 본문 검색이나 7일을 넘는 UID 검색도 차단하지 않습니다. 대신 예상 시간 파티션 수와 비용 안내를 표시하고 직원이 장기 검색 실행 확인란을 선택해야 시작합니다. 누적 Blob 개수에 따른 별도 중단 제한은 없지만 Azure 목록을 최대 5,000개 페이지 단위로 읽고, 검색 결과 메모리는 선택한 최대 결과 수 이내로 유지합니다.

현재 서버는 설정된 작업 동시 실행 수 안에서 여러 검색을 병렬 처리합니다. 파티션 사이에 이벤트 루프를 양보하지만 대기 작업을 번갈아 실행하는 라운드 로빈은 아닙니다. 실행 슬롯이 모두 장기 검색으로 찬 경우 새 작업은 대기할 수 있습니다. 실행 중인 검색은 화면의 `검색 취소`로 중단할 수 있으며, 이미 시작된 Azure 요청까지만 마친 뒤 추가 파일 처리를 멈춥니다.

## Parquet 읽기

Node.js에서 `hyparquet`을 사용합니다.

Blob 전체를 브라우저로 다운로드하지 않습니다. CS 백엔드가 SAS가 포함된 Azure Blob URL을 생성하고 `hyparquet`의 HTTP Range 읽기로 필요한 Parquet 컬럼을 가져옵니다.

브라우저는 Azure Blob Storage를 직접 호출하지 않습니다.

## Azure 인증

환경변수:

```dotenv
PLAYFAB_LIVE_TITLE_ID=EF17D

AZURE_PLAYFAB_LOG_STORAGE_ACCOUNT=dungeonslasherlogs
AZURE_PLAYFAB_LOG_CONTAINER=logs
AZURE_PLAYFAB_LOG_PREFIX=data
AZURE_PLAYFAB_LOG_SAS_TOKEN=
AZURE_PLAYFAB_LOG_CONCURRENCY=4
```

로그 검색은 `PLAYFAB_TEST_TITLE_ID`를 사용하지 않습니다.

SAS Token에는 `logs` 컨테이너에 대한 최소 권한만 부여합니다.

- Read (`r`)
- List (`l`)

즉 SAS의 권한 문자열에는 일반적으로 `sp=rl`이 포함되어야 합니다. Write/Delete 권한은 필요하지 않습니다.

SAS Token은 다음 위치에 포함하지 않습니다.

- HTML
- 브라우저 JavaScript
- API 응답
- 감사 로그
- 일반 서버 로그
- Git 저장소

## Azure 403 진단

Blob 목록 조회에서 HTTP 403이 발생하면 Azure XML 응답의 오류 코드를 화면에 표시합니다.

대표적으로 확인할 항목:

1. SAS가 `logs` 컨테이너 범위인지
2. `List(l)` 권한이 포함되어 있는지
3. Blob 읽기를 위한 `Read(r)` 권한이 포함되어 있는지
4. SAS 시작 시각이 아직 미래가 아닌지
5. SAS 만료 시각이 지나지 않았는지
6. Storage Account의 네트워크/방화벽 설정이 CS 서버 접근을 허용하는지

예를 들어 `AuthorizationPermissionMismatch`가 표시되면 SAS 권한 범위를 가장 먼저 확인합니다.

## API

### 설정 조회

```text
POST /api/playfab/log-search/config
```

응답에는 다음 정보만 포함합니다.

- 로그 검색 설정 여부
- 라이브 Title ID
- 결과 수 제한 및 기간 무제한 여부
- 비동기 작업 사용 여부와 권장 상태 조회 간격

### 검색

```text
POST /api/playfab/log-search/search
```

예:

```json
{
  "from": "2026-08-14T03:00:00.000Z",
  "to": "2026-08-14T04:00:00.000Z",
  "query": "스킨 젬",
  "mode": "all",
  "sort": "desc",
  "playFabId": "25C2B21CDCE95200",
  "eventName": "",
  "limit": 100
}
```

검색 API는 장시간 Azure 요청을 HTTP 연결에서 직접 기다리지 않고 `202 Accepted`와 작업 정보를 즉시 반환합니다.

```json
{
  "job": {
    "id": "9f43ccea-2c61-4f65-a70f-93b4b39f37a1",
    "status": "queued",
    "progress": {
      "stage": "queued",
      "partitions": 120,
      "partitionsScanned": 0
    }
  },
  "reused": false
}
```

동일한 회사 직원이 같은 조건을 다시 요청하면 실행 중인 작업 또는 최근 30분 이내 완료 결과를 재사용하고 `reused: true`를 반환합니다. 작업 동시 실행 수와 작업 내 파일 읽기 동시성은 각각 기존 서버 설정을 따릅니다. 이 UI 전환은 서버 큐 정책을 변경하지 않습니다.

### 작업 상태와 결과

```text
POST /api/playfab/log-search/status
```

```json
{ "jobId": "9f43ccea-2c61-4f65-a70f-93b4b39f37a1" }
```

상태는 `queued`, `running`, `completed`, `failed`, `cancelled` 중 하나입니다. 실행 중에는 파티션, 발견 Blob, UID 제외 Blob, 본문 검사 파일, 현재 결과 수와 경과 시간을 반환합니다. `completed` 상태에는 기존 검색 결과가 `job.result`에 포함됩니다. 작업 조회와 취소는 요청한 회사 직원만 할 수 있습니다.

### 작업 취소

```text
POST /api/playfab/log-search/cancel
```

```json
{ "jobId": "9f43ccea-2c61-4f65-a70f-93b4b39f37a1" }
```

브라우저는 기본 2초 간격으로 짧은 상태 요청을 보내 긴 검색 전체를 하나의 HTTP 응답으로 기다리지 않습니다. 개별 요청 자체의 네트워크 장애나 프록시 timeout까지 없애는 것은 아닙니다. 현재 탭을 새로고침하거나 다른 페이지에 갔다가 돌아와도 탭 세션에 저장된 작업 ID로 진행 중 작업을 다시 연결합니다. 완료·실패·취소 작업은 서버 메모리에서 최대 30분, 최근 12개까지 유지하며 서버 재시작 시 제거됩니다.

## 공통 UI와 조회 수명주기

- 진행·오류·권한·빈 결과·완료는 `CompanyState`, EventData 상세는 `CompanyDisclosure`를 사용합니다. 로그 검색 자체의 토스트와 native details는 사용하지 않습니다. 상세는 한 개만 열리며 원문 JSON의 64비트 정수/문자열 이스케이프는 기존 lossless formatter로 보존합니다.
- 결과의 실제 검색 기간·검색어·UID·이벤트를 결과 영역에 표시합니다. 검색 조건을 고치는 것만으로 기존 결과가 새 조건의 결과가 되지 않습니다. 클라이언트 입력 검증 실패는 기존 확인된 결과를 숨기지 않습니다.
- 파일 읽기 오류가 있으면 부분 결과임을 표시하며, 0건을 ‘로그 없음’으로 단정하지 않습니다. 확인된 결과가 없거나 계정 범위가 바뀌면 CSV를 비활성화합니다.
- 작업 ID만 `playfabLogSearchJobId:<회사 사용자 ID>`로 sessionStorage에 남깁니다. 검색어·결과·SAS는 저장하지 않습니다. 구형 공용 키의 ID는 서버가 현재 소유자로 조회를 허용한 뒤에만 새 키로 옮깁니다. 다른 사용자 키를 조회하지 않으며 실제 인가는 기존 서버가 수행합니다.
- 상태 조회의 일시 오류·불완전 응답은 작업 ID를 유지합니다. ‘검색 상태 재확인’은 기존 ID의 상태만 읽으며 검색 시작/취소를 반복하지 않습니다. 404는 만료/조회 불가로 구분하고 새 검색을 허용합니다. 401/403 또는 공통 계정 범위 변경은 현재 결과/검색 문자열을 지우고 새 화면 확인을 요구합니다.
- ID를 받기 전 시작 응답이 미확정이면 같은 화면의 반복 실행을 잠급니다. 자동 CSRF 재전송·자동 로그인 이동은 하지 않습니다. 새 화면에서 사용자가 같은 조건을 명시적으로 검색하면 기존 서버의 재사용 정책을 따르며, 네트워크 단절 전 요청 도착 여부를 클라이언트가 확정할 수는 없습니다.
- 요청 관찰은 45초 상한을 두며 페이지 해제·계정 범위 변경 뒤 늦은 응답은 반영하지 않습니다. 타임아웃/브라우저 abort는 서버 검색 또는 취소 요청의 롤백이 아닙니다. 취소 응답과 완료/새 검색이 겹쳐도 이전 응답이 새 결과를 덮어쓰지 않습니다.
- 로그 카드·보기 선택·JSON 영역은 공통 의미별 테마 토큰을 사용합니다. 모바일 JSON은 내부 가로 스크롤로 들여쓰기와 긴 키를 보존하고 키보드로 스크롤할 수 있습니다.

검증: 앱 `npm test`는 실제 작업 handler 응답과 `log-search-contract.js`의 계약을 검사합니다. 루트 `npm run check`는 공통 연결·색상·범위 보호를 제거한 변이를 거부합니다. `tooling/browser-tests/cs-log-search.spec.mjs`는 실제 페이지/작업 handler와 격리 Azure/Parquet를 사용하며 외부 요청·운영 로그 쓰기는 없습니다. 실제 Azure 자격 증명·운영 SSO·컨테이너 성능 검증을 대신하지 않습니다.

결과의 기본 `간단히 보기`는 EventData 내부의 `Message` 값을 추출해 운영 메시지와 시각·UID만 표시합니다. `상세 보기`로 전환하면 Timestamp, 라이브 Title ID, PlayFab UID, Event 이름, EventData 검색 부분과 원문, EventId, Entity 정보, 원본 Blob 경로를 확인할 수 있습니다.

## 감사 로그

```text
/app/data/playfab-log-search-audit.jsonl
```

기록 항목:

- 실행 시각
- 운영자
- IP
- request ID
- 라이브 Title ID
- 검색 시작/종료 시각
- PlayFab UID 필터
- 이벤트 이름 필터
- 검색 방식/정렬
- 검색어 SHA-256
- 결과 수
- 조회한 파티션/Blob/row 수
- 소요 시간

검색어 원문과 SAS Token은 기록하지 않습니다.

## 운영상 주의

UID 없이 본문만 검색하면 해당 기간의 Parquet EventData를 모두 검사해야 합니다. 따라서 가능한 경우 다음 조합을 사용합니다.

```text
PlayFab UID + 짧은 기간 + 검색어
```

장기간 전체 로그를 빈번하게 자유 검색해야 하는 요구가 커지면 Blob 직접 검색 대신 Azure Data Explorer 등 별도의 검색 인덱스를 추가하는 것을 검토합니다.
