# CS 로그 검색 조회 계약

로그 검색은 오래 실행되는 서버 작업이다. 브라우저의 관찰 중단은 서버 작업의 취소나 롤백을 뜻하지 않으며, 검색 시작과 취소는 읽기와 분리된 변경 경계를 유지한다.

- `CompanyReadSession`의 `log-bootstrap` 채널은 회사 계정 configuration과 로그 저장소 configuration을 순서대로 확인한다. `log-status` 채널은 저장된 작업을 이어받거나 실행 중인 작업의 status만 확인한다.
- 두 채널은 각각 45초의 응답 관찰 제한과 최신 ticket 판정을 사용한다. 새 화면 작업, 계정 범위 변경과 비지속 pagehide는 진행 중인 읽기를 취소하며, 늦은 JSON body는 화면·작업 ID·권한 상태에 반영하지 않는다.
- 모든 요청은 하나의 same-origin JSON transport를 사용하고 자동 redirect와 캐시를 거부한다. 응답은 JSON object여야 하며 configuration은 `validateLogConfig`, status는 현재 작업 ID·Title·검색 조건을 포함한 `validateLogJob` 검사를 통과해야 한다.
- 검색 `search`와 취소 `cancel`은 공통 읽기 세션에 넣지 않는다. 별도의 허용 목록과 기존 작업 수명주기·45초 관찰·CSRF를 유지하며, 검색 시작 결과가 불확실하면 자동 재전송하지 않는다.
- status 실패 또는 timeout은 저장된 작업 ID를 유지하고 사용자의 명시적인 상태 재확인만 허용한다. 계정/권한 거부와 다른 소유자의 작업은 기존 비공개 결과를 제거한다.

구조 검사는 두 읽기 채널, 해제·최신 결과 판정, 읽기/변경 허용 목록과 단일 checked transport를 고정한다. 브라우저 회귀는 시작 재전송 방지, 상태 재시도, 계정 변경·해제, timeout과 취소를 무시한 늦은 응답을 합성 서버로 검사한다.
