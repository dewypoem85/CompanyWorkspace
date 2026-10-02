# Schedule 개인 TODO 조회

## 책임

개인 TODO의 할 일·보관함 목록과 삭제 전 재확인, 저장 후 목록 확인은 하나의 `personal-todos` 공통 읽기 채널을 사용한다. 화면은 탭·초안·마지막 정상 행을 소유하고 `WorkspaceReadSession`/`scheduleGet`은 same-origin/no-store JSON GET, AbortSignal, 최신 요청 판정과 수명주기를 소유한다.

## 계정·탭·응답

- 요청 전 현재 직원의 안전한 ID·활성·접근·공용 여부를 대조한다. 목록의 모든 ownerId는 요청한 현재 직원이어야 하며 ID·버전·순서·제목·시각·중복을 표시 전에 검증한다.
- 같은 요청과 병렬로 회사 계정을 다시 확인하고 actor scope와 ownerId가 바뀌면 결과를 폐기한다. 계정 이벤트, 할 일/보관함 전환과 언마운트는 진행 중 GET을 취소하거나 세션을 dispose한다.
- 초기 실패를 빈 목록 성공으로 보이지 않는다. 명시적 재조회는 GET만 반복하고, 저장 ACK 후 목록 실패는 저장을 반복하지 않는다. 수정 초안이 있는 자동 polling은 행을 교체하지 않는다.

## 검증과 한계

`checkPersonalTodos`는 공통 세션·채널·검증 GET·취소·dispose 누락과 raw TODO GET 재도입을 거부한다. 기존 Chrome TODO 시나리오는 초기/재조회·자동 polling·삭제 전 재확인·저장 후 조회 실패·scope 변경과 모바일/PC·두 테마를 다룬다.

POST/PUT/PATCH/DELETE의 편집 기준·전체 ACK·재전송 금지 경계는 `schedule-todo-writes.md`를 따른다. 이 읽기 계약만으로 서버 인가·DB 원자성, 다른 서비스 읽기와 운영 배포가 완료됐다고 판단하지 않는다.
