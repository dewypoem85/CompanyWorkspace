# 조직 정보를 회사 포털에서 관리

## 관리 위치와 권한

회사 포털 `/Admin/Users`에 직원·부서·프로젝트 탭이 있습니다. 부서는 직원당 하나, 참여 프로젝트는 여러 개이며 미지정도 허용합니다. 프로젝트 화면과 직원 화면은 같은 참여 관계를 편집합니다. 일반 관리자는 관리자·마스터 직원의 소속과 책임자 지정을 수정할 수 없습니다.

일정 앱의 프로젝트·책임자 수정 API는 인증 후 410을 반환합니다. 일정 설정에는 주요 일정·보관함과 포털 관리 링크를 제공합니다. 참여 프로젝트는 추천·필터에만 사용하며 기존 전체 열람과 본인·부서 책임자·관리자의 업무 수정 규칙을 바꾸지 않습니다.

프로젝트 필터에서는 현재 참여 직원(업무가 없어도 표시)과 조회 중인 해당 프로젝트 업무의 담당자를 합쳐 표시합니다. 비활성·탈퇴 직원도 조회 대상 업무가 있으면 누락하지 않습니다. 업무 편집에서는 담당자의 참여 프로젝트를 먼저 보여주되 다른 활성 프로젝트도 선택할 수 있으며, 담당자를 바꿔도 기존 선택을 덮어쓰지 않습니다.

## API 및 데이터

`GET /api/internal/schedule/directory`는 Portal의 직원·부서·프로젝트·참여 관계·책임자를 같은 DB 스냅샷으로 반환합니다. 기존 HMAC `schedule-directory` audience를 사용하고 이메일·입사일은 전달하지 않습니다. 기존 `/employees` API는 유지합니다.

일정은 완전한 스냅샷을 검증한 뒤 하나의 트랜잭션으로 반영합니다. ID 중복, 존재하지 않는 직원/프로젝트 연결, 무효 책임자 또는 이전되지 않은 기존 프로젝트가 있으면 반영하지 않습니다. 서버 갱신은 60초 이내와 쓰기 직전, 브라우저 조직 정보 갱신은 60초 및 창 복귀 시 수행합니다. 부서 이름 변경은 ID를 유지하며, 부서 이동·비활성·공유 계정 전환은 기존 책임자 지정을 무효화합니다.

## 최초 전환과 복구

1. 새 Portal 및 Schedule 이미지를 먼저 빌드하고 기존 이미지 ID를 기록합니다.
2. 두 앱을 중지하고 Portal 데이터/키, Schedule 데이터/이미지/키 볼륨을 tar.gz로 백업합니다. SHA256을 기록합니다.
3. 새 Portal 이미지의 `import-schedule-organization <portal.db> <schedule.db>`를 실행해 사전 검사합니다. 원본 대신 임시 복사본에서 스키마 변경과 이전을 검사합니다.
4. 같은 명령에 `--apply`를 붙여 적용합니다. 기존 부서명을 목록으로 바꾸고 프로젝트 ID·색상·보관 상태·유효 책임자를 가져옵니다. 참여자는 추정하지 않습니다. `schedule-catalog-v1` 완료 기록으로 재실행을 보호합니다.
5. 새 Portal을 먼저 시작하고 새 Schedule을 시작합니다. 이전 중에는 구버전의 조직 편집 화면을 사용하지 않습니다.
6. 회사 포털 조직 조회 API, Schedule health, 기존 프로젝트 연결·업무·댓글·이미지 개수 및 연차 연동을 확인합니다.

`docker exec company-schedule dotnet Schedule.dll sync-directory`는 회사 직원으로 로그인하지 않고 설정된 서비스 인증으로 조직 스냅샷을 즉시 동기화하며 레코드 수를 출력합니다. 배포 검증용 CLI이며 HTTP 접근 경로는 없습니다.

문제가 있으면 두 앱을 중지하고 백업을 **새 볼륨**에 복구해 DB 무결성·이미지 누락을 검사한 뒤 이전 이미지와 연결합니다. 원래 볼륨을 삭제하거나 덮어쓰지 않습니다. Portal과 Schedule은 같은 전환 시점의 백업으로 함께 복구합니다.

## 검증

```powershell
npm test
npm run build
dotnet test tests/Schedule.Tests.csproj -c Release
dotnet test integration-tests/CompanyIntegration.Tests.csproj -c Release
# Portal을 별도 작업 디렉터리에서 개발할 때
dotnet test integration-tests/CompanyIntegration.Tests.csproj -c Release -p:PortalProjectPath=C:/path/to/company-portal/CompanyPortal.csproj
```

테스트는 참여 편집과 버전 충돌, 부서명·연차 outbox 갱신, 이동/비활성/공유 계정의 책임자 해제, 관리자 우회 방지, 스냅샷 오류 시 원자성, 레거시 API 호환성, ID 보존·사전 검사 무변경·재실행, 프로젝트 필터·추천과 50명/1,000개 업무 조회를 포함합니다.
