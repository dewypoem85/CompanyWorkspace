# Android APK와 FCM 운영

## 독립 앱 셸

앱 표시 이름은 `96%`이고 패키지 ID는 유지한다. Android WebView가 회사 웹페이지를 표시하고 앱은 하단 빠른 이동·푸시 알림을 담당한다. 업무 화면을 네이티브로 재작성한 앱은 아니다. 서비스명·현재 페이지·하위 메뉴·계정·테마·로그아웃은 웹 공용 상단이 한 번만 제공한다. Google 로그인은 WebView에서 수행하지 않는다. 외부 Chrome Custom Tab에서 회사 로그인을 마친 뒤, 짧게 유효한 일회용 코드와 PKCE 검증으로 앱 WebView에 별도 회사 세션을 발급한다.

`/mobile/authorize`와 `/mobile/exchange`는 Portal에 먼저 배포되어야 새 앱 로그인이 된다. 두 경로는 Google 인증 정보를 앱으로 전달하지 않는다. 알림 권한을 거부해도 웹 기능은 쓸 수 있으며, 앱 알림 수신에는 기존 FCM 설정과 서버 푸시 활성화가 별도로 필요하다.

앱은 새 WebView를 만들 때 HTTP 자산 캐시만 비운다. 로그인 쿠키와 웹 저장소는 지우지 않는다. 공통 CSS·JS와 서비스 워커는 Portal에서 `no-store`로 제공하고, 서비스 워커는 CSS·JS에 네트워크 우선/오프라인 캐시 대체를 적용한다. 웹 UI 배포 뒤 앱을 완전히 종료하고 다시 열면 오래된 공통 헤더 자산을 재사용하지 않아야 한다.

릴리스 전 Android 실기기에서 로그인·계정 전환·서비스 간 SSO·파일 선택/프로필 사진 업로드·뒤로가기·알림 딥링크·권한 거부 및 FCM 토큰 갱신을 확인한다. WebView에 없는 브라우저 기능, 파일 다운로드와 오프라인 업무 데이터는 별도 검토 대상으로 남는다. 운영 전환 시 Portal 및 APK 롤백 경로를 보존한다.

## 준비

앱 기준은 `packages/contracts/mobile-app.json`이고 패키지 ID는 `com.nspg.companyworkspace`다. `npm run build:ui` 후 일곱 도메인의 `https://<host>/.well-known/assetlinks.json`가 동일한 릴리스 인증서 SHA-256과 두 relation을 반환해야 한다.

저장소 밖에 다음 비밀을 보관한다.

- Firebase Android 앱의 `google-services.json`
- Firebase Admin 서비스 계정 JSON
- 릴리스 PKCS12 키, alias와 암호

서명 키를 잃으면 같은 패키지의 업데이트 APK를 만들 수 없으므로 암호화된 별도 위치에 이중 백업한다. 비밀 파일이나 base64 값을 Git, CI 로그, 배포 기록에 넣지 않는다.

## 단계적 활성화

1. `Push__Enabled=false`인 Portal과 모든 `assetlinks.json`을 먼저 배포한다.
2. 각 출처의 Digital Asset Links가 릴리스 인증서와 일치하는지 확인한다.
3. Firebase 프로젝트에서 Android 앱을 `com.nspg.companyworkspace`로 등록한다.
4. Portal 운영 Compose에 `docker-compose.push.yml`을 추가하고 `FIREBASE_CREDENTIAL_HOST_PATH`를 저장소 밖 파일로 지정한다.
5. 시험 계정·기기에서 로그인, 서비스 간 이동, 권한 허용·거부, 전면·백그라운드·강제 종료 수신, 알림 딥링크, 로그아웃과 계정 전환을 확인한다.
6. `PUSH_ENABLED=true`로 worker만 활성화한다. 문제가 생기면 즉시 false로 되돌리며 웹 알림센터와 인증은 그대로 유지한다.

서명 APK는 `tooling/build-android-release.ps1`로 신뢰된 로컬 PC에서만 만든다. 스크립트는 저장소 밖 `private/company-workspace-android`의 Firebase 설정과 서명 키를 주입하고, 키 저장소의 SHA-256 인증서 지문이 중앙 계약과 정확히 같은지 확인한 뒤 release 단위 테스트와 빌드를 실행한다. GitHub에는 서명 키나 암호를 Secret으로 등록하지 않는다. 검증 workflow는 비밀 없이 unsigned debug APK와 Android 단위 테스트만 빌드한다. Debug APK의 임시 인증서는 운영 Digital Asset Links에 등록하지 않으므로 실기기 TWA 검증은 로컬에서 서명한 release APK로 수행한다.

```powershell
pwsh -File tooling/build-android-release.ps1
```

운영 전환은 APK 생성과 별개다. 사내 배포 파일은 릴리스 SHA-256을 별도 경로로 전달하고 설치 기기에서 서명 인증서 지문을 확인한다.
