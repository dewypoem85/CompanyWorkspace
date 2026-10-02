param(
    [string]$ProjectRoot = (Get-Location).Path,
    [string]$BackupRoot = "backup",
    [int]$RetentionDays = 14
)

$ErrorActionPreference = "Stop"
$dataPath = Join-Path $ProjectRoot "data"
$keysPath = Join-Path $ProjectRoot "data-keys"
$dbPath = Join-Path $dataPath "leave-manager.db"
if (-not (Test-Path $dbPath)) { throw "DB 파일을 찾을 수 없습니다: $dbPath" }

$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$target = Join-Path $ProjectRoot (Join-Path $BackupRoot $stamp)
New-Item -ItemType Directory -Force -Path $target | Out-Null

Copy-Item $dbPath (Join-Path $target "leave-manager.db") -Force
if (Test-Path $keysPath) { Copy-Item $keysPath (Join-Path $target "data-keys") -Recurse -Force }

$cutoff = (Get-Date).AddDays(-$RetentionDays)
$backupBase = Join-Path $ProjectRoot $BackupRoot
if (Test-Path $backupBase) {
    Get-ChildItem $backupBase -Directory | Where-Object { $_.CreationTime -lt $cutoff } | Remove-Item -Recurse -Force
}

Write-Host "Backup completed: $target"
