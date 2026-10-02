# 회사 계정 컨텍스트 조회

공통 셸의 `/api/workspace/context`는 로그인 사용자·서비스 목록·프로필/프로젝트 아이콘을 여섯 서비스에 전달하는 개인 범위 응답이다. `company-workspace.js`는 이를 `CompanyReadSession`의 고정 `workspace-context` 채널로 읽고 검증 완료 전 화면에 적용하지 않는다.

- 응답은 authenticated boolean을 가져야 한다. 로그인 응답은 식별 가능한 user, 알려진 역할, 중복 없는 서비스 key와 안전한 이름/href를 요구한다. 선택적인 isAdmin/CSRF, profiles/projectIcons 문자열 map과 projects 배열도 존재하면 전체 타입을 검사한다.
- 검증기는 값을 보정하거나 숫자 ID를 변환하지 않는다. 로그인되지 않은 응답은 이전 계정의 사용자·서비스·사진 정보를 재사용하지 않는다.
- 전역 주기 조회는 same-origin/no-store/redirect 오류 정책의 기존 API를 사용하며 공통 세션이 10초 관찰 제한, 해제와 최신 ticket을 소유한다. 취소·실패·늦은 응답은 현재 context를 덮지 않는다.
- 프로필 또는 프로젝트 아이콘 저장 후의 확인 조회가 새 context를 적용하면 context revision이 증가한다. 그보다 먼저 시작한 전역 조회는 나중에 성공해도 새 사진·아이콘을 되돌리지 않는다.
- 프로필/프로젝트 저장과 로그아웃, 알림 읽음 처리는 변경 요청이다. 공통 읽기 세션은 이 요청들의 성공·실패·미확정 또는 서버 인가를 대신하지 않는다.
