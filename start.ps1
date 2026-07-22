$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $projectRoot

$env:PIP_CACHE_DIR = Join-Path $projectRoot ".cache\pip"
$python = Join-Path $projectRoot ".venv\Scripts\python.exe"

if (-not (Test-Path $python)) {
    throw "Local environment not found. Run .\setup.ps1 first."
}

Write-Host "Lumen Focus is available at http://127.0.0.1:5000"
& $python -m waitress --listen=127.0.0.1:5000 run:app

