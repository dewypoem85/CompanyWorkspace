# 운영 및 연동

## 배포 전제

- 회사 Portal 및 LeaveManager에 일정용 읽기 API 변경이 먼저 배포되어 있어야 합니다.
- Docker의 기존 `company-services` 네트워크와 Portal 공유키를 재사용합니다.
- `schedule.example.com`을 기존 회사 Cloudflare Tunnel에 연결하고 ingress에 `http://company-schedule:8080`을 등록합니다.
- Schedule의 `AllowedHosts`에는 공개 주소와 로컬 주소 외에 `company-schedule`을 유지합니다. Leave 같은 `company-services` 내부 소비자가 컨테이너 DNS로 호출할 때 이 호스트가 빠지면 ASP.NET Core host filtering에서 업무 API 진입 전 400으로 거절됩니다.
- 예시 일정과 실제 시트는 가져오지 않습니다. 최초 운영 DB의 업무·프로젝트는 비어 있습니다.

```powershell
docker compose --env-file ../portal/.env build
docker compose --env-file ../portal/.env up -d
```

공유키를 복사하거나 명령 출력으로 표시하지 않습니다. `.env.example`은 선택 설정의 안내용입니다. 로컬 확인 주소는 `http://127.0.0.1:5181/api/health`이고 업무 화면은 HTTPS 회사 포털 SSO로 사용합니다. 운영 쿠키는 Secure/HttpOnly/SameSite=Lax이며 쓰기 API는 CSRF 토큰 및 현재 직원 권한을 검증합니다. 임시 이미지는 24시간 후 30분 주기의 정리 작업에서 삭제합니다.

## 서비스 계약

조직 정보는 Portal의 `/api/internal/schedule/directory`에서 가져옵니다. 부서·프로젝트·참여 직원·책임자 관리 및 최초 전환은 [ORGANIZATION.md](ORGANIZATION.md)를 참고하세요. 아래 `/employees`는 구버전 호환용 계약입니다.

Portal: `GET /api/internal/schedule/employees`, audience `schedule-directory`. 결과는 `id,name,department,role,active,shared,access` 배열. 원본 계정 DB를 직접 읽지 않고 이 API를 사용합니다.

Leave: `GET /api/internal/schedule/absences?from=YYYY-MM-DD&to=YYYY-MM-DD`, audience `schedule-absences`. 결과는 `employeeId,date,portion` 배열. `portion=full|morning|afternoon|other`. 승인 및 취소 대기 기록만 포함합니다.

주요 일정 남은 평일은 일정 서비스의 인증된 `GET /api/holidays?from=YYYY-MM-DD&to=YYYY-MM-DD`로 조회한 연차관리 DB의 등록 공휴일만 제외합니다. 내부 원본은 Leave의 `GET /api/internal/schedule/holidays`이며 같은 `schedule-absences` 서비스 토큰을 사용합니다. 조회가 실패하면 API는 `available:false`를 반환하고 화면은 평일 수를 `—`로 표시합니다. 양쪽 API의 최대 날짜 간격은 73,050일입니다. Leave의 새 경로를 먼저 배포한 뒤 일정 앱을 전환합니다.

연차 달력은 Schedule의 `GET /api/internal/leave/milestones?from=YYYY-MM-DD&to=YYYY-MM-DD`를 사용합니다. `iss=company-leave`, `aud=leave-milestones` HMAC Bearer의 회사 사용자 ID를 현재 활성 일정 계정으로 확인하고, 기존 공개 프로젝트 정책을 적용한 뒤 발생별 ID·유형·제목·날짜·프로젝트만 반환합니다. 최대 날짜 차이는 366일이며 설명·작성자·이력·업무는 반환하지 않습니다. 상세 계약은 `packages/contracts/leave-schedule-milestones.md`입니다.

두 API는 issuer `company-schedule`, subject `schedule`, 60초 만료와 일회용 jti가 있는 HMAC Bearer 토큰을 요구합니다. 서비스별 audience를 혼용할 수 없습니다. 실제 SSO 로그인은 기존 Portal issuer와 `aud=schedule`을 사용합니다.

## 백업·복구

```powershell
./scripts/Backup-Schedule.ps1
./scripts/Restore-Schedule.ps1 -BackupFile ./backups/schedule-YYYYMMDD-HHMMSS.tar.gz -NewVolume schedule-restore-YYYYMMDD
```

백업은 일정 앱만 잠시 중지해 SQLite WAL·이미지·Data Protection 키를 일관된 tar.gz로 저장하고 다시 시작합니다. 백업 파일에는 업무와 인증 키가 있으므로 사내 보관 위치에서만 관리합니다. 백업 SHA256을 함께 기록합니다.

복구는 반드시 새 볼륨에 수행하고 기존 운영 볼륨을 덮어쓰지 않습니다. 새 볼륨을 테스트 컨테이너 `/app/data`에 연결해 SQLite `PRAGMA integrity_check`, 업무·댓글·이미지 개수, 첨부 파일 존재와 인증 조회를 확인합니다. 검증 후 Compose의 `schedule-data.name`을 새 볼륨 이름으로 바꾸고 다시 실행합니다. 원래 볼륨은 롤백용으로 보존합니다.

```powershell
docker run --rm --mount type=volume,src=schedule-restore-YYYYMMDD,dst=/app/data,readonly schedule-schedule verify-data
```

`verify-data`는 로그인 서버를 시작하지 않고 읽기 전용으로 DB 무결성·레코드 수·연결된 이미지 누락을 확인하며 불일치 시 비정상 종료합니다.

## 업데이트·롤백

`scripts/Update-Schedule.ps1`은 미커밋 변경이 있으면 중단하고 `git pull --ff-only`, 이미지 빌드, 기존 데이터 백업, 재실행, health 확인 순서로 동작합니다. 강제 reset이나 volume 삭제는 사용하지 않습니다.

배포 전에 이전 이미지 ID를 기록합니다. 앱 오류 시 이전 이미지로 되돌리고 원래 데이터 볼륨을 유지합니다. 스키마 변경이 있는 후속 버전은 별도 마이그레이션과 복구 검증을 추가해야 합니다. 현재 최초 버전은 자체 SQLite DB만 생성하며 Portal/Leave 스키마는 변경하지 않습니다.

## 검증 명령

```powershell
npm test
npm run build
dotnet test tests/Schedule.Tests.csproj -c Release
# 형제 경로에 company-portal 및 LeaveManager 저장소가 있을 때
dotnet test integration-tests/CompanyIntegration.Tests.csproj -c Release
```

CI는 프런트엔드 테스트/빌드, 일정 API 통합 테스트, Docker 빌드를 수행합니다. 교차 서비스 테스트는 실제 Portal/Leave 앱을 임시 DB로 실행해 인증·노출 필드·휴가 상태 계약을 검사합니다.
