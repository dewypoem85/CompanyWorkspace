param([string]$PortalEnvFile = (Join-Path $PSScriptRoot '../../portal/.env'))
$ErrorActionPreference = 'Stop'
$scheduleRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$scheduleEnvFile = (Resolve-Path -LiteralPath $PortalEnvFile).Path
Push-Location $scheduleRoot
try {
    $scheduleDirty = & git status --porcelain
    if ($LASTEXITCODE -ne 0 -or $scheduleDirty) { throw '작업 중인 변경이 있습니다. 커밋하거나 정리한 뒤 다시 실행하세요.' }
    & git pull --ff-only
    if ($LASTEXITCODE -ne 0) { throw '원격 저장소 업데이트 실패' }
    & docker compose --env-file $scheduleEnvFile build
    if ($LASTEXITCODE -ne 0) { throw '이미지 빌드 실패. 실행 중인 앱은 유지합니다.' }
    & docker inspect company-schedule 2>$null | Out-Null
    if ($LASTEXITCODE -eq 0) { & (Join-Path $PSScriptRoot 'Backup-Schedule.ps1') }
    & docker compose --env-file $scheduleEnvFile up -d
    if ($LASTEXITCODE -ne 0) { throw '일정 앱 실행 실패' }
    $scheduleHealthy = $false
    foreach ($scheduleAttempt in 1..15) {
        try { $scheduleResponse = Invoke-RestMethod 'http://127.0.0.1:5181/api/health'; if ($scheduleResponse.status -eq 'ok') { $scheduleHealthy = $true; break } } catch {}
        Start-Sleep -Seconds 2
    }
    if (-not $scheduleHealthy) { throw '앱 상태 확인 실패. docker logs company-schedule로 확인하세요.' }
    Write-Output '팀 일정 업데이트 완료: https://schedule.example.com'
} finally { Pop-Location }
