# Statistics

PlayFab 게임 로그를 집계해 Run 결과와 보스 처치 성과를 보여주는 사내 통계 시스템입니다. Company Portal을 직원 계정과 접근 권한의 단일 원본으로 사용합니다.

Portal 공통 워크스페이스 바, 서비스 전환 메뉴, 모바일 내비게이션과 `*.example.com` 공용 테마를 사용합니다. 정식 진입 경로는 `https://company.example.com/workspace/statistics`이며 기존 통계 상세 URL은 호환 주소로 유지합니다. 로그인 세션은 기본 7일이고 사용 중 자동 갱신됩니다.

프로필 사진·계정 이름은 Portal 공통 상단바만 렌더링합니다. 통계 초기 설정과 필터별 overview는 공통 읽기 세션의 독립 채널, 30초 관찰 제한과 단일 checked JSON transport를 사용합니다. HTML 로그인 응답·손상 JSON은 통계로 표시하지 않고 계정 범위 변경 뒤 늦은 응답은 폐기합니다. overview는 화면 적용 전에 요약·추이·결과·버전·차원·빌드/조합/룬·보스·스키마·처리 통계의 중첩 계약을 검증하며, 일부가 손상되면 이전 완료본을 유지합니다. 상세 경계는 `../../packages/contracts/statistics-reads.md`를 참고하세요. 화면 초기화 회귀 테스트는 `node --test test/ui-initialization.test.js`로 실행합니다. `node scripts/preview-ui.mjs`는 `http://127.0.0.1:19104`에서 합성 데이터로 전체 화면을 확인하는 로컬 전용 미리보기입니다. 운영 인증·API·저장소에는 연결하지 않으며 운영 서버로 배포하지 않습니다.

## 제공 기능

수동 갱신의 202는 HTTP 서버의 전송 성공이 아니라 집계 워커의 실제 접수 확인입니다. 실행 식별자 `publication.runId`와 진행/완료/실패는 구분하며 기존 한 시간 제한·관리자 강제 권한을 유지합니다. 접수 응답 미확정 상태에서는 같은 워커에 반복 요청하지 않습니다. 서버·worker는 같은 이미지로 배포해야 합니다. 실제 버튼은 공통 확인창·상태 안내와 계정/대상/집계 기준값 대조를 사용합니다. 갱신 전 context와 접수 뒤 status GET은 공통 읽기 세션의 독립 채널·30초 관찰 제한을 사용하고, POST만 별도 미확정 쓰기 경계로 남깁니다. 미확정 시에는 GET 상태 확인만 제공합니다. 계약/검증과 남은 범위는 `../../packages/contracts/statistics-refresh.md`를 참고하세요.

통계의 날짜/검색 필드, 기간/분석 종류/정렬/설명/상세 이동 버튼과 표는 회사 공통 primitive를 사용합니다. 진행도·완성 조합·보스 연계 checkbox도 공통 선택·포커스·비활성 상태와 18px 입력 크기를 사용합니다. 작은 정렬·설명 버튼도 동일한 상태 색상을 사용하며, 가로로 긴 표는 본문이 아닌 표 내부에서 스크롤합니다. 완성 조합 전용 옵션은 해당 분류에서만 표시됩니다. 상세 계약과 검증 범위는 `../../packages/contracts/statistics-controls.md`를 참고하세요. 강제 갱신과 접수/완료/후속 조회는 공통 확인·상태·작업 세션에 연결되어 있습니다.

상단 집계 시각은 공통 상태 pill로 표시하며 데모·확인 중·집계 중·완료·오류를 의미 tone으로 구분합니다. 실제 집계와 갱신 API의 상태 판정은 통계 앱이 유지합니다.

