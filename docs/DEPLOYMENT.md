# CI 증거와 서비스별 배포·롤백

## 현재 상태

2026-09-14부터 IAP 상품 관리도 일곱 번째 정식 서비스로 포함한다. `apps/iap`가 빌드·검증·GHCR 게시의 기준이며, 운영 전환 시 기존 `product-upload-product-upload-1` 컨테이너 식별자와 PostgreSQL `product-upload_iap-db` 볼륨을 유지한다. connector 설정은 저장소 밖 `C:/dev/docker/private/iap`에서 읽고 비밀값은 Git이나 검사 출력에 포함하지 않는다. 아래 과거의 “여섯 서비스” 기록은 당시 검증 범위를 설명하는 이력이다.

루트 `.github/workflows/verify.yml`은 검증 워크플로다. `.github/workflows/publish-images.yml`은 현재 main의 성공한 전체 검증 run과 정확한 artifact를 다시 확인하고, 등록된 일곱 서비스를 각각 빌드·격리 기동한 동일 로컬 이미지를 GHCR에 게시하는 수동 workflow다. 아직 IAP의 GHCR 최초 게시는 실행하지 않았고 운영 배포 job·승격 승인·자동 롤백 실행기는 없다. `tooling/deployment-candidate.mjs`는 실제 게시 묶음에서 digest 고정 Compose override만 만들고, `tooling/deployment-preflight.mjs`는 실제 Docker와 후보 Compose의 데이터 연결을 읽기 전용으로 대조한다. 두 도구 모두 운영을 실행하거나 승인하지 않는다. IAP 로컬 운영 컨테이너의 모노레포 전환은 백업 후 완료했지만, 이는 GHCR 게시·digest 승격 자동화 완료를 뜻하지 않는다.

비공개 원격은 `company-org/company-workspace`로 확정됐다. 배지 경쟁 조건을 수정한 main `5371b52fdfcca31bb8fd92bafb0aaf95d24d026c`의 전체 검증 run `34703332199`는 16개 job과 브라우저 1,226개, artifact 8개가 성공했고 annotation은 0개였다. 그러나 조직의 Free 요금제에서는 비공개 저장소의 branch protection과 repository ruleset이 지원되지 않아 `required` check·PR·관리자 우회 금지를 적용하지 못했다. 같은 요금제에서는 비공개 저장소의 GitHub Artifact Attestation도 지원되지 않으므로 게시 기록은 `provenanceSigned:false`를 유지한다. 저장소를 공개로 바꾸지 않으며, 요금제 지원 전에는 성공 run이나 registry digest만으로 병합 차단·서명 출처를 주장하지 않는다. 기존 여섯 앱의 DB와 운영 checkout을 보존한다.

## 수동 이미지 게시 경계

`Publish Verified Images`는 자동 push·PR·schedule로 실행되지 않는다. 수동 실행 시 GitHub API에서 현재 `main` SHA와 동일한 최신 성공 `Workspace Verification` main push run을 찾고, 그 run/attempt의 `workspace-verification-*` artifact를 내려받아 receipt·이미지 검증 묶음·현재 workflow/policy hash를 다시 대조한다. 현재 main이 아직 검증 중이거나 실패했거나 다른 commit의 과거 성공만 있으면 게시하지 않는다.

각 matrix는 `ghcr.io/company-org/company-workspace-<service>:<40자리 commit>`만 빌드하며 운영 비밀값·DB·볼륨·network 없이 `container-smoke.mjs`로 기동한다. 같은 로컬 태그를 push한 뒤 반환된 `repository@sha256:...` 하나를 기록한다. 일곱 서비스와 source/publish job이 모두 성공해야 게시 묶음을 만들며, 누락·중복·다른 run/source·가변 태그·digest 부재는 실패한다. 태그는 조회 편의용이고 실제 후속 배포 입력은 기록된 digest여야 한다.

현재 조직 요금제에서는 비공개 Artifact Attestation을 생성할 수 없어 게시 묶음의 `provenanceSigned`는 false다. GHCR 게시 성공은 이미지 digest와 검증 commit의 연결 근거지만 암호학적 서명, 배포 승인, 백업·스키마 호환, 실제 SSO/업무 검증이나 롤백 성공을 대신하지 않는다. 서명 provenance는 Enterprise Cloud 전환 또는 별도로 승인된 비공개 서명 키/서비스가 확정된 뒤 추가한다.

