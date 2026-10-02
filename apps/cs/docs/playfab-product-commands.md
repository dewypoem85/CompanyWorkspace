# PlayFab 상품 지급·회수 관리 기능

`company-org/CS` 내부 운영 도구의 PlayFab 상품 지급·회수 기능입니다.

`지급`·`회수` 명령은 **PlayFab UserReadOnlyData**에 저장합니다. 웹에서 **테스트 서버 / 라이브 서버**를 선택할 수 있으며, 두 환경의 Title ID와 Secret Key는 서버 환경변수로 분리합니다.

## 저장 구조

- 지급 키: `지급`
- 회수 키: `회수`
- 저장 위치: `UserReadOnlyData`

사용 PlayFab API:

- 조회: `Server/GetUserReadOnlyData`
- 신규 등록·병합 결과 저장: `Server/UpdateUserReadOnlyData`
- 수동 삭제: `Server/UpdateUserReadOnlyData` + `KeysToRemove`

상품 명령에는 일반 UserData API, Admin UserData API 또는 Client 쓰기 API를 사용하지 않습니다.

브라우저는 CS 백엔드 API만 호출하며, PlayFab Server API 호출은 백엔드에서 수행합니다.

## 라이브 / 테스트 서버 분리

웹 페이지의 `PlayFab 서버` 선택에서 다음 중 하나를 선택합니다.

- `테스트 서버`
- `라이브 서버`

두 환경은 각각 독립적인 Title ID와 Secret Key를 사용합니다.

```dotenv
PLAYFAB_LIVE_TITLE_ID=
PLAYFAB_LIVE_SECRET_KEY=

PLAYFAB_TEST_TITLE_ID=
PLAYFAB_TEST_SECRET_KEY=
```

Secret Key는 서버에서만 읽습니다. HTML, 브라우저 JavaScript, API 응답, 감사 로그에 포함하지 않습니다.

브라우저에는 환경 식별자, 설정 여부, Title ID, Mock 여부, 쓰기 허용 여부만 전달합니다.

## 쓰기 허용

환경별로 실제 쓰기를 따로 제어합니다.

```dotenv
PLAYFAB_PRODUCT_COMMANDS_LIVE_ENABLED=false
PLAYFAB_PRODUCT_COMMANDS_TEST_ENABLED=false
```

권장 운영값:

```dotenv
PLAYFAB_PRODUCT_COMMANDS_TEST_ENABLED=true
PLAYFAB_PRODUCT_COMMANDS_LIVE_ENABLED=false
```

테스트가 끝난 뒤 라이브 쓰기가 필요한 경우에만 라이브 플래그를 `true`로 변경합니다.

## Mock 모드

```dotenv
PLAYFAB_PRODUCT_COMMANDS_MOCK_MODE=true
```

Mock 모드에서는 라이브/테스트 선택 모두 메모리 Mock 저장소를 사용하며 실제 PlayFab 네트워크 호출을 하지 않습니다.

실제 PlayFab 환경을 사용할 때는 다음과 같이 설정합니다.

```dotenv
PLAYFAB_PRODUCT_COMMANDS_MOCK_MODE=false
```

## 명령 JSON

예시:

```json
{
  "요청ID": "grant-550e8400-e29b-41d4-a716-446655440000",
  "재화": {
    "젬": 1000,
    "영혼석": 5000,
    "기도석": 10,
    "균열석": 20,
    "마일리지": 100
  },
  "캐릭터": [21],
  "스킨": ["21-3"],
  "무기": ["21-2"],
  "펫": [5],
  "패키지": ["IAPProductDataSO productName"]
}
```

규칙:

- `요청ID` 필수
- 각 신규 요청마다 UUID 새로 생성
- 지급과 회수 사이 요청 ID 재사용 금지
- 여러 UID 처리 시 UID별 별도 요청 ID 생성
- 실패 UID 재실행은 기존 요청 ID 유지
- 사용자가 서버, UID, 작업 또는 명령 내용을 변경하면 기존 미리보기를 폐기하고 새 요청 ID 생성
- 재화 수량은 지급·회수 모두 0 이상의 정수
- `재화.마일리지`는 지급 시 더하고 회수 시 차감하는 직접 지정 수량
- 회수도 음수가 아니라 양수 수량 사용
- 방향은 `지급` / `회수` 키가 결정
- 필요 없는 필드는 생략
- 스킨·무기는 `캐릭터ID-아이템ID` 형식
- 패키지는 `IAPProductDataSO.productName` 사용
- 실제 결제 패키지는 게임에서 현재 `price`와 `isDoubleMileage` 기준 마일리지를 자동 지급·회수하므로, 직접 마일리지는 추가 조정분이 있을 때만 함께 입력

