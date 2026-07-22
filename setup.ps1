$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $projectRoot

$env:PIP_CACHE_DIR = Join-Path $projectRoot ".cache\pip"
$env:npm_config_cache = Join-Path $projectRoot ".cache\npm"

if (-not (Test-Path ".venv\Scripts\python.exe")) {
    python -m venv .venv
}
& ".\.venv\Scripts\python.exe" -m pip install --disable-pip-version-check -r requirements.txt

$requiredAssets = @(
    "static\vendor\mediapipe\vision_bundle.mjs",
    "static\vendor\mediapipe\wasm\vision_wasm_internal.wasm",
    "static\models\face_landmarker.task",
    "static\models\efficientdet_lite0.tflite",
    "static\models\hand_landmarker.task"
)
foreach ($asset in $requiredAssets) {
    if (-not (Test-Path $asset)) {
        throw "Required local model asset is missing: $asset"
    }
}

Write-Host "Setup complete. Run .\start.ps1 and open http://127.0.0.1:5000"
