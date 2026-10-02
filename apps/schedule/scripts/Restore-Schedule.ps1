param(
    [Parameter(Mandatory = $true)][string]$BackupFile,
    [Parameter(Mandatory = $true)][string]$NewVolume
)
$ErrorActionPreference = 'Stop'
# 기존 볼륨을 덮어쓰지 않고 새 볼륨에 복구한다. 운영 전환은 검증 후 별도로 수행한다.
if ($NewVolume -notmatch '^schedule-restore-[a-zA-Z0-9-]+$') { throw '새 볼륨 이름은 schedule-restore-로 시작해야 합니다.' }
$scheduleRestoreFile = (Resolve-Path -LiteralPath $BackupFile).Path
if (-not (Test-Path -LiteralPath $scheduleRestoreFile -PathType Leaf)) { throw '백업 파일이 없습니다.' }
& docker volume inspect $NewVolume 2>$null | Out-Null
if ($LASTEXITCODE -eq 0) { throw '이미 존재하는 볼륨에는 복구하지 않습니다. 새 이름을 사용하세요.' }
& docker volume create $NewVolume | Out-Null
if ($LASTEXITCODE -ne 0) { throw '복구용 볼륨 생성 실패' }
& docker run --rm --mount "type=volume,src=$NewVolume,dst=/data" --mount "type=bind,src=$scheduleRestoreFile,dst=/backup.tar.gz,readonly" alpine:3.22 tar -xzf /backup.tar.gz -C /data
if ($LASTEXITCODE -ne 0) { throw '복구 실패. 운영 볼륨은 변경하지 않았습니다.' }
Write-Output "새 복구 볼륨: $NewVolume. 운영 앱에 연결하기 전에 DB 무결성과 이미지 개수를 검증하세요."
