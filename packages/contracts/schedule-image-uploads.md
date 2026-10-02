# Schedule 이미지 업로드 계약

## 범위와 호환성

업무 본문·새 댓글·답글·댓글 수정의 공통 `Editor`는 `useImageUploads`를 통해 임시 이미지를 업로드한다. 선택·붙여넣기·드롭은 같은 흐름을 사용한다. 기존 `POST /api/images` multipart 경로와 파일당 10MB·초안당 10개 제한, 24시간 임시 보관 및 최종 업무/댓글 저장 시 연결 정책은 유지한다.

서버의 `ImageWriteProtocol`은 `Accept: application/vnd.company.workspace-form+json`을 요청한 새 클라이언트에만 공통 응답을 반환한다. 이전 클라이언트는 기존 단일 `Attachment` JSON을 그대로 받는다. DB 스키마·이미지 GET·업무/댓글 연결 API와 배포 경계는 바꾸지 않는다.

## 확인과 요청

- 파일 선택 직후 현재 회사 계정을 다시 조회하고 사용자 ID·활성·접근·공용 계정 여부를 확인한다.
- 브라우저는 파일의 SHA-256과 이름·바이트 크기를 고정한다. 확인창에는 편집 위치, 파일명, 파일 수와 합계 크기를 표시한다.
- 확인 중 계정·편집기·첨부 목록이 바뀌면 보내지 않는다. 첫 확인이 끝나기 전 두 번째 선택을 시작할 수 없다.
- 전송 중 textarea·파일 선택·첨부 삭제와 외부 업무/댓글 저장을 잠근다. 여러 파일은 확인된 한 묶음 안에서 순차 전송하며 각 파일마다 독립 문서 lease를 사용한다.
- 요청은 multipart `file`, CSRF, `X-Workspace-Actor`와 공통 media type을 보낸다. Content-Type boundary는 브라우저가 생성한다.

## 전체 저장 응답

```text
protocol: workspace-form-v1
outcome: saved
data:
  operation: upload
  actorId: 업로드한 회사 사용자 ID 문자열
  sha256: 서버가 실제 저장한 전체 파일 바이트 SHA-256
  attachment: 저장된 Attachment 전체
```

소비자는 operation·actorId·SHA-256과 전송한 FormData의 파일 이름/크기, 첨부 ID·ownerId·taskId/commentId null·이름·크기·허용 MIME·생성 시각을 모두 확인한 뒤에만 초안 이미지 목록에 추가한다. HTTP 200이나 일부 필드만으로 첨부를 표시하지 않는다.

## 실패와 서버 경계

서버는 계정·multipart 구조·크기·magic bytes·임시 용량을 첫 파일 쓰기 전에 검사한다. 그 뒤 파일 바이트를 저장하면서 SHA-256을 계산하고 DB 행 저장까지 끝난 후 ACK를 반환한다. 첫 파일 쓰기 뒤 예외는 정리 시도 여부와 무관하게 `unknown`이며 클라이언트는 같은 문서에서 자동 재전송하지 않는다. 브라우저 abort·timeout은 서버 롤백 보장이 아니다.

입력 거부는 초안과 기존 첨부를 유지한다. 일부 파일만 확인된 여러 파일 묶음은 확인된 첨부만 남기고 나머지를 자동 재전송하지 않는다. 계정 변경·pagehide·malformed ACK는 문서 세션을 잠그며 새 화면에서 실제 첨부 상태를 확인해야 한다.

## 검증

`ImageWriteProtocolTests`는 실제 TestServer·SQLite·파일 시스템에서 새 envelope의 actor/digest/전체 첨부, 레거시 응답, 잘못된 actor·magic bytes의 쓰기 전 거부를 검사한다. `useImageUploads.test.ts`는 공통 multipart transport, 확인 취소, 중복 선택 잠금, 편집기 변경과 malformed ACK를 검사한다. 구조 변이는 raw `api('/api/images')` 복원과 계정·확인·해시·전체 ACK·문서 lease 누락을 거부한다.

`schedule-shell.spec.mjs`는 합성 HTTP와 실제 번들/Chrome의 모바일 다크·PC 라이트에서 취소 전 요청 0건, 잠긴 컨트롤, 정확한 헤더·multipart, 확인된 첨부 표시와 가로 넘침을 검사한다. 합성 응답은 운영 파일 저장 증거가 아니며 운영 SSO/볼륨/배포 검증은 별도다.