2026-09-12 읽기 전용 재점검에서 실행 중인 여섯 서비스와 모노레포 Compose 후보의 프로젝트·mount·loopback 포트·network는 모두 일치했다. 후보별 차이는 게시된 불변 이미지 digest가 없다는 한 항목이었다. 이 시점 결과는 이후 Docker 상태 변경을 잠그지 않으므로 배포 직전에 다시 검사하며, 경계 일치만으로 배포를 승인하지 않는다.

2026-09-14부터 일곱 서비스의 운영 Compose 작업 디렉터리와 비밀 환경 파일은 `C:/dev/docker/company-workspace/apps/<service>`가 기준이다. Schedule은 `apps/portal/.env`를 공유하고 Sheet는 `apps/portal/.env`와 `apps/sheet/.env`를 순서대로 사용한다. Sheet 런타임 데이터는 `apps/sheet/data`, Google 서비스 계정 파일과 IAP connector 설정은 모노레포 밖의 `C:/dev/docker/private`에 둔다. `.env`와 Sheet 런타임 데이터는 Git에서 제외하며 파일 내용은 배포 로그에 출력하지 않는다. 기존 일곱 개별 checkout은 `C:/dev/docker/쓰레기통/legacy-company-folders-20260914-1548`로 이동했으므로 새 배포가 해당 경로를 다시 참조하거나 clone해서는 안 된다.

## 필수 CI 검사

`tooling/verification-policy.json`은 shared-ui, node-apps, dotnet-apps, frontend-apps, integration, images, browser의 필수 명령 및 서비스 matrix를 정의한다. `npm run check:ci`는 워크플로와 이 정책의 일치를 검사하며 루트 `npm run check`에 포함된다.

집계 job `required`는 `always()` 조건으로 실행해 웹·서버 검증 일곱 영역과 Android 검증을 합친 정확히 여덟 dependency의 결과가 모두 `success`인지 검사한다. 빈 결과, 빠진 job, 예상 밖 job, 실패·취소·건너뜀·잘못된 응답은 실패다. 일부 job의 성공만으로 통과시키지 않는다. 성공 기록 업로드 파일이 없으면 집계도 실패한다.

shared-ui/node-apps/frontend-apps는 루트와 등록된 Node 앱의 온라인 npm audit를 포함한다. 개발·선택 의존성도 검사하며 low 이상 보고와 조회 장애는 통과시키지 않는다. 시트는 build 뒤 실제 생성 서버의 격리 runtime 검사도 필수다. images job은 일곱 이미지를 각각 빌드한 뒤 테스트 전용 설정·임시 컨테이너·loopback 임의 포트로 Portal/Leave의 `/health`, Schedule/Sheet/IAP의 `/api/health`, CS/Statistics의 `/health`가 성공하는지 확인하고 자신이 만든 정확한 컨테이너만 정리한다. 운영 환경 파일·비밀값·데이터 볼륨·운영 네트워크는 사용하지 않는다. 이는 해당 실행 시점의 npm 보고와 격리 기동 증거이지 모든 보안 문제 부재나 운영 배포 성공을 보증하지 않는다.

로컬에서 이미 빌드한 한 서비스를 같은 방식으로 확인할 때는 `node tooling/container-smoke.mjs --service <서비스> --image <이미지:태그>`를 사용한다. 서비스와 이미지 외 인수, 임의 이미지 문자열, 비-loopback 또는 복수 포트 응답은 거부한다.

검사기는 이 저장소의 제한된 단일 행 YAML 작성 형식을 검증한다. 범용 YAML 파서나 모든 악의적 우회를 증명하는 보안 도구가 아니다. 워크플로 형식, 정책, 검증 코드의 변경을 함께 리뷰하며, 명령 삭제·조건부 생략·matrix 축소 등의 변이 테스트를 유지한다. 정책 파일 자체의 변경도 검사 범위 변경이다.

