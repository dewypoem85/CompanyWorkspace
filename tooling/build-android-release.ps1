param(
    [string]$PrivateDirectory = "C:\dev\docker\private\company-workspace-android"
)

$ErrorActionPreference = "Stop"

$repositoryRoot = Split-Path -Parent $PSScriptRoot
$androidRoot = Join-Path $repositoryRoot "apps\mobile-android"
$firebaseConfig = Join-Path $PrivateDirectory "google-services.json"
$keystore = Join-Path $PrivateDirectory "company-workspace-release.p12"
$signingEnvironment = Join-Path $PrivateDirectory "signing.env"
$contractPath = Join-Path $repositoryRoot "packages\contracts\mobile-app.json"

foreach ($requiredFile in @($firebaseConfig, $keystore, $signingEnvironment, $contractPath)) {
    if (-not (Test-Path -LiteralPath $requiredFile -PathType Leaf)) {
        throw "Required release input was not found: $requiredFile"
    }
}

Get-Content -LiteralPath $signingEnvironment | ForEach-Object {
    if ($_ -match '^([^#=]+)=(.*)$') {
        [Environment]::SetEnvironmentVariable($Matches[1].Trim(), $Matches[2].Trim(), "Process")
    }
}

$env:ANDROID_KEYSTORE_PATH = $keystore
foreach ($requiredVariable in @("ANDROID_KEYSTORE_PASSWORD", "ANDROID_KEY_ALIAS", "ANDROID_KEY_PASSWORD")) {
    if ([string]::IsNullOrWhiteSpace([Environment]::GetEnvironmentVariable($requiredVariable, "Process"))) {
        throw "Required signing variable is missing: $requiredVariable"
    }
}

$keytool = if (-not [string]::IsNullOrWhiteSpace($env:JAVA_HOME)) {
    Join-Path $env:JAVA_HOME "bin\keytool.exe"
} else {
    (Get-Command keytool -ErrorAction Stop).Source
}
if (-not (Test-Path -LiteralPath $keytool -PathType Leaf)) {
    throw "keytool was not found. Configure JAVA_HOME before building."
}

$certificateLine = & $keytool -list -v -keystore $keystore -storepass $env:ANDROID_KEYSTORE_PASSWORD -alias $env:ANDROID_KEY_ALIAS 2>$null |
    Select-String "SHA256:" |
    Select-Object -First 1
if (-not $certificateLine) {
    throw "Could not read the release certificate fingerprint."
}

$actualFingerprint = (($certificateLine.Line -split 'SHA256:\s*', 2)[1]).Trim().ToUpperInvariant()
$expectedFingerprint = ((Get-Content -Raw -LiteralPath $contractPath | ConvertFrom-Json).signingCertificateSha256).Trim().ToUpperInvariant()
if ($actualFingerprint -ne $expectedFingerprint) {
    throw "The release certificate does not match the mobile app contract."
}

$googleServicesDestination = Join-Path $androidRoot "app\google-services.json"
Copy-Item -LiteralPath $firebaseConfig -Destination $googleServicesDestination -Force

Push-Location $androidRoot
try {
    & ".\gradlew.bat" :app:testReleaseUnitTest :app:assembleRelease
    if ($LASTEXITCODE -ne 0) {
        throw "Android release build failed."
    }
} finally {
    Pop-Location
}

$apk = Join-Path $androidRoot "app\build\outputs\apk\release\app-release.apk"
if (-not (Test-Path -LiteralPath $apk -PathType Leaf)) {
    throw "The signed release APK was not produced."
}

$apkHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $apk).Hash.ToLowerInvariant()
Write-Output "Signed APK: $apk"
Write-Output "APK SHA-256: $apkHash"