- 활성 플레이어, 전체 Run, 클리어율, 사망률, 보스 처치 수
- 일별 활성 플레이어·Run·클리어 추이
- `Clear`·`Dead`·`Fail` 결과 분포
- 플레이 시간 평균·중앙값·P90과 표본 수
- 보스별 처치 수, 처치 플레이어, 전투 시간 평균·중앙값·P90
- 캐릭터·무기·펫·노드·스킬·유물·완성 조합별 선택률, 클리어율, 표본 수준과 전체 평균 대비 성과
- 캐릭터 상세의 버전별 선택률·클리어율·출정 추이와 자주 함께 사용한 장비·노드·스킬·유물·완성 조합
- `RunId`가 있는 보스 처치의 해당 Run 클리어 전환율
- 버전·플랫폼·게임 모드 필터와 라이브 서버 전용 집계
- 요약 대시보드와 `/results`, `/builds`, `/builds/detail`, `/bosses` 상세 분석 화면
- `/users`에서 계정 연동 UID를 기간 내 한 번만 세는 캐릭터·스킨·무기·펫·스킬·유물·노드 사용률과 챕터/단계 도달·이탈 지표
- 캐릭터 상세의 `죄악` 탭에서 Run 로그의 `SinPoints` 7칸 배열(분노·색욕·나태·탐욕·폭식·교만·질투) 분배를 캐릭터 출정 기준으로 집계
- 캐릭터·스킬·유물·보스 코드에 대응하는 게임 이미지 썸네일
- 이름·표본 수·클리어율·로그 출처·보스 랭크·전투 시간 등 화면별 세부 필터
- 상단에서 시스템·라이트·다크 테마 전환 및 브라우저별 선택값 보관
- Azure Blob Storage의 PlayFab Parquet 로그를 별도 워커가 날짜 파티션 단위로 증분 수집
- 정규화 사실 테이블과 일별 사전 집계를 ClickHouse에 저장하고 웹 요청은 완료 revision만 즉시 조회
- 최근 90일 분석 데이터만 ClickHouse에 유지하고 Azure 원본 로그는 기존 컨테이너에 영구 보관
- 서버가 매일 오전 6시(KST)에 원본을 증분 동기화하며 모든 화면 필터는 같은 사전 집계를 조회
- 갱신 중에도 읽기 전용 연결은 직전 완료 데이터를 계속 제공하고 화면에 마지막 전체 집계 완료 시각 표시
- 모든 사용자의 수동 갱신 버튼과 완료 후 1시간 서버측 제한, `admin`·`master` 계정의 경고 확인 후 강제 갱신
- 최초 백필·신규 로그 집계 진행률 표시와 처리 완료 Blob manifest 영속화
- Company Portal `statistics.access` SSO

## 버전별 로그 계약

`0.772.0`은 개선 로그 계약의 시작 버전입니다. 현재 계약은 `LogSchemaVersion = 6`이며 라이브 PlayFab에 아래 경계 이벤트를 전송합니다.

- `run_start`: Run 시작 시 한 번 전송
- `boss_encounter`: 보스 조우마다 한 번 전송
- `boss_kill`: 보스 처치마다 전송
- `run_end`: Run 종료 시 한 번 전송 (`battle_result`도 과거 호환용으로 수집)

`run_end`의 주요 필드는 `LogSchemaVersion`, `RunId`, `Version`, `Platform`, `Mode`, `ModeLevel`, `IsClear`, `IsDead`, `ResultType`, `PlayTimeMs`, 캐릭터·무기·펫·스킬·유물·룬 등의 빌드 스냅샷입니다. `EquippedRunes`는 무기 슬롯별 일반룬·고유룬과 등급, 색상, 옵션 ID를 담으며 무기 상세의 룬 채택률·클리어율·조합 통계에 사용합니다. `boss_encounter`와 `boss_kill`은 같은 `EncounterId`를 사용하며 보스 식별자와 해당 시점의 빌드 스냅샷을 함께 보냅니다. `boss_kill`에는 `FightDurationMs` 및 조우 시점 이후의 `BossCombatSummary`, `BossTotalDamage`, `BossSkillUseCounts`가 추가됩니다.

결과는 `IsClear`가 참이면 `Clear`, 아니고 `IsDead`가 참이면 `Dead`, 둘 다 아니면 `Fail`로 해석합니다. 밀리초 필드를 우선 사용하며 과거 초 단위 필드는 호환용으로 읽습니다. 시간 값 `-1`은 미기록이므로 통계 표본에서 제외합니다.

게임 버전은 `숫자.숫자.숫자`와 정확히 일치하는 값만 운영 통계에 포함합니다. `0.772.0`은 포함하지만 `0.772.0.1`, `0.772.0-test`, `0.772.0_dev`처럼 세 번째 숫자 뒤에 값이 더 붙은 빌드는 테스트 버전으로 간주해 제외합니다. 버전 필드가 없던 구버전 로그는 이름 기반 호환 통계를 위해 계속 포함합니다.

`0.772.0` 이전 로그는 `RunId`, 스키마 버전, 각종 ID가 없을 수 있어 `legacy`로 구분합니다. 이때 `Character`, `Weapon`, `SubWeapon`, `EquipSkill`, `EquipArtifact`, `Boss`의 한국어 이름을 정규화 키로 사용합니다. 스킬·유물 이름이 현재 마스터와 일치하면 개선버전의 ID 키에 합쳐 과거와 현재 통계를 연속해서 볼 수 있습니다. 이름만 있는 보스는 별도의 레거시 키로 집계하며, `RunId`가 없는 이벤트끼리는 같은 Run이라고 추정해 연결하지 않습니다. `0.772.0` 이상인데 스키마 버전 또는 `RunId`가 빠진 로그는 `v2_incomplete`로 표시해 배포 후 누락을 확인할 수 있습니다.

