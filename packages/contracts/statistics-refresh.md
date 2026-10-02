# 통계 갱신 접수와 집계 결과

## 서버와 워커 경계

`app-server.js`의 기존 `/api/analytics/refresh` 및 `/api/admin/analytics/refresh` POST는 `respondToRefresh`를 함께 사용한다. 회사 게이트웨이의 현재 세션/서비스 접근과 내부 Basic 인증은 유지한다. `force`는 서버의 현재 admin/master만 허용하며 클라이언트가 보낸 `x-company-*` 값은 게이트웨이가 제거한다.

라이브 갱신은 별도 집계 워커에 요청 번호(UUID v4), 명시적인 force/cooldown 값과 관측한 집계 revision을 보낸다. 레거시 단일 프로세스 경로는 `createRefreshBridge`의 IPC 확인 응답을 사용하고, 운영 ClickHouse 분리 경로는 같은 Compose 네트워크의 인증된 `/state`·`/refresh` HTTP를 사용한다. 어느 경로도 IPC send나 HTTP 전송 성공만으로 사용자에게 접수를 알리지 않는다. 실제 큐 소유자가 기준값·진행 여부·1시간 제한 검사를 통과하고 정확한 요청 번호를 반환한 경우만 202를 보낸다. 강제 요청도 이미 실행 중인 집계를 새 실행처럼 접수하지 않는다.

- `202 {ok:true, acceptance:"accepted", publication}`: 해당 요청이 큐에 실제 접수됨. 완료가 아니다.
- `publication.runId`: 요청 번호와 일치하는 **실행 식별자**. 자동 작업은 자체 UUID를 만들고 ClickHouse publication 행에 기록한다. 재시작 뒤에도 마지막 실행을 식별할 수 있지만 영구 작업 큐나 재요청 멱등성 키는 아니다.
- publication의 상태/시작·완료·데이터 시각/진행 카운터/문자열 및 `inProgress` 일관성을 확인한다. 같은 worker 인스턴스와 정확한 요청 번호의 전체 응답만 인정한다.
- 큐 revision은 실행 번호·상태·시작·완료·데이터 시각을 해시한다. 진행 카운터와 다음 자동 예약 시각은 포함하지 않는다. 이 값은 인증이나 영구 DB CAS가 아니다. 실제 큐 소유자의 동기 구간에서 대조한다.
- `403`: 서버 관리자 조건 미충족. `409`: 다른 갱신/접수 진행 또는 이전 집계 기준값 변경. `429`: 실제 워커의 마지막 완료 시각에 따른 제한이며 `retryAt`/`canForce`를 기존 형식으로 전달한다.
- 전송 오류·15초 접수 확인 timeout·워커 연결 해제·불완전 응답은 접수 결과 미확정이다. 같은 워커에 새 수동 요청을 자동 재전송하지 않는다. 정확한 늦은 응답으로 서버 내부 잠금을 해소하거나 워커가 교체될 때까지 유지한다. 이미 끝난 HTTP 응답을 다시 성공으로 바꾸지 않는다. 불명확한 내부 실패 메시지는 사용자 응답에 노출하지 않는다.

조회 API는 기존 publication/완료본을 유지한다. 접수 직후 실제 집계가 실패하면 runId는 유지되고 status가 error가 되며 마지막 완료 시각·데이터 기준을 새 성공으로 바꾸지 않는다. 워커의 주기 상태 전달과 접수 응답은 별개의 메시지다. 서버가 가짜 queued 상태로 주기 상태를 덮어쓰지 않는다. 운영 웹은 워커 상태를 5초 간격으로 확인해 실제 연결 여부와 publication을 표시하며, 워커와 분리되어 있다는 이유만으로 수동 갱신을 비활성화하지 않는다.

