# Schedule 버전 기록 조회

## 책임과 범위

Schedule의 버전 기록 목록과 편집 상세에서 필요한 참조 버전·변경 이력 GET은 공통 `WorkspaceReadSession`과 `scheduleGet`을 사용한다. 화면은 현재 프로젝·기본 버전·편집 초안을 소유하고, 공통 세션은 요청 취소·최신 요청 판정·페이지 이탈 수명주기를 소유한다. 서버 API·인가·DB·응답 형식은 바꾸지 않는다.

## 목록과 상세 채널

- 시리즈, 마이너 버전, 구형 기록 목록은 `release-list` 채널을 공유한다. URL·계정 scope·활성 여부가 바뀌면 진행 중 요청을 취소하고 이전 조건의 행을 새 결과로 표시하지 않는다.
- 편집 상세의 롤백 대상, 해결 버전, 참조 목록, 변경 이력은 각각 `release-target`, `release-resolved`, `release-targets`, `release-history`를 사용한다. 편집 대상·Version·계정 scope가 바뀌면 모든 채널을 취소하고 기존 상세를 초기화한다.
- 언마운트는 세션을 dispose한다. 늦게 도착한 성공·실패 결과는 React 상태나 편집 초안을 바꾸지 못한다.

## 응답 검증과 실패

- 모든 페이지는 `items`·`total`, 안전한 정수 ID, 중복 ID와 현재 프로젝·기본 버전 범위를 검증한 뒤에만 표시한다.
- 참조 버전은 요청 ID와 프로젝와 일치해야 한다. 변경 이력은 revision 메타데이터와 snapshot JSON을 검증하고 snapshot이 현재 버전·프로젝에 속해야 한다. 원문 notes·issue의 64비트 숫자 문자열은 재직렬화하지 않는다.
- 첫 실패를 빈 목록 성공으로 보이지 않는다. 재조회 실패는 마지막 정상 행을 유지하고, 401/403과 계정 scope 변경은 행·loaded 상태를 제거한다. 명시적 재시도는 GET만 반복한다.
- 공통 GET은 same-origin, no-store, JSON content-type, redirect·HTTP 상태와 AbortSignal을 검증한다. 일반 서버 실패는 내부 문구를 노출하지 않고 표준 일정 조회 안내를 사용한다.

## 검증과 한계

`checkReleaseLists`는 공통 세션·GET·취소·dispose·응답 parser 연결과 raw release API GET 재도입을 검사한다. hook 단위 검사는 초기/재조회 실패, 권한 거부, 중복 페이지, scope·언마운트 취소와 참조/이력 parser를 다룬다. 실제 Chrome은 모바일/PC·라이트/다크의 목록 실패·재시도·펼치기·편집 참조·이력·scope 변경을 검증한다.

이 계약은 버전 생성·수정 저장을 완료했다는 근거가 아니며, 저장은 `schedule-release-writes.md`를 따른다. 다른 Schedule·서비스의 남은 raw GET/쓰기, 운영 SSO·DB·배포를 대체하지 않는다.
