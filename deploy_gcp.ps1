param(
  [string]$ProjectId = "",
  [string]$Region = "asia-east1",
  [string]$ServiceName = "yantu-backend",
  [string]$ArtifactRepo = "yantu",
  [string]$ImageTag = "latest"
)

$ErrorActionPreference = "Stop"

# PowerShell 7+ may treat non-zero exit codes from native commands as terminating
# errors when $ErrorActionPreference is "Stop". We intentionally probe for
# existence (e.g. Artifact Registry repo) via commands that may fail, so disable
# that behavior for this script.
if (Test-Path variable:PSNativeCommandUseErrorActionPreference) {
  $PSNativeCommandUseErrorActionPreference = $false
}

function Read-DotEnv([string]$FilePath) {
  $vars = @{}
  if (-not (Test-Path $FilePath)) {
    throw "Missing $FilePath"
  }

  Get-Content $FilePath | ForEach-Object {
    $line = $_.Trim()
    if ($line.Length -eq 0) { return }
    if ($line.StartsWith('#')) { return }

    $idx = $line.IndexOf('=')
    if ($idx -le 0) { return }

    $k = $line.Substring(0, $idx).Trim()
    $v = $line.Substring($idx + 1).Trim()

    # strip optional surrounding quotes
    if (($v.StartsWith('"') -and $v.EndsWith('"')) -or ($v.StartsWith("'") -and $v.EndsWith("'"))) {
      $v = $v.Substring(1, $v.Length - 2)
    }

    if ($k) { $vars[$k] = $v }
  }

  return $vars
}

function Ensure-Gcloud([string]$Cmd) {
  $gc = Get-Command $Cmd -ErrorAction SilentlyContinue
  if (-not $gc) {
    throw "gcloud not found in PATH. Install Google Cloud SDK and restart your terminal."
  }
}

Ensure-Gcloud "gcloud"

$envFile = Join-Path (Get-Location) '.env'
$vars = Read-DotEnv $envFile

$required = @(
  'DATABASE_URL',
  'R2_ENDPOINT_URL',
  'R2_ACCESS_KEY_ID',
  'R2_SECRET_ACCESS_KEY',
  'R2_BUCKET_NAME'
)
foreach ($k in $required) {
  if (-not $vars.ContainsKey($k) -or [string]::IsNullOrWhiteSpace($vars[$k])) {
    throw "Missing required env var in .env: $k"
  }
}

if ([string]::IsNullOrWhiteSpace($ProjectId)) {
  $ProjectId = (gcloud config get-value project 2>$null).Trim()
}
if ([string]::IsNullOrWhiteSpace($ProjectId)) {
  throw "GCP project is not set. Run: gcloud config set project <YOUR_PROJECT_ID> or pass -ProjectId."
}

Write-Host "[1/5] Project=$ProjectId Region=$Region Service=$ServiceName"

gcloud config set project $ProjectId | Out-Null

Write-Host "[2/5] Enabling required APIs (run, cloudbuild, artifactregistry)"
gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com | Out-Null

Write-Host "[3/5] Ensuring Artifact Registry repo exists: $ArtifactRepo ($Region)"
$null = & gcloud artifacts repositories describe $ArtifactRepo --location $Region 2>$null
if ($LASTEXITCODE -ne 0) {
  & gcloud artifacts repositories create $ArtifactRepo --repository-format=docker --location $Region | Out-Null
  if ($LASTEXITCODE -ne 0) {
    throw "Failed to create Artifact Registry repo: $ArtifactRepo"
  }
}

$image = "$Region-docker.pkg.dev/$ProjectId/$ArtifactRepo/yantu:$ImageTag"

Write-Host "[4/5] Building image with Cloud Build: $image"
# Use an explicit Cloud Build config so we always build with Dockerfile.cloudrun.
& gcloud builds submit --config cloudbuild.cloudrun.yaml --substitutions _IMAGE=$image .
if ($LASTEXITCODE -ne 0) {
  throw "Cloud Build failed. Check build logs in Cloud Console."
}

Write-Host "[5/5] Deploying to Cloud Run"
# Do not print secrets.
& gcloud run deploy $ServiceName `
  --image $image `
  --region $Region `
  --platform managed `
  --allow-unauthenticated `
  --port 8080 `
  --memory 1Gi `
  --set-env-vars "ENVIRONMENT=prod" `
  --set-env-vars "DATABASE_URL=$($vars['DATABASE_URL'])" `
  --set-env-vars "R2_ENDPOINT_URL=$($vars['R2_ENDPOINT_URL'])" `
  --set-env-vars "R2_ACCESS_KEY_ID=$($vars['R2_ACCESS_KEY_ID'])" `
  --set-env-vars "R2_SECRET_ACCESS_KEY=$($vars['R2_SECRET_ACCESS_KEY'])" `
  --set-env-vars "R2_BUCKET_NAME=$($vars['R2_BUCKET_NAME'])"
if ($LASTEXITCODE -ne 0) {
  throw "Cloud Run deploy failed."
}

$backendUrl = (gcloud run services describe $ServiceName --region $Region --format "value(status.url)").Trim()
Write-Host "Deployed backend URL: $backendUrl"