매일 KST 오전 6시 자동 작업이 실패하면 15분 간격으로 최대 3회 재시도하고, 이후에는 다음 일일 실행을 예약한다. ClickHouse의 대용량 `INSERT … SELECT`는 Node 기본 fetch의 응답 헤더 제한에 의존하지 않고 명시적인 쿼리 timeout을 적용한 HTTP 요청으로 실행한다. 결과가 불명확한 쓰기 명령은 중복 적재를 피하기 위해 자동 재전송하지 않는다.

데모 경로는 기존 인프로세스 집계 API 호환을 유지하며 라이브 워커 접수/원본 Azure 처리의 증거로 사용하지 않는다. 운영 배포 시 app-server와 worker를 같은 앱 이미지로 함께 교체해야 한다. 구형 worker에는 새 접수 계약이 없어 확인 timeout이 발생한다.

## 압축 조회 캐시 실패 처리

로그가 없어서 원본 날짜 캐시 자체가 없는 날은 빠른 조회 파일도 생성하지 않으므로 집계에서 건너뛴다. 원본이 존재하는 날짜의 빠른 조회 파일 누락이나 GZip CRC 손상은 빈 결과로 취급하지 않는다. `readGzipLines`의 pipeline 오류를 집계 실패로 전달하여 읽기 스트림의 미처리 error가 워커 프로세스를 종료하지 않게 한다. JSON 숫자 문자열과 줄 원문은 그대로 유지한다.

## 검증과 남은 연결

- `refresh-bridge.test.js`: 전송/응답 구분, 전체 ACK/worker 식별, 중복 요청, timeout·전송·연결·잘못된/미확정 응답, 늦은 결과와 워커 교체, 실제 로컬 HTTP의 202/429/403.
- `refresh-queue.test.js`: 실제 집계 코어와 격리 임시 SQLite/캐시·합성 Azure 입력. 동시 실행·초기 디스크 기준값·한 시간 제한 및 접수 뒤 ready/error를 확인한다.
- `read-gzip-lines.test.js`: ENOENT/CRC 오류 전파, 줄 원문 보존, 조기 읽기 종료 후 재사용.
- `refresh-runtime.test.js`: 실제 app-server/analytics-worker 엔트리포인트와 fork IPC, 내부 인증·권한/기간 제한·강제 접수·중복 거부·마지막 완료본 보존. `--import` 테스트 로더가 모든 외부 fetch를 가로채며 허용하지 않은 요청은 실패한다. 운영 데이터·자격 증명을 사용하지 않는다.
- 기존 실제 SSO 게이트웨이 테스트는 위조한 계정/역할 헤더로 강제 권한을 얻을 수 없는지도 검증한다.

## 실제 갱신 UI 연결

`public/refresh.js`가 실제 상단 갱신 버튼을 소유한다. 확인창은 `CompanyDialog.confirm`, 상태·조회 재확인은 `CompanyState`, 문서 내 확인/쓰기 조정은 `CompanyForm.createSession`을 사용한다. 이는 비동기 JSON job API이며 native 폼 저장인 것처럼 `CompanyForm.attach`로 감싸지 않는다. 기존 app.js의 confirm/강제 재시도/독립 publication 폴링 루프는 제거한다.

갱신 전 context GET은 공통 `CompanyReadSession`의 `statistics-refresh-context`, 접수 뒤 상태 GET은 `statistics-refresh-status` 채널을 사용한다. 두 읽기는 30초 관찰 제한·동일 채널 교체·최신 ticket 판정과 계정/문서 해제를 공통 계층에 맡긴다. 같은 checked JSON transport가 same-origin/no-store/manual redirect와 Content-Type·JSON 및 JSON 소비 뒤 취소를 확인한다. 쓰기 시작은 진행 중인 두 GET을 취소하지만 서버 작업을 롤백한다는 뜻은 아니다.

`GET /api/analytics/refresh-context?expectedUserId=...`는 현재 계정/역할, live/demo·Title, publication revision/상태·서버 시각·worker 가용/접수 대기를 반환한다. 계정 ID는 문자열이며 번호 정밀도를 바꾸지 않는다. 일반 직원의 cooldown에는 강제 확인창을 제공하지 않는다. 관리자도 확인창을 통해 의도를 승인하며 확인 중 상태 변경은 실제 워커가 거부한다.