## 숫자 입력 실시간 결과

캐릭터·펫·스킨·무기는 기존처럼 숫자 ID를 직접 입력합니다. 입력란 아래의 `숫자 입력 결과`에서 네 종류를 항상 나누어 보여주며, 값을 입력하는 즉시 아이콘·이름·실제 ID를 확인할 수 있습니다.

- 캐릭터·펫: 숫자 ID 형식 검사
- 무기·스킨: `캐릭터ID-아이템ID` 형식 검사
- 정상 값: 아이콘·이름·ID와 `정상` 상태 표시
- 잘못된 형식: 입력값과 `형식 오류` 상태 표시
- 카탈로그에 없는 값: 입력값과 `미등록 ID` 상태 표시

캐릭터·펫·무기 카탈로그는 게임 통계 프로젝트의 마스터 데이터를, 스킨 카탈로그는 서버용 스킨 얼굴 이미지 파일명과 이미지를 기준으로 CS 정적 자산에 복사해 제공합니다. 따라서 CS 페이지가 통계 서비스의 로그인이나 실행 상태에 의존하지 않습니다.

## 게임 처리 순서

게임 클라이언트는 로비 진입 시 다음 순서로 처리합니다.

1. `Client/GetUserReadOnlyData`로 `회수`, `지급` 조회
2. `회수`가 있으면 먼저 처리
3. 회수 결과를 SaveData에 업로드
4. 업로드 성공 후 `completeProductChangeCommand` 호출
5. 회수 완료 통지가 끝난 뒤 `지급` 처리
6. 지급 결과를 SaveData에 업로드
7. 업로드 성공 후 `completeProductChangeCommand` 호출

`completeProductChangeCommand`는 Classic CloudScript에서 현재 UserReadOnlyData 명령의 `요청ID`와 클라이언트가 전달한 `요청ID`를 비교하고, 일치할 때만 해당 `지급` 또는 `회수` 키 하나를 삭제합니다.

웹 도구는 `completeProductChangeCommand`를 직접 호출하지 않습니다.

웹에서 명령을 등록해도 접속 중인 게임에 즉시 적용되는 방식이 아니며, 게임의 다음 명령 확인 시점에 처리됩니다.

## 환경 선택 안전장치

테스트/라이브 환경은 미리보기 계획에 고정됩니다.

미리보기 생성 후 서버 선택을 바꾸면 다음 상태를 폐기합니다.

- 기존 미리보기
- 기존 결과
- UID별 요청 ID

실행 요청에서 미리보기와 다른 환경을 지정하면 서버가 거부합니다.

라이브 서버가 선택되고 실제 쓰기가 켜져 있으면 상단 배지와 최종 확인창에서 라이브 실제 쓰기 경고를 표시합니다.

라이브 서버가 설정되어 있으면 기본 선택은 라이브 서버입니다. 라이브 설정이 없고 테스트 서버만 설정된 경우에만 테스트 서버를 선택합니다.

## 기존 명령 병합 및 동시성 보호

동일 UID에 같은 `지급` 또는 `회수` 키가 이미 있으면 새 입력으로 덮어쓰지 않습니다. 미리보기에서 UID별 `기존 동일 키`와 `병합 후 등록 JSON`을 나란히 보여주며, 운영자가 병합을 명시적으로 승인한 UID만 저장합니다.

병합 규칙:

- 재화: 기존 수량과 새 수량 합산
- 캐릭터·스킨·무기·펫: 기존 순서를 유지하고 새 항목을 중복 없이 추가
- 패키지: 여러 번 처리하는 의미를 보존하기 위해 기존 목록 뒤에 새 목록을 중복 포함해 추가
- 요청 ID: 병합된 전체 명령에 새 UID별 요청 ID 발급
- 기존의 알 수 없는 추가 필드: 값 그대로 보존

