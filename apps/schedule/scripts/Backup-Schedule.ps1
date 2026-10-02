param(
    [string]$OutputDirectory = (Join-Path $PSScriptRoot '../backups'),
    [string]$Container = 'company-schedule',
    [string]$Volume = 'company-schedule-data'
)
$ErrorActionPreference = 'Stop'
New-Item -ItemType Directory -Path $OutputDirectory -Force | Out-Null
$scheduleBackupDirectory = (Resolve-Path -LiteralPath $OutputDirectory).Path
$scheduleBackupName = 'schedule-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '.tar.gz'
$scheduleWasRunning = ((& docker inspect --format '{{.State.Running}}' $Container) -eq 'true')
if ($LASTEXITCODE -ne 0) { throw '일정 컨테이너 상태를 확인할 수 없습니다.' }
try {
    if ($scheduleWasRunning) { & docker stop $Container | Out-Null; if ($LASTEXITCODE -ne 0) { throw '백업을 위해 일정 앱을 중지하지 못했습니다.' } }
    & docker run --rm --mount "type=volume,src=$Volume,dst=/data,readonly" --mount "type=bind,src=$scheduleBackupDirectory,dst=/backup" alpine:3.22 tar -czf "/backup/$scheduleBackupName" -C /data .
    if ($LASTEXITCODE -ne 0) { throw '일정 백업을 만들지 못했습니다.' }
    $scheduleBackupPath = Join-Path $scheduleBackupDirectory $scheduleBackupName
    Get-FileHash -Algorithm SHA256 -LiteralPath $scheduleBackupPath | Select-Object Algorithm,Hash,Path
} finally {
    if ($scheduleWasRunning) { & docker start $Container | Out-Null; if ($LASTEXITCODE -ne 0) { Write-Error '백업 후 일정 앱 재시작 실패' } }
}