원격 확정 후에는 실제 실행에서 표시되는 집계 check 이름과 제공자를 확인해 보호 규칙의 필수 검사로 등록해야 한다. 직접 push와 관리자 우회, 보호 규칙 변경 권한까지 별도로 검토한다. YAML이 있다는 이유만으로 병합이나 수동 배포가 차단된다고 보고하지 않는다.

## 성공 기록의 의미와 한계

성공한 집계는 `workspace-verification-<runId>-<attempt>` artifact에 JSON 한 개를 업로드한다. JSON에는 저장소, 정확한 commit/tree, 실행 ID/시도, event/ref, workflow ref와 해시, 정책 해시, 여덟 검사 결과가 들어간다. 같은 실행 시도의 파일을 덮어쓰지 않는다.

각 images matrix 실행은 `image-verification-<service>-<runId>-<attempt>` artifact도 업로드한다. JSON에는 서비스, 같은 commit/tree/run, 정확한 검증 태그, Docker의 content-addressed 로컬 image ID, 플랫폼과 존재하는 registry digest가 들어간다. 기록 생성 전 checkout이 달라졌거나 dirty이면 실패하고, 파일이 없으면 업로드도 실패한다. 현재 로컬 빌드는 보통 registry digest가 없으며 이 사실을 빈 배열로 명시한다.

집계 job은 gate 영수증을 만든 뒤 같은 run/attempt 이름의 서비스 image artifact를 `artifacts/image-input`으로 병합한다. `image-verification-set.mjs`는 정확한 서비스 파일, 현재 workflow/policy hash와 여덟 job 성공, repository/commit/tree/run/attempt 및 이미지별 불변 ID·플랫폼·digest를 교차 확인한다. 결과 `workspace-image-verification-set-v1`은 원본 영수증과 각 입력 record의 SHA-256을 포함해 같은 업로드 artifact에 둔다. 다른 실행·commit의 파일 섞기, 누락/중복 서비스, mutable ID와 손상된 digest는 실패한다.

- `scope`는 항상 `ci-verification-only`, `deploymentApproved`는 항상 `false`다.
- PR 기록은 PR merge commit에 대한 검사다. 실제 main commit의 운영 배포 증거로 재사용하지 않는다.
- 이 JSON은 전자서명이나 GitHub attestation이 아니다. `GITHUB_ACTIONS=true`도 진위 증명이 아니다. 사용자가 제출한 파일이나 로컬에서 생성한 JSON을 신뢰하지 않는다.
- 배포 도구는 확정된 저장소의 신뢰할 수 있는 GitHub API/실행에서 artifact를 가져와야 한다. run/attempt, workflow, event, main commit, 최종 conclusion, artifact 출처와 무결성을 서로 대조해야 한다. 오래된 성공 기록으로 최신 실패를 덮지 않는다.
- 현재 images job은 여섯 Dockerfile의 빌드와 각 이미지의 격리 기동/health 응답을 검사한다. 업무 의존성, 로그인, 권한, 데이터 보존을 확인하지 않으며 운영에 올릴 불변 이미지 digest를 게시하거나 이 기록에 연결하지 않는다. 동일 소스를 로컬에서 다시 빌드한 이미지까지 검사된 배포 산출물이라고 단정할 수 없다.
- 서비스별 image verification JSON도 전자서명·GitHub attestation·registry provenance가 아니며 `deploymentApproved`는 항상 false다. 신뢰된 실행에서 내려받더라도 기록된 로컬 image ID와 실제 배포 가능한 registry manifest가 연결되기 전에는 배포 입력으로 사용하지 않는다.
- 여섯 이미지 묶음의 `registryPinned`는 각 입력에 registry digest가 존재하는지만 뜻한다. true여도 출처 서명·신뢰된 artifact 조회·승격 승인·대상 환경 검증이 없으므로 `deploymentApproved`는 false다.
- 이미지 승격/출처 검증, 배포 승인, 원격 보호 규칙, 만료/재실행 정책은 후속 구현·설정 대상이다. 현재 기록만으로 자동 배포를 시작하지 않는다.

