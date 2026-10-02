# 96% Android

회사 웹을 독립 WebView 셸에서 표시하는 Android 8+ 앱입니다. 회사 공용 웹 상단이 서비스명·현재 페이지·사이드바·계정·테마를 담당하고 앱은 하단 빠른 이동과 푸시 알림을 담당합니다. Google 로그인은 Chrome Custom Tab에서 처리합니다. 패키지 ID는 `com.nspg.companyworkspace`이며 앱 설정의 기준은 `packages/contracts/mobile-app.json`입니다.

## 로컬 빌드

Firebase 콘솔에서 받은 `google-services.json`을 `app/`에 두고 JDK 17 이상에서 Windows는 `.\gradlew.bat :app:assembleDebug`, Linux/macOS는 `./gradlew :app:assembleDebug`를 실행합니다. Wrapper가 고정된 Gradle 8.9를 사용합니다. 이 파일과 서명 키는 커밋하지 않습니다.

릴리스는 저장소 루트에서 `pwsh -File tooling/build-android-release.ps1`을 실행해 신뢰된 로컬 PC에서만 만듭니다. 스크립트는 저장소 밖의 Firebase 설정과 서명 키를 읽고 중앙 계약의 인증서 지문을 검증합니다. 운영 서명 키는 GitHub에 업로드하지 않고 저장소 밖에서 이중 백업합니다.

FCM 토큰은 검증된 회사 출처의 WebView 메시지 채널로만 전달됩니다. 인증된 웹 세션이 토큰을 현재 사용자와 연결합니다.