전체 Run은 `run_end`와 과거 `battle_result` 수, 클리어율은 Clear 결과 수를 전체 Run으로 나눈 값입니다. 보스 조우 대비 처치율은 동일한 `EncounterId`로 연결된 `boss_kill ÷ boss_encounter`로 계산합니다. 구버전 처치 로그는 처치 횟수와 처치 조합에는 포함하지만 조우 분모가 없으므로 처치율 계산에서는 제외합니다. 공통 필터의 `1챕 중간보스 이후`는 Run 종료 시점의 도달 지점을 사용합니다. 스킬은 `EquipSkillIds` 또는 `BuildSnapshot.EquippedSkills`, 유물은 `EquipArtifactKeys` 또는 `BuildSnapshot.EquippedArtifacts`를 집계 키로 사용합니다. GA4 데이터는 현 통계 시스템에서 사용하지 않습니다.

동일 PlayFab `EventId`는 한 번만 집계합니다. `EventId`가 없으면 원본 파일·행·시각·플레이어·이벤트·payload로 안정적인 수집 ID를 만들어 중복을 방지합니다. 저장 시각은 UTC, 화면의 일자 구분은 KST를 사용합니다.

## 원본 로그 및 분석 저장 구조

원본 PlayFab Parquet는 기존 Azure 로그 컨테이너에서 수정하거나 삭제하지 않습니다. 장기 검색과 재처리가 필요할 때의 단일 원본이며 영구 보관합니다. 빠른 통계 조회용 ClickHouse 데이터만 `STATISTICS_RETENTION_DAYS`(기본 90일) 뒤 TTL로 자동 삭제합니다.

`statistics-worker`는 `battle_result`/`run_end`, `boss_encounter`, `boss_kill`을 읽어 아래 사실 테이블과 일별 집계로 전개합니다.

- `analytics_events`: 출정 결과·보스 조우·보스 처치 사실
- `analytics_entities`: 캐릭터·스킨·무기·고유룬·펫·스킬·유물·노드·조합
- `analytics_boss_entities`: 보스 조우·처치 시점의 빌드 구성요소
- `analytics_daily_*`: 날짜·버전·버전 계열·모드·단계·중간보스 도달 조건별 사전 집계
- `analytics_daily_players`: 해시 처리한 계정 UID별 출정 수·최대 챕터/단계·처음 관측된 출정 시간
- `analytics_daily_user_entities`: 계정 UID를 중복 제거한 항목별 사용자 집계 상태
- `analytics_publication`: 화면에 공개된 원자적 집계 revision과 마지막 성공 시각

화면 요청에서는 Azure Parquet나 JSON 원문을 읽지 않고 완료된 ClickHouse revision만 조회합니다. 버전, `0.772.x` 버전군, 게임 모드, 최소 단계, 기간, 1챕터 중간보스 이후 조건은 독립 열로 필터링합니다. 목록은 서버 정렬·검색·페이지네이션으로 기본 50개만 전송하며, 고유 플레이어만 `uniqCombined64` 근사값을 사용합니다.

집계 중에는 기존 `ready` revision을 계속 제공합니다. 변경 날짜를 새 revision으로 집계하고 원본 건수와 출정·조우·처치 집계가 일치하는지 검증한 뒤에만 공개 revision을 한 번에 교체합니다. 최초 백필이 끝나기 전에는 유지보수 화면을 표시합니다. 기존 `/app/data/analytics-index-v1.sqlite`는 첫 정상 발행과 검증이 끝날 때까지 읽기 전용 이관 원본이자 롤백 자료로 보존합니다.

서버는 매일 KST 오전 6시(`STATISTICS_DAILY_REFRESH_HOUR_KST`)에 증분 수집합니다. 이후 실행은 최근 `STATISTICS_SYNC_LOOKBACK_DAYS`(기본 2일) Azure 파티션만 확인합니다. 모든 사용자가 수동 갱신을 요청할 수 있지만 성공 후 1시간 동안 제한하며, `admin`·`master`만 경고 확인 후 강제 갱신할 수 있습니다.

빌드 집계에는 캐릭터·무기·펫·스킬 6칸·유물 6칸과 선택적인 30레벨 노드가 포함됩니다. 노드·노드 조합·노드 포함 전체 조합은 캐릭터별 마지막 `110~119` 노드를 실제 장착한 완성 트리만 집계하며, 중간까지만 찍은 출정은 분모와 결과에서 제외합니다. 0.772.0 이후 `Collections` ID는 `lib/collection-data.js`의 컬렉션 마스터와 연결되어 조합 상세 페이지에서 활성 컬렉션, 시너지 효과, 버전별 클리어율을 표시합니다. 구버전 보스 전투 시간은 타이머 기준이 일관되지 않아 신뢰 시간에서 제외하고, 0.772.0 이후 RunId와 밀리초가 함께 기록된 표본만 전투 시간 및 보스 이후 클리어율에 사용합니다.

