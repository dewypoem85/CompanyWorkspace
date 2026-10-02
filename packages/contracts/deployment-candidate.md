# Digest 고정 배포 후보 계약

## 입력

`deployment-candidate.mjs`는 `workspace-image-publication-set-v1` 한 개만 입력으로 받는다. 저장소, 40자리 commit/tree, 검증·게시 run/attempt, source hash, 등록된 모든 서비스와 각 서비스의 commit 태그·로컬 image ID·Linux 플랫폼·GHCR repository digest·record hash를 모두 검사한다. 누락·추가 필드, 다른 서비스 저장소, mutable 태그, 서로 다른 commit, 게시 또는 배포 범위 확대는 거부한다.

입력 파일은 256KB 이하의 심볼릭 링크가 아닌 일반 파일이어야 한다. 출력은 존재하지 않는 새 디렉터리만 허용하고 기존 파일을 덮어쓰지 않는다. 이 도구는 GitHub API, registry, Docker daemon, Compose 실행 또는 운영 환경 파일을 읽지 않는다.

## 출력

서비스마다 `<app>.image.compose.json` 하나를 만든다. 이 파일에는 기존 Compose 서비스명과 `repository@sha256:<digest>`만 있으며 mount, port, network, environment, command 또는 build 설정을 복제하지 않는다. 기존 운영 Compose의 데이터 경계는 원본 파일이 계속 소유한다.

`candidate.json`은 게시 묶음 원문 SHA-256, commit/tree와 검증·게시 실행, 등록된 모든 앱의 Compose 서비스명·컨테이너명·digest 이미지·override 파일명/hash를 결합한다. `scope`는 `digest-pinned-compose-overrides-only`, `deploymentApproved`는 항상 `false`다. 서명 provenance, 환경·비밀값, 명령·보안·리소스 정책, 백업·스키마 호환, 실제 인증/업무 조회 및 전환·롤백 리허설은 검증되지 않은 항목으로 남긴다.

## 사용 경계

생성한 override는 checked-in 기본 Compose 뒤에 추가하여 `deployment-preflight.mjs check`의 읽기 전용 후보 해석에 사용한다. 기본 Compose에는 `build`가 남으므로 향후 승인된 전환은 반드시 게시 digest를 먼저 pull하고 build를 금지하는 별도 실행 경계를 구현해야 한다. 이 계약이나 후보 파일만으로 `up`, `restart`, `build`, `pull`, 볼륨 생성, 데이터 변경 또는 운영 승인을 수행하지 않는다.
