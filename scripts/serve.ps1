$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

$Python = Join-Path $Root ".venv\Scripts\python.exe"
$Pip = Join-Path $Root ".venv\Scripts\pip.exe"

if (-not (Test-Path $Python)) {
    Write-Host "Creating virtual environment..."
    python -m venv .venv
}

Write-Host "Installing Python dependencies..."
& $Python -m pip install -q -r requirements.txt

$backendJob = Start-Job -ScriptBlock {
    param($py, $root, $pathEnv)
    $env:Path = $pathEnv
    Set-Location $root
    & $py -m uvicorn backend.app:app --reload --port 8000 2>&1
} -ArgumentList $Python, $Root, $env:Path

Start-Sleep -Seconds 2

$frontendDir = Join-Path $Root "frontend"
if (-not (Test-Path (Join-Path $frontendDir "node_modules"))) {
    Write-Host "Installing frontend dependencies..."
    Push-Location $frontendDir
    npm install
    Pop-Location
}

Write-Host ""
Write-Host "Pixelate Subject is starting:"
Write-Host "  Frontend: http://localhost:5173"
Write-Host "  Backend:  http://localhost:8000/api/health"
Write-Host ""
Write-Host "Press Ctrl+C to stop both servers."
Write-Host ""

try {
    Push-Location $frontendDir
    npm run dev
} finally {
    Stop-Job $backendJob -ErrorAction SilentlyContinue
    Remove-Job $backendJob -Force -ErrorAction SilentlyContinue
    Pop-Location
}