유저 지표는 `EntityLineage_master_player_account`가 있는 계정 연동 로그만 사용하며 원본 UID는 저장하지 않고 `UInt64` 해시만 저장합니다. 사용률은 `해당 항목을 한 번 이상 사용한 고유 계정 수 ÷ 조회 기간 전체 고유 계정 수`입니다. 챕터 도달률은 기간 내 최대 Chapter/Stage, 단계 이탈은 기간 내 최고 ModeLevel을 사용합니다. 첫 출정 시간은 앱 실행 세션이 아니라 조회 기간 안에서 처음 관측된 Run의 플레이 시간이며, 기간 내 Run이 한 번뿐인 사용자를 이탈로 표시합니다. 초기 이탈을 보존하기 위해 `/users`는 `1챕터 중간보스 이후` 필터를 적용하지 않습니다.

### 보존 설정

```dotenv
STATISTICS_RETENTION_DAYS=90
STATISTICS_SYNC_LOOKBACK_DAYS=2
```

보존 기간 변경은 다음 워커 시작 때 모든 ClickHouse 사실·집계 테이블의 TTL에 반영됩니다. 기간을 줄이면 백그라운드 merge 과정에서 만료 파티션이 정리됩니다. Azure 원본 보존 기간에는 영향을 주지 않습니다.

PlayFab 타이틀에서 [Event Partitioning private preview](https://learn.microsoft.com/en-us/gaming/playfab/data-analytics/export-data/event-partitioning-overview)를 사용할 수 있다면 `battle_result`, `boss_kill`을 `Partition in Data Connections`로 지정하는 것이 권장됩니다. 이 설정은 이후 이벤트를 Blob의 `Partitioned` 하위 경로에 별도 저장해 원본 스캔량을 크게 줄이지만 기존 Blob은 백필하지 않습니다. 실제 파티션 경로가 생성되면 해당 경로를 우선 읽도록 연동하고, 과거 데이터는 현재 증분 캐시로 한 번만 백필합니다. [Fabric KQL 또는 Azure Data Explorer Data Connection](https://learn.microsoft.com/en-us/gaming/playfab/data-analytics/export-data/data-connection-overview)을 추가하는 경우에도 신규 이벤트부터 유입되므로 과거 데이터 백필은 별도로 필요합니다.

## 회사 통합

Statistics는 자체 `.env`의 라이브 `PLAYFAB_LIVE_TITLE_ID`와 Azure Blob 설정만 사용하며 테스트 Title은 읽지 않습니다. 로그 조회 구조는 CS와 같지만 설정 파일과 Secret은 서로 공유하지 않습니다. Company SSO 공유키의 값은 Portal과 같아야 하며 각 서비스의 `.env`에 별도로 보관합니다.

1. Company Portal에서 `statistics.access` 권한을 부여합니다.
2. Portal의 `STATISTICS_BASE_URL`을 통계 서비스 주소로 지정합니다.
3. Portal과 Statistics의 `COMPANY_SSO_SHARED_SECRET`를 동일하게 설정합니다.
4. Portal이 `aud=statistics`인 1분짜리 토큰을 `/auth/sso/callback`에 POST합니다.
5. Statistics는 토큰과 권한을 검증하고 기본 15분짜리 HttpOnly 세션을 발급합니다.

운영 환경에서는 SSO 공유키가 없으면 서버가 시작되지 않습니다. 개발 환경에서 공유키가 없을 때만 인증 없는 데모 모드로 실행됩니다.

## 실행

```powershell
Copy-Item .env.example .env
docker compose up -d --build
```

기본 로컬 바인딩은 `127.0.0.1:3010`입니다. `statistics-web`, `statistics-worker`, `statistics-clickhouse`가 분리되어 집계 작업이 웹 요청을 멈추지 않습니다. 웹은 인증된 워커 상태/접수 API를 통해 실제 갱신 가능 여부를 표시합니다. `STATISTICS_DAILY_REFRESH_HOUR_KST`는 완료 통계를 매일 발행할 KST 시각이고, 실패한 자동 작업은 15분 간격으로 최대 3회 재시도합니다. `STATISTICS_RETENTION_DAYS`는 ClickHouse 분석 데이터 보존 기간입니다.

초기 이력 이전과 Azure 증분 적재는 `AZURE_PLAYFAB_LOG_CONCURRENCY`로 병렬도를 조절하며 기본값과 안전 상한은 6입니다. 각 날짜가 끝날 때 체크포인트를 남기므로 워커 재시작이나 병렬도 조정 뒤에도 완료 날짜는 다시 처리하지 않습니다.

## 검증

```powershell
npm run check
npm test
docker build -t company-statistics:local .
```

## 통합 워크스페이스 UI (2026-09-07)

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
