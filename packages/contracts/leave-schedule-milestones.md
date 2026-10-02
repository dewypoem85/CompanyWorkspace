# 연차 달력의 일정 주요일정 조회

연차 달력은 Schedule DB를 복제하거나 직접 열지 않고, 현재 문서의 회사 사용자 ID로 Schedule의 읽기 전용 내부 API를 호출한다. 월간은 달력의 6주 범위, 연간은 해당 연도만 요청하며 주요일정은 표시 전용이다. 연차 신청·승인·차감·잔액·외부 일정 저장에는 영향을 주지 않는다.

## 내부 서비스 경계

- Schedule의 `GET /api/internal/leave/milestones?from=YYYY-MM-DD&to=YYYY-MM-DD`는 양 끝 포함 최대 367일(날짜 차이 366일)만 허용한다.
- Leave는 공유 비밀키로 `iss=company-leave`, `aud=leave-milestones`, 현재 회사 사용자 ID `sub`, 60초 만료와 고유 `jti`를 가진 HMAC Bearer를 매 요청 생성한다. 브라우저에는 토큰이나 내부 URL을 전달하지 않는다.
- Schedule은 조직 디렉터리를 갱신한 뒤 활성·일정 접근 허용·비공용 계정인지 확인한다. 일반 직원은 Schedule에서 공개된 프로젝트와 회사 공통 일정을, 관리자급은 기존 Schedule 정책과 같이 비공개 프로젝트를 포함해 본다. 대신보기 대상이 아니라 실제 로그인한 actor의 일정 권한을 사용한다.
- 응답은 날짜 범위 안의 발생 건별 `milestoneId` 문자열, `occurrenceIndex`, 유형, 제목, 날짜, 선택적 프로젝트 ID 문자열과 이름만 포함한다. 상세 설명·작성자·변경 이력과 업무는 내보내지 않는다. 기본 일정과 추가 일정은 각각 한 발생 건이다.

## Leave 읽기와 표시

- `ScheduleMilestoneClient`는 전용 4초·redirect 금지 클라이언트를 사용하고 HTTP 상태, JSON 구조, 최대 5,000건, 문자열 길이, ID·유형·날짜·범위를 모두 확인한 뒤에만 결과를 적용한다.
- 월간 달력은 `📌 제목`, 유형과 프로젝트명을 표시하고 날짜 상세에서도 같은 원문을 HTML이 아닌 텍스트로 렌더링한다. 프로젝트 ID가 있으면 Leave가 이미지 URL이나 바이트를 Schedule 응답에 추가하지 않고, 인증된 공통 workspace context의 `projectIcons`와 `CompanyEntityDisplay`로 권한이 확인된 프로젝트 아이콘을 붙인다. 연간 미니 달력도 같은 아이콘을 사용하며 제한된 미리보기 안에서 주요일정을 우선 표시하고 전체 건수에 포함한다.
- Schedule 응답 실패·timeout·형식 오류는 기존 연차/공휴일/생일/갱신/외부 일정 표시를 지우지 않는다. 주요일정만 비우고 달력 안에 조회 실패 상태를 표시하며 자동 저장이나 쓰기 재시도를 하지 않는다.
- 월간/연간 이동과 `SelfOnly`/`ShowOthers` 부분 갱신은 매번 현재 범위와 actor로 다시 읽는다. 응답을 DB나 브라우저 캐시에 저장하지 않는다.

## 검증

Schedule 서버 테스트는 일반 직원/관리자의 프로젝트 공개 범위, 기본·추가 일정 발생, 최소 응답, 기간·issuer·audience 거부를 확인한다. Leave 실제 Razor 테스트는 큰 문자열 ID와 HTML 유사 원문의 안전한 속성 인코딩, 월간·연간 표시 및 Schedule 장애 시 기존 달력 보존을 확인한다. 실제 Chromium은 PC/모바일, light/dark에서 칩·아이콘·날짜 상세·연간 미리보기와 대비·가로 넘침을 검사한다.