GitHub의 [dependency context](https://docs.github.com/en/actions/reference/workflows-and-actions/contexts) 및 [artifact 저장·공유](https://docs.github.com/en/actions/tutorials/store-and-share-data) 규약을 기준으로 실행 결과와 업로드 증거를 구분한다.

## 데이터 연결을 보존하는 배포 전 점검

아래 표는 **저장소에 있는 Compose 설정**이다. 실행 중 컨테이너의 연결 상태는 다음 절의 별도 읽기 전용 점검으로 확인했다. 두 근거를 혼동하지 않으며 배포 직전에 다시 조회해야 한다.

| 앱 | Compose 서비스 / 컨테이너 | 데이터 설정에서 주의할 부분 |
| --- | --- | --- |
| portal | company-portal / company-portal | 명시 이름 `company-portal-data`, `company-portal-data-keys` |
| leave | leave-manager / leave-manager | 명시 이름 `leave-manager-data`, `leave-manager-data-keys` |
| schedule | schedule / company-schedule | 명시 이름 `company-schedule-data` |
| cs | steam-refund-cs / steam-refund-cs | `refund-audit`의 실제 이름은 Compose 프로젝트에 의존 |
| statistics | game-statistics / statistics-web | 웹은 `statistics-worker`·`statistics-clickhouse`와 분리되며 `statistics-data`와 ClickHouse 볼륨의 실제 이름은 Compose 프로젝트에 의존 |
| sheet | sheet-control / sheet-control | `./data`와 자격 증명 파일 bind의 실제 경로를 확인 |

여섯 앱의 `apps/<app>`는 독립 Docker build context다. 디렉터리 이동만으로 CS/통계가 새 빈 볼륨에 연결되거나 시트가 다른 상대 경로를 읽을 수 있다. 고정 container_name이 있어도 데이터 mount가 같다는 보장은 없다.

각 서비스 전환 전 다음을 실제 운영 환경에서 확인하고 비밀값을 제외한 배포 기록에 남긴다.

1. 승인된 대상 서비스, 모노레포 Compose 파일, 정확한 Compose 프로젝트, 현재 실행 이미지 ID/digest를 확인한다. `npm run source:check`로 모노레포에 보존한 수입 commit/tree/archive ref를, `npm run source:remote-check`로 여섯 과거 GitHub 원격 main을 수입 시점과 대조한다. 두 명령은 원본을 변경하지 않지만 branch protection·모노레포 원격·배포 승인을 대신하지 않는다. 이동된 과거 checkout을 상시 배포 입력으로 사용하지 않는다.
2. 현재 mount의 source/destination, 외부 network, 바인딩 포트, 환경 파일 및 자격 증명 파일의 **경로·존재·권한**을 확인한다. 환경값·키·토큰 전체를 출력하거나 커밋하지 않는다.
3. DB/첨부/감사 기록과 인증 DataProtection 키를 일관된 방식으로 백업한다. 백업 저장소와 접근 권한, 복원 확인 및 스키마 호환성을 점검한다. 실행 중 SQLite 파일을 단순 복사한 것만으로 일관된 백업이라고 간주하지 않는다.
4. 검사된 main commit과 게시 이미지 digest, 신뢰된 CI run/attempt를 연결한다. 게시 workflow의 `workspace-image-publication-set-v1`과 아래 digest 고정 후보를 사용하되 둘 다 운영 승인으로 간주하지 않는다.
5. 기존 데이터·포트·네트워크를 보존하는 명시적 배포 설정을 준비하고 기존/신규 mount를 대조한다. 확인되지 않은 기본 Compose 프로젝트 이름이나 상대 경로로 운영 `up`을 실행하지 않는다.
6. 격리 환경에서 대상 서비스만 전환하는 절차와 이전 이미지 복귀를 검증한 뒤 승인된 운영 서비스 하나씩 적용한다. 인증 원본이 바뀌는 경우 모든 소비 서비스의 호환성도 확인한다.
7. 기본 응답뿐 아니라 로그인·세션 유지·권한 거부·프로필·공통 메뉴와 해당 서비스의 승인된 비파괴 조회를 확인한다. 실제 환불/플레이어 저장/연차/시트 갱신을 임의로 테스트하지 않는다.

## 읽기 전용 배포 사전 검사

`node tooling/deployment-preflight.mjs inspect --service all`은 여섯 서비스의 현재 Compose 프로젝트/설정 경로, 컨테이너 ID, 불변 로컬 이미지 ID, 실행/health 상태, mount·포트·네트워크만 반환한다. 환경값, 임의 label, 실행 명령, health 로그, 비밀 파일 내용은 조회/출력하지 않는다. healthcheck가 없는 컨테이너의 health는 null이지 healthy가 아니다. 환경 파일 label의 null도 해당 파일이 없다는 증거가 아니다.

`check`는 서비스 하나와 절대 경로의 Compose 파일(반복 가능), 환경 파일(반복 가능), 프로젝트 디렉터리 및 프로젝트 이름을 모두 요구한다. 예를 들어 아래는 기존 CS와 모노레포의 기본 설정을 **비교만** 한다.

```powershell
node tooling/deployment-preflight.mjs check --service cs --compose C:/dev/docker/company-workspace/apps/cs/docker-compose.yml --env-file C:/dev/docker/company-workspace/apps/cs/.env --project-directory C:/dev/docker/company-workspace/apps/cs --project-name cs
```

환경 파일은 Compose 보간에만 사용한다. service env_file은 `--no-env-resolution`으로 해석하지 않으며 환경값 동등성은 검증 범위 밖이다. Docker config의 전체 JSON은 프로세스 메모리에서 필요한 필드만 투영하고 원본/오류 stderr를 출력하지 않는다. 키/토큰이 노출될 수 있는 `docker compose config --environment` 또는 전체 inspect 덤프를 기록하지 않는다. 입력 경로·존재와 후보 bind 원본 존재를 확인하며 원격 엔진/UNC/상대 경로, 알려지지 않은 mount 방식·driver·subpath는 수동 검토를 요구한다. Windows drive 문자·구분자는 정규화하지만 디렉터리 대소문자나 Docker Desktop 경로 매핑을 임의로 같은 경로라고 추정하지 않는다.

비교 항목은 서비스/프로젝트 식별자, 모든 mount의 유형·원본·목적지·읽기 전용 여부, 명시 host IP/고정 포트, 네트워크 이름 및 후보 이미지의 digest 고정 여부다. 기존 CS/통계 볼륨의 프로젝트 접두사 변경, 시트의 다른 checkout 상대 bind, 읽기 전용 자격 증명 쓰기 전환, 포트 외부 노출 등을 차이로 표시한다. 후보에는 정확히 한 서비스만 있어야 한다. 차이가 있으면 비정상 종료하며 임의 up/restart/pull/build/볼륨 생성은 실행하지 않는다.

기본 Compose에는 게시 이미지 digest가 없으므로 위 예제는 `candidate-image-not-pinned`로 실패하는 것이 정상이다. 승인된 실제 게시 묶음을 받은 뒤 아래와 같이 서비스별 digest-only override를 생성할 수 있다.

```powershell
npm run deployment:candidate -- --publication-set C:/approved-artifacts/publication-set.json --output C:/approved-artifacts/candidate-<commit>
```

입력과 출력은 절대 경로여야 하고 출력 디렉터리는 새 경로여야 한다. 생성기는 정확한 여섯 서비스와 GHCR digest를 검증하고 `candidate.json` 및 여섯 `<app>.image.compose.json`만 만든다. 기존 Compose가 mount·port·network·환경·command를 계속 소유하므로 preflight에는 기본 Compose 뒤 해당 서비스 override를 추가한다. 생성기는 Docker·registry·환경 파일을 읽거나 `pull/build/up/restart`를 실행하지 않으며 결과의 `deploymentApproved`는 false다. 가짜 digest를 넣어 통과시켜도 출처를 입증하지 못한다.

기본 Compose의 `build` 항목은 override와 함께 남는다. 따라서 이후 승인된 실제 전환 도구는 게시 digest를 먼저 가져오고 Compose build를 금지해야 한다. `--project-directory`는 상대 환경/bind/build 경로 해석에도 영향을 주므로 현재 후보나 preflight 출력으로 `up --build`를 실행해서는 안 된다.

출력 `boundaryCompatible:true`도 **부분 사전 검사 결과**일 뿐이다. `deploymentApproved`는 항상 false다. 신뢰된 CI와 이미지 출처, 환경/비밀값, 명령·보안·리소스 정책, 백업/스키마 호환성, 실제 인증/업무 조회 및 전환/롤백 리허설은 unverified로 남는다. daemon ID와 조회 시각은 출처 서명/승인 증거가 아니며, 조회 이후 상태 변경을 방지하는 잠금도 아니다. `rollbackImageId`는 그 호스트의 현재 로컬 이미지 ID이지 registry manifest digest가 아니다. 보관/복구 가능성은 별도로 확인해야 한다.

### 2026-09-10 실제 읽기 조회

처음 기본 권한의 Docker 접근은 거부됐다. 이후 승인된 읽기 전용 호출에서 Docker 29.5.2의 여섯 컨테이너가 running임을 확인했다. CS·통계·시트는 healthy, Portal·Leave·Schedule은 healthcheck 미정의(null)였다. 실제 HTTP/SSO/업무 정상 여부를 검사한 것은 아니다.

| 앱 | 실제 Compose 프로젝트 | 데이터 원본 | localhost 포트 | 실제 네트워크 |
| --- | --- | --- | --- | --- |
| portal | company-portal | company-portal-data / company-portal-data-keys | 5090 → 8080 | company-portal_default, company-services |
| leave | leavemanager | leave-manager-data / leave-manager-data-keys | 5080 → 8080 | leave-net, company-services |
| schedule | schedule | company-schedule-data | 5181 → 8080 | company-services |
| cs | cs | cs_refund-audit | 3000 → 3000 | cs_default, company-services |
| statistics | statistics | statistics_statistics-data | 3010 → 3010 | statistics_default, company-services |
| sheet | sheet | C:/dev/docker/sheet/data 및 C:/dev/docker/private/sheet-google-service-account.json (ro) | 4173 → 4173 | sheet_default, company-services |

기존 각 프로젝트 디렉터리·환경 파일을 명시한 모노레포 Compose 여섯 개 모두 현재 mount/포트/네트워크와 일치했고 이미지 미고정 항목만 실패했다. 시트의 환경 파일은 회사 홈 .env와 시트 .env, 일정은 회사 홈 .env를 사용한 조회였다. CS 프로젝트 이름만 `cs-migration-probe`로 바꾼 config 검사에서는 project/mount/network 차이를 검출했다. 이 이름으로 실제 프로젝트·볼륨·컨테이너를 만들지 않았다. 실제 후보 배포 이미지를 검증하거나 운영을 전환한 결과가 아니다.

## 롤백 경계

배포 전 이전 이미지 ID/digest, 이전 설정 위치, mount/network 매핑과 복귀 판정 기준을 확보한다. 장애 시 대상 서비스만 이전 이미지·설정으로 복귀하고 동일 데이터 연결 및 인증을 다시 확인한다. mutable `latest` 태그만으로 롤백 대상을 정하지 않는다.

이미지 롤백은 DB 롤백이 아니다. 스키마가 변경됐거나 새 버전이 데이터를 썼다면 이전 이미지와의 호환성, 쓰기 중단 필요성, 복원으로 손실될 데이터 및 승인 범위를 별도로 판단한다. 백업 복원을 자동으로 실행하지 않는다.

`reset --hard`, `clean -fd`, `compose down -v`, 운영/백업 폴더 삭제는 배포 절차에 넣지 않는다. 기존 저장소 삭제·보관, 원격 변경, 운영 전체 재시작은 독립적으로 범위가 확정돼야 한다.

## 남은 운영 검증

- 수동 게시 workflow 자체의 원격 검증과 승인된 첫 GHCR 게시·digest 묶음 확인
- 필수 check 및 우회 권한을 포함한 병합 보호 설정
- 비공개 저장소에서 사용할 서명 provenance와 digest 승격/배포 승인·build 금지 실행 도구
- 실행 중 여섯 서비스의 비밀값 제외 inventory와 백업·복원 검증
- 서비스별 전환/롤백 리허설 및 승인된 단계적 운영 반영

이 항목들은 문서 작성이나 로컬 테스트 통과만으로 완료 처리하지 않는다.