기존 JSON이 깨져 있거나 알려진 필드의 형식이 올바르지 않거나 병합 결과가 크기 제한을 넘으면 해당 UID를 `병합 불가`로 표시하고 저장하지 않습니다.

미리보기 시 UID마다 다음 스냅샷을 보관합니다.

- 대상 키 존재 여부
- 현재 JSON 문자열
- UserReadOnlyData `DataVersion`

실행 직전 동일 환경의 `Server/GetUserReadOnlyData`로 다시 조회합니다.

다음 중 하나라도 달라지면 해당 UID 작업을 중단합니다.

- 키 존재 여부
- JSON 값
- `DataVersion`

기존 키 병합 승인도 미리보기 이후 값 또는 DataVersion이 바뀌면 무효입니다.

실제 저장 요청에는 대상 키 하나만 보냅니다.

지급:

```json
{
  "Data": {
    "지급": "..."
  }
}
```

회수:

```json
{
  "Data": {
    "회수": "..."
  }
}
```

반대 키를 같은 요청에 포함하지 않습니다.

수동 삭제도 선택한 키 하나만 `KeysToRemove`에 넣습니다.

PlayFab API 자체에 이전 DataVersion을 조건으로 하는 원자적 CAS 쓰기 기능이 없으므로, 도구는 `실행 직전 재조회 → 비교 → UpdateUserReadOnlyData` 방식으로 보호합니다. 두 호출 사이의 매우 짧은 경쟁 구간까지 완전히 제거할 수는 없습니다.

## 재시도 정책

자동 재시도 허용:

- 네트워크 연결 실패
- 타임아웃
- HTTP 429
- 일시적인 HTTP 5xx

자동 재시도하지 않음:

- 잘못된 UID
- 인증·권한 오류
- JSON 검증 오류
- 기존 명령 충돌
- 실행 직전 스냅샷 변경
- 영구적인 HTTP 4xx

기본 최대 재시도는 2회입니다.

## 실패 UID 재실행

실패 UID 재실행은 최초 미리보기 계획을 그대로 사용합니다.

따라서 다음 값이 유지됩니다.

- 요청 ID
- 명령 JSON
- 대상 환경

첫 요청에서 PlayFab 쓰기는 성공했지만 응답만 유실된 경우, 재실행 시 동일 명령 JSON이 이미 존재하면 추가 쓰기 없이 `retry_success`로 처리합니다.

명령 내용을 변경하면 새 미리보기를 생성해야 하며 새 요청 ID가 발급됩니다.

## Dry Run

Dry Run에서는 다음 작업만 수행합니다.

- 선택한 환경의 현재 UserReadOnlyData 조회
- 실행 직전 스냅샷 비교
- 병합 승인과 병합 결과 확인
- 결과 및 감사 로그 흐름 확인

`UpdateUserReadOnlyData` 쓰기는 호출하지 않습니다.

## 현재 명령 조회 / 수동 삭제

페이지 하단에서 현재 선택한 환경의 `지급`·`회수`를 조회할 수 있습니다.

제공 기능:

- 현재 JSON 조회
- JSON 복사
- DataVersion 확인
- 선택한 키 하나만 수동 삭제

조회 후 환경 선택이 바뀌면 기존 조회 결과를 폐기합니다.

수동 삭제는 조회 당시 JSON 값과 DataVersion을 다시 비교한 뒤 일치할 때만 실행합니다.

정상 완료 삭제는 게임 클라이언트와 `completeProductChangeCommand`가 담당하며, 수동 삭제는 운영 복구가 필요한 경우에만 사용합니다.

## 감사 로그

파일:

```text
/app/data/playfab-product-command-audit.jsonl
```

주요 기록 항목:

- 실행 시각
- 실행 모드
- 환경 `live` / `test`
- 운영자
- 접속 IP
- Title ID
- PlayFab UID
- 명령 키 `지급` / `회수`
- 요청 ID
- create / merge / delete
- 실행 전 값 SHA-256 해시
- 미리보기 DataVersion
- 실행 직전 DataVersion
- 실행 결과
- PlayFab 오류 코드
- 재시도 횟수

