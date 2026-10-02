param([switch]$SkipBuild)
$ErrorActionPreference = 'Stop'
$repoDirectory = Split-Path -Parent $PSScriptRoot
Push-Location $repoDirectory
try {
    if (-not (Test-Path -LiteralPath '.env')) { throw 'Prepare the production .env first (see docs/OPERATIONS.md).' }
    docker compose config --quiet
    if ($LASTEXITCODE -ne 0) { throw 'Compose validation failed.' }
    if (-not $SkipBuild) {
        docker compose build
        if ($LASTEXITCODE -ne 0) { throw 'Build failed; existing services were left running.' }
    }
    docker compose up -d --no-build --wait --wait-timeout 120
    if ($LASTEXITCODE -ne 0) { throw 'Deployment health check failed. Inspect docker compose ps and logs.' }
    docker compose ps
} finally { Pop-Location }
