# Company Workspace

회사 홈, 연차, 일정, CS, 통계, 시트, 인앱결제 상품 관리를 제공하는 통합 작업 공간입니다.
운영 서비스 및 데이터베이스를 합치는 프로젝트가 아니라 공통 UI와 개발·검증 계약을 공유하는 모노레포입니다.

- [구조와 소유권](docs/ARCHITECTURE.md)
- [이관 현황 및 안전 절차](docs/MIGRATION.md)
- [전체 목표 완료 기준과 남은 작업](docs/GOAL-READINESS.md)
- [작업 규칙](AGENTS.md)
- [개발·생성기·검증 명령](docs/DEVELOPMENT.md)
- [CI 증거와 서비스별 배포·롤백 경계](docs/DEPLOYMENT.md)

원본 저장소 이력은 `migration-sources.json`과 `archive/*` ref로 보존합니다. 소스 통합만으로 운영 배포가 전환되지는 않으며, 서비스별 데이터·비밀값·이미지 경계를 별도로 검증합니다.

새 페이지는 공통 UI뿐 아니라 검토된 브라우저 transport도 재사용해야 합니다. `npm run check:network`가 새 페이지의 raw 네트워크 호출과 기존 transport 호출 증가를 차단합니다.
Native POST 폼도 같은 원칙으로 봉인되어 있으며 `npm run check:post`가 literal 폼, submitter override와 JavaScript method 할당을 포함해 검토되지 않은 새 변경 폼과 기존 폼 수 증가를 차단합니다.
