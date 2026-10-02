# 통계 본문 조회 수명주기

통계 화면의 일반 읽기는 `app.js`의 단일 checked JSON transport와 공통 `CompanyReadSession`을 사용한다. 초기 `/api/config`는 `statistics-bootstrap`, 필터가 적용된 `/api/analytics/overview`는 `statistics-overview` 채널이다. 같은 overview 채널의 새 요청은 이전 요청을 교체하고, 두 채널 모두 30초 관찰 제한과 최신 ticket 판정을 따른다.

`fetchJson`은 same-origin 인증, no-store, manual redirect, JSON Content-Type과 JSON 파싱을 확인한다. 401은 공통 로그인 만료 경계를 호출하며 오류 응답의 원래 HTTP status를 보존한다. 취소된 signal은 JSON 소비 뒤에도 다시 확인한다. HTML 로그인 문서나 손상 JSON을 빈 통계 객체로 바꾸지 않는다.

필터 변경·갱신 시작은 진행 중 overview를 취소한다. 공통 계정 범위 변경과 non-persisted pagehide는 세션을 dispose하고 이전 payload/baseline을 제거한다. 취소를 무시한 fetch/JSON, 이전 요청의 finally와 갱신 완료 후 늦은 overview가 새 본문·로딩 상태를 덮어쓰지 않는다. 일시적 조회 실패에는 마지막 완료 payload를 유지하며 425는 기존 읽기 전용 poll을 예약한다.

`overview-contract.js`의 `readStatisticsOverview`는 응답을 화면에 적용 전 검증한다. 최상위 기간·mode·publication과 summary, trend, outcomes, versions, dimensions, builds, bosses, schema, stats를 확인한다. 빌드의 버전·재생 시간·캐릭터별 구성/추천 조합·노드 조합·무기 파츠/룬 구성·컬렉션과 보스의 조우/처치·빌드 조합 같은 중첩 업무 필드도 재귀적으로 검사한다. 서버가 제공하지 않은 필드를 기본값으로 만들어 정상 응답처럼 보이게 하지 않으며, 존재하는 optional 필드도 타입과 범위를 검증한다. 손상된 중첩 값 하나라도 있으면 새 payload 전체를 거부하고 이전 완료본을 유지한다.

통계 갱신 POST와 refresh context/status는 `refresh.js`와 `statistics-refresh.md`를 따른다. context/status GET도 공통 읽기 세션을 사용하지만 POST의 미확정 쓰기 경계와 잠금은 별도로 유지한다. 이 단계는 서버 expected actor/revision을 추가하지 않는다. 집계 쓰기, Azure 원본, 서버 큐와 운영 데이터는 변경하지 않는다.

검증은 통계 앱 단위 검사, 구조 변이 검사와 `statistics-shell.spec.mjs`의 PC/모바일·두 테마, 필터/상세, non-JSON bootstrap, 손상된 중첩 overview, 계정 변경 뒤 늦은 overview JSON을 사용한다. 합성 HTTP이며 운영 Azure·PlayFab 또는 운영 배포 성공의 증거가 아니다.