기록하지 않는 값:

- Secret Key
- 인증 토큰
- PlayFab 전체 민감 응답

## 운영 환경변수 예시

```dotenv
PLAYFAB_LIVE_TITLE_ID=LIVE_TITLE
PLAYFAB_LIVE_SECRET_KEY=LIVE_SECRET

PLAYFAB_TEST_TITLE_ID=TEST_TITLE
PLAYFAB_TEST_SECRET_KEY=TEST_SECRET

PLAYFAB_PRODUCT_COMMANDS_MOCK_MODE=false
PLAYFAB_PRODUCT_COMMANDS_TEST_ENABLED=true
PLAYFAB_PRODUCT_COMMANDS_LIVE_ENABLED=false
PLAYFAB_PRODUCT_COMMANDS_CONCURRENCY=4
```

라이브 쓰기가 필요하면 다음 값만 명시적으로 활성화합니다.

```dotenv
PLAYFAB_PRODUCT_COMMANDS_LIVE_ENABLED=true
```

환경변수 변경 후 컨테이너 재생성:

```bash
docker compose up -d --build
```

## 배포 권장 순서

1. 테스트 Title ID / Secret Key 설정
2. 라이브 Title ID / Secret Key 설정
3. `PLAYFAB_PRODUCT_COMMANDS_MOCK_MODE=false`
4. 테스트 쓰기만 활성화
5. 웹에서 테스트 서버 선택
6. 테스트 UID로 Dry Run
7. 테스트 서버 실제 명령 등록
8. 게임에서 `회수 → 지급` 처리 확인
9. CloudScript 완료 처리 후 해당 UserReadOnlyData 키가 삭제되는지 확인
10. 필요한 경우에만 라이브 쓰기 활성화
11. 라이브에서는 먼저 Dry Run 수행

## 장애 복구

### 잘못된 환경에 미리보기만 한 경우

실제 쓰기 전이면 영향이 없습니다. 환경을 바꾸고 새 미리보기를 생성합니다.

### 잘못된 환경에 명령을 실제 등록한 경우

1. 해당 환경 선택
2. 하단 현재 명령 조회
3. 요청 ID와 JSON 확인
4. 아직 게임에서 처리하지 않았다면 선택 키만 수동 삭제
5. 감사 로그 확인

### PlayFab 응답 유실

실패 UID 재실행을 사용합니다. 기존 요청 ID를 그대로 사용하므로 같은 명령이 이미 등록된 경우 중복 새 요청을 생성하지 않습니다.

### DataVersion 충돌

현재 명령을 다시 조회하고 새 미리보기를 생성합니다. 기존 병합 승인은 재사용하지 않습니다.

### 명령이 게임에서 처리되지 않음

1. 선택한 PlayFab 환경이 맞는지 확인
2. UserReadOnlyData에 `지급` 또는 `회수`가 존재하는지 확인
3. JSON 형식과 요청 ID 확인
4. 게임 버전이 UserReadOnlyData 명령 처리 로직을 포함하는지 확인
5. CloudScript Live revision과 함수 배포 상태 확인

### 게임 처리는 됐지만 키가 남음

1. SaveData 업로드 성공 여부 확인
2. `completeProductChangeCommand` 호출 로그 확인
3. 클라이언트가 전달한 요청 ID와 현재 명령 요청 ID 비교
4. 실제 세이브 반영 여부를 확인한 뒤 필요하면 운영자가 해당 키만 수동 삭제

## 검증

로컬:

```bash
npm run check
npm test
```

CI:

```bash
docker build -t steam-refund-cs:test .
```

추가로 컨테이너를 기동해 `/health` smoke test를 수행합니다.

주요 테스트 항목:

- UserReadOnlyData Server API만 사용
- 라이브/테스트 환경 라우팅 분리
- 라이브 환경 기본 선택
- 미리보기 환경 고정
- 환경 불일치 실행 거부
- UID별 요청 ID 분리
- 지급/회수 독립 유지
- UID별 기존 명령 병합 및 승인 보호
- DataVersion 충돌 중단
- 실패 재실행 요청 ID 유지
- Dry Run 쓰기 무호출
- 선택 키 수동 삭제
- Secret Key 비노출
