# CS 플레이어 데이터 조회 계약

플레이어 데이터 화면의 회사/PlayFab configuration과 세 저장소 전체 lookup은 읽기다. UserData, UserReadOnlyData, UserInternalData의 save·add·delete와 분리하며, 읽기 실패를 변경 실패나 롤백으로 해석하거나 변경 요청을 자동 재전송하지 않는다.

- `CompanyReadSession`의 `player-bootstrap` 채널은 최초 설정과 권한 범위 복구 시 configuration을 읽고, `player-lookup` 채널은 세 저장소 전체 lookup과 변경 완료 후 목록 복구를 관찰한다.
- 두 채널은 45초 관찰 제한과 최신 ticket 판정을 사용한다. 새 조회, 계정 범위 변경과 비지속 pagehide는 읽기를 취소하며 취소를 무시한 늦은 JSON body는 설정·편집 토큰·키 목록·편집기에 반영하지 않는다.
- 모든 요청은 하나의 same-origin checked JSON transport를 사용하고 캐시와 자동 redirect를 거부한다. configuration과 lookup은 현재 환경·PlayFab UID·세 저장소 전체 결과 및 각 저장소 edit token을 도메인 validator로 확인한 뒤에만 적용한다.
- save, add와 delete만 별도 변경 허용 목록과 기존 scope·CSRF·45초 관찰 경계를 사용한다. 저장 직전 고정한 환경·UID·저장소·키·edit token·전체 초안과 확인 여부를 유지하고 전체 변경 acknowledgement를 검증한다.
- 변경 acknowledgement 뒤 lookup 실패는 확인된 변경을 실패로 바꾸지 않는다. 동일 save/add/delete를 반복하지 않고, 사용자가 명시적으로 목록 조회만 복구할 수 있다. 미확정·권한·충돌 결과는 기존 초안을 보존하고 새 lookup 전까지 이전 edit token 쓰기를 잠근다.

구조 검사는 두 읽기 채널, 해제·최신 판정, 읽기/변경 허용 목록과 단일 transport를 고정한다. 브라우저 회귀는 라이브/테스트와 세 저장소, 압축 SaveData, 큰 정수 원문, 초안·펼치기, timeout, 권한·계정 변경, 늦은 lookup 및 변경 acknowledgement를 합성 PlayFab 서버로 검사한다.
