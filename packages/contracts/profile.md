# 프로필 사진 설정 계약

## 공통 UI와 전송

`packages/workspace-ui/src/image-editor.js`의 `CompanyImageEditor`가 사진 준비·전송·상태·확인창 수명주기를 소유한다. `profile.js`의 `CompanyProfile`은 현재 사용자 대상과 `context.profiles`/`user.avatarUrl` 일치 및 저장 응답 경로를 연결하는 얇은 어댑터다. 저장 전송은 `CompanyForm`, 결과는 `CompanyState`, 기본 사진으로 변경 확인은 `CompanyDialog`를 사용한다. 프로젝트 아이콘도 같은 엔진을 사용하되 별도 대상/권한 계약을 적용한다. 페이지/셸에 별도 Canvas·avatar fetch 또는 확인창을 복제하지 않는다.

`POST /settings/profile`은 실제 multipart Razor 폼이다. 기존 antiforgery와 페이지의 중앙 인증 policy를 유지한다. 입력은 `ExpectedUserId`, `ExpectedVersion`, `Operation`(`save`/`remove`), `Photo` 및 antiforgery 토큰뿐이다. 이름·이메일·부서·역할은 이 handler에서 변경하지 않는다.

- `ExpectedUserId`: 현재 회사 사용자 ID의 정확한 십진 문자열. 다른 계정 또는 중복 값은 거부한다.
- `ExpectedVersion`: 사진이 없을 때 빈 문자열, 사진이 있으면 32자리 소문자 16진수 버전. 저장과 삭제 모두 기존 사진 버전과 대조한다. 오래된 버전으로 새 사진을 덮어쓰거나 삭제하지 않는다.
- 클라이언트는 PNG/JPEG/WebP, 8MiB 이하·각 변 8192px 이하를 가운데 정사각형으로 잘라 256×256 PNG로 준비한다. Bitmap/PNG 변환 각 대기 단계는 15초로 제한한다. Bitmap은 사용 후/늦은 완료 시 닫는다.
- 서버는 전송 본문 1MiB, 실제 PNG 512KiB를 제한하고 기존 `AvatarPng.Normalize`의 크기·구조·CRC·압축 내용 검증을 재사용한다. MIME 선언만으로 사진을 허용하지 않는다.

## 저장 확인

공통 폼 응답 media type과 `workspace-form-v1` envelope를 사용한다. `saved`의 `data`는 `{ operation, userId, version, avatarUrl }`이다. 사진 저장은 정확한 `/api/workspace/avatar/<userId>?v=<version>` 경로를 반환한다. 삭제는 `version: ""`, `avatarUrl: null`이다. 전체 응답을 검증한 후에만 파일 선택·미리보기를 비우고 갱신 신호를 보낸다.

처리 중에는 업로드·저장·삭제를 함께 잠근다. 오류/충돌/미확정 결과는 선택한 사진을 현재 문서에 보존하고 자동 재전송하지 않는다. 명시적 현재 사진 재확인은 GET만 수행하며, 검증된 최신 사진 버전을 확인한 뒤 사용자가 다시 저장할 수 있다. 확인된 저장 뒤 목록 갱신 실패는 저장 실패로 바꾸지 않는다.

계정·권한 범위 변경 또는 문서 해제 시 확인창과 진행 중 요청을 무효화하고 미리보기를 제거한다. 늦은 Bitmap·응답·JSON은 이전 화면에 적용하지 않는다. 클라이언트 관찰 종료는 서버 취소/롤백이나 영구 멱등성 보장이 아니다.

## 서비스 연동과 호환 범위

프로필 원본은 기존 Portal `WorkspaceProfiles` 테이블이다. `AvatarStore`의 PNG 검증과 `WorkspaceImageStore`의 조건부 쓰기를 폼과 기존 raw `POST/DELETE /api/workspace/avatar`가 함께 사용하며 DB 스키마는 바꾸지 않는다. 저장소 종류는 닫힌 enum으로 결정하고 모든 데이터 값은 SQL 매개변수다. **기존 raw API는 버전 없는 마지막 쓰기 우선 동작을 호환용으로 유지**하고 새 설정 화면만 버전 대조 경로를 사용한다. 향후 raw API 종료는 소비자/배포 이관을 별도로 확인해야 한다.

검증된 저장은 기존 `CompanyProfileRevision` 도메인 쿠키와 같은 출처 storage 신호로 다른 탭의 공통 context 갱신을 유도한다. 표시 중인 탭은 쿠키 변경을 주기적으로 확인하고, 숨겨진 탭은 활성화될 때 갱신한다. 모든 탭이 동기적으로 바뀌는 트랜잭션이 아니다. 직원 사진의 비공개 표시 정책과 이미지 읽기 인가는 그대로 유지한다.

파일 초안은 브라우저 저장소에 복제하지 않는다. 선택 파일이나 전송 중 요청이 있으면 native beforeunload로 이탈을 경고하지만, 사용자가 새로고침/탭 종료를 승인하면 사라진다. native HTML 오류 응답은 보안상 파일 입력을 복원할 수 없어 재선택을 안내한다. JavaScript 없는 설정 UI는 지원하지 않는다고 명시한다. native POST 자체의 CSRF·검증·성공 리디렉션은 유지한다.
