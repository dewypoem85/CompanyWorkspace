# 모바일 앱과 푸시 알림 계약

## 기준과 신뢰 경계

- 앱의 패키지명, 버전, 시작 URL, 신뢰 출처와 릴리스 인증서 지문은 `mobile-app.json`이 유일한 기준이다.
- `tooling/build-ui.mjs`가 각 공개 루트의 `/.well-known/assetlinks.json`, Portal PWA manifest, Android 리소스와 회사 로고를 생성한다. 생성 파일은 직접 수정하지 않는다.
- Android 앱은 Portal origin에 대해 `use_as_origin` 관계가 검증된 Custom Tabs 세션을 만든 뒤에만 FCM 토큰을 postMessage로 보낸다.
- 웹은 현재 인증 사용자, CSRF, `expectedUserId`, 활성 `WorkspaceSession sid`를 모두 확인하고 토큰을 Data Protection으로 보호한다. 토큰 원문을 로그·브라우저 저장소·응답에 남기지 않는다.

## 기기 API

- `GET /api/workspace/push/devices?expectedUserId={id}`: 현재 사용자에게 연결된 기기의 공개 설정만 반환한다.
- `POST /api/workspace/push/devices`: 설치 UUID, FCM 토큰, 앱 버전을 현재 사용자와 세션에 연결한다. 최초 연결 시 연차·일정 각각의 현재 최신 ID를 cursor로 삼아 과거 알림을 보내지 않는다.
- `PATCH /api/workspace/push/devices/{installationId}`: 전체·연차관리·팀 일정 알림 설정을 변경한다. 해당 출처를 받는 다른 활성 기기가 없을 때만 다시 켜는 시점의 최신 ID로 기준점을 옮겨, 과거 알림 재전송과 다른 기기의 누락을 모두 막는다.
- `DELETE /api/workspace/push/devices/{installationId}`: 토큰 원문을 폐기하고 기기를 비활성화한다.

다른 사용자의 설치 UUID는 조회·수정·삭제할 수 없다. 로그아웃, 세션 폐기, 계정 비활성화 또는 권한 제거 후에는 worker가 발송 대상으로 사용하지 않는다.

## 수집과 전달

- Leave와 Schedule 내부 API의 `afterId`는 오름차순 증분 결과만 반환한다.
- `(DeviceId, Source, SourceId)`는 유일하며 같은 알림을 같은 기기에 다시 만들지 않는다.
- FCM data payload에는 출처, 출처 ID, 서비스명, 제목, Portal 진입 링크만 넣는다. 상세 메시지는 넣지 않는다.
- 일시 오류는 지수 backoff로 다시 시도한다. FCM이 토큰을 `UNREGISTERED` 또는 `SENDER_ID_MISMATCH`로 확정한 경우에만 해당 기기를 비활성화한다.
- 알림 선택은 `/notifications?open={source}:{sourceId}`로 이동한다. 목록 범위를 벗어난 과거 알림도 출처의 정확한 ID로 다시 조회해 현재 계정 소유권을 확인하고, 기존 읽음 API가 204를 반환한 뒤 업무 링크로 이동한다.

## 오프라인과 브라우저 알림

Portal 서비스 워커는 로고, 공용 정적 자산, manifest와 연결 안내만 캐시한다. 인증 HTML, API, 직원·연차·일정 데이터는 캐시하지 않는다. TWA 토큰 채널이 확인된 문서에서는 회사 홈의 주기 조회형 브라우저 알림을 중지하며 일반 PC 브라우저 동작은 유지한다.