실제 POST는 같은 URL에서 전용 Accept(`application/vnd.company.statistics-refresh+json`)와 JSON 및 `X-Requested-With`로 opt-in한다. `requestMutation`만 별도 AbortController와 timeout race를 소유한다. 전송 뒤 timeout이나 연결 단절은 서버 롤백으로 간주하지 않고 미확정으로 잠그기 때문이다. protocol/requestId/expectedUserId/expectedRole/mode/titleId/expectedRevision/force를 보낸다. 서버는 8KB 한도와 타입·현재 계정/역할·대상·force 인가를 검증하고 기준값을 그대로 큐에 전달한다. 사용자 입력을 서버가 새 기준값으로 바꿔 요청을 승인하지 않는다. CORS를 허용하지 않으며 cross-site 및 simple form 요청을 거부한다. 레거시 API의 기존 인증/출처 경계까지 새로 대체했다고 주장하지 않는다.

클라이언트/worker가 같은 `public/refresh-contract.js`의 publication 검증을 사용한다. 클라이언트는 전체 enhanced 응답의 계정·역할·대상·UUID·이전 revision·force 및 runId/진행 상태를 대조한 뒤 접수 사실을 표시한다. 확인 취소는 POST 0회다. 확실한 409/422/429 거부는 새로운 조회/확인으로 재개할 수 있지만 timeout·불완전 성공/서버 응답·연결 실패는 문서의 반복 쓰기를 잠그고 GET만 제공한다. GET 성공만으로 미확정 잠금을 풀지 않는다.

공통 계정/권한 scope 변경과 non-persisted pagehide에서 확인창·접수/조회 관찰을 해제한다. Abort를 무시하는 fetch/JSON도 공통 읽기 관찰 경계 밖에서 늦게 반영되지 않는다. 쓰기를 시작하면 이전 통계 GET을 무효화하고, 계정 변경 시 기존 통계 본문을 숨겨 이전 데이터가 재표시되지 않게 한다. 별도 일반 필터 GET의 전체 payload 검증·모든 로딩 시각 요소의 공통화까지 완료한 것은 아니다.

공통 scope 이벤트보다 먼저 context 응답의 계정/역할 불일치가 관측되어도 이전 화면을 무효화한다. 접수 대기 중 필터 수정은 지우지 않고 마지막 선택을 보관했다가 접수 관찰 종료 후 GET으로 적용한다. 실제 조회를 보내지 않은 동안 로딩 overlay를 남기지 않으며 필터 수정으로 POST를 반복하지 않는다.

접수 후 runId를 추적해 running/ready/error를 구분하며 3초 간격 상태 읽기는 쓰기를 재실행하지 않는다. 조회 실패는 명시적 GET 재확인을 제공한다. 완료 후 선택 필터의 통계를 다시 읽되 runId·ready·publishedAt이 확인된 완료본과 일치할 때만 화면 갱신 성공을 표시한다. 조회 실패/불일치는 집계 완료와 분리하고 읽기 재확인만 제공한다. 이전 poll/overview의 늦은 응답과 새 요청의 잠금 해제는 공통 ticket과 쓰기 lease로 구분한다.

`statistics-refresh.spec.mjs`는 실제 앱 HTML/JS/CSS·공통 생성 자산과 합성 HTTP로 PC/모바일·실제 light/dark, Escape/포커스, 관리자 force와 직원 cooldown, 접수/완료·조회 실패, conflict/미확정·timeout·계정/페이지 해제 및 취소 불가능한 늦은 JSON을 검증한다. `refresh-intent.test.js`와 실제 서버/worker 테스트는 enhanced HTTP와 큐 연결을 별도로 확인한다. 운영 배포/부하, 영구 작업 저장·멱등성, 모든 통계 데이터 조회 계약은 여전히 별도 범위다.
