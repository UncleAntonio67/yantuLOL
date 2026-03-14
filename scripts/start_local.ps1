param(
  [switch]$UseVite
)

$ErrorActionPreference = "Stop"

$repo = Split-Path -Parent $PSScriptRoot
Set-Location $repo

Write-Host "[start] repo=$repo"

# 1) Backend (FastAPI)
# Note: for Windows dev, reload is useful. For production use Docker Compose.
Write-Host "[start] backend: http://127.0.0.1:8000/docs"
Start-Process -FilePath "python" -WorkingDirectory (Join-Path $repo "backend") -ArgumentList @(
  "-m","uvicorn","app.main:app",
  "--host","127.0.0.1",
  "--port","8000",
  "--reload"
)

Start-Sleep -Milliseconds 600

# 2) Frontend
if ($UseVite) {
  Write-Host "[start] frontend (vite): http://127.0.0.1:5173"
  Start-Process -FilePath "npm.cmd" -WorkingDirectory (Join-Path $repo "frontend") -ArgumentList @(
    "run","dev","--","--host","127.0.0.1","--port","5173"
  )
} else {
  $dist = Join-Path $repo "frontend\\dist\\index.html"
  if (!(Test-Path $dist)) {
    Write-Host "[build] frontend dist missing, running npm run build..."
    Push-Location (Join-Path $repo "frontend")
    try {
      npm.cmd run build
    } finally {
      Pop-Location
    }
  }

  Write-Host "[start] frontend (dist+proxy): http://127.0.0.1:5173"
  Start-Process -FilePath "python" -WorkingDirectory $repo -ArgumentList @(
    "-m","uvicorn","frontend_proxy_app:app",
    "--host","127.0.0.1",
    "--port","5173"
  )
}

Write-Host ""
Write-Host "[ok] backend:  http://127.0.0.1:8000/docs"
Write-Host "[ok] frontend: http://127.0.0.1:5173"

