# 프로젝트 아이콘 편집 계약

Portal `/Admin/Organization?tab=projects&id=<id>`의 기존 프로젝트에서 사용한다. 조직 정보와 아이콘은 별도 저장이며 아이콘 변경으로 이름·색상·멤버십·조직 버전이나 사용자 프로필을 수정하지 않는다.

## 공통 UI

`CompanyProjectIcon`은 프로젝트 대상, 현재 관리자 자격, context의 허용 프로젝트 목록과 저장 응답만 연결한다. 사진 준비·미리보기·요청 수명주기는 프로필과 동일한 `CompanyImageEditor`, 전송은 `CompanyForm`, 상태는 `CompanyState`, 삭제 확인은 `CompanyDialog`가 소유한다. 기존 `company-entities.js`의 별도 업로드/Canvas/확인창 구현은 제거했다. 표시와 검색 선택기는 기존 공통 엔티티 렌더러를 유지한다.

PNG/JPEG/WebP 원본은 8MiB 이하, 각 변 8192px 이하이며 가운데 정사각형을 256×256 PNG로 변환한다. Bitmap/PNG 준비와 후속 조회는 각 15초 관찰 제한을 가진다. 파일 초안은 현재 문서에만 남기고 beforeunload로 이탈을 경고한다. JavaScript 미지원 UI는 안내하며 파일을 서버가 다시 채울 수 있다고 설명하지 않는다.

## 서버와 버전

실제 multipart `POST /Admin/Organization?handler=Icon`은 Razor antiforgery·AdminOnly 및 서버 관리자 검증을 유지한다. 전체 요청/폼 본문은 1MiB, 실제 PNG는 512KiB 이하로 제한한다. 같은 Razor 페이지의 조직 정보 POST에도 요청 크기 제한이 적용된다.

- `ExpectedUserId`: 현재 회사 ID와 정확히 일치하는 단일 십진 문자열.
- `ProjectId`: 존재하는 프로젝트의 양의 Int64 정규 십진 문자열. 이미지 대상은 로그인 사용자 ID와 구분한다.
- `ExpectedVersion`: 사진이 없으면 빈 문자열, 있으면 정확한 32자리 소문자 16진수. 끝 개행도 거부한다.
- `Operation`: 단일 `save`/`remove`. 저장은 `Photo` 파일 하나를 받으며 `AvatarStore.ReadPngAsync`/`AvatarPng.Normalize`가 실제 PNG 크기·구조·CRC를 검증한다.

`WorkspaceImageStore`는 닫힌 저장소 종류로 테이블/키를 선택하고 데이터는 SQL 매개변수로 전달한다. 빈 버전의 저장은 존재하지 않을 때만 삽입, 기존 버전은 조건부 갱신/삭제한다. 불일치 시 409이며 현재 버전으로 자동 교체하지 않는다. 사진 없음 확인 후 삭제의 no-op는 영구 tombstone이나 이후 생성과의 원자적 배제를 제공하지 않는다. DB 스키마와 이미지 GET 경로는 유지한다.

## 저장 확인과 복구

enhanced 응답은 공통 media type의 `workspace-form-v1`이다. `saved.data`는 `{ operation, userId, projectId, previousVersion, version, iconUrl }`이고 ID와 버전은 문자열이다. 저장 URL은 정확한 `/api/workspace/project-icon/<projectId>?v=<version>`, 삭제는 `version: ""`, `iconUrl: null`이다. 어댑터와 엔진은 제출한 계정·프로젝트·이전 버전·작업 및 반환 버전/경로를 모두 검증한 뒤 파일 선택을 비우고 갱신 신호를 발행한다.

입력 거부는 422, 계정/이미지 버전·사라진 프로젝트는 409, 내부 쓰기 실패는 내용을 노출하지 않는 미확정 500이다. 오류/미확정 뒤 초안을 유지하며 자동 POST 재시도하지 않는다. 명시적 재확인은 GET만 수행한다. 확인된 저장 뒤 context 조회 실패는 저장 실패와 구분한다. 계정/권한 범위 변경, 허용 프로젝트에서 대상 제거, 해제/관찰 종료 뒤 늦은 결과는 적용하지 않는다. 브라우저 abort를 서버 롤백으로 보장하지 않는다.

일반 HTML 성공은 해당 프로젝트로 리디렉션한다. HTML 실패는 아이콘 오류를 표시하고 파일 재선택을 요구하며, 미확정/충돌이면 반복 저장을 잠근다. 이 별도 POST에 보내지 않은 조직 정보 초안을 HTML 응답이 복원할 수는 없다. enhanced 아이콘 저장은 문서를 교체하지 않아 조직 초안을 유지한다. 조직 전송 중에는 아이콘 쓰기를 거부하며 두 트랜잭션의 원자성을 주장하지 않는다.

## 표시 갱신과 호환

기존 `WorkspaceProjectIcons`, `context.projectIcons`, 인증·비공개 프로젝트 이미지 GET 인가를 유지한다. 검증된 변경 후 기존 `CompanyProfileRevision` 쿠키/storage 신호로 공통 context 갱신을 유도한다. 표시 중인 탭의 쿠키 감지와 숨겨진 탭의 활성화 갱신을 사용하며 모든 서비스의 즉시 동기 갱신이나 업무 디렉터리의 동시 트랜잭션을 보장하지 않는다.

raw `POST/DELETE /api/workspace/project-icon/<id>`는 관리자·기존 CSRF 경계와 버전 없는 마지막 쓰기 우선 호환 동작을 유지한다. 새 UI에서 사용하지 않으며 종료하려면 별도 소비자/배포 이관이 필요하다. 프로필과 아이콘은 같은 저장 도구를 사용하되 서로 다른 테이블·대상을 가진다.
