param(
  [string]$ProjectId = "",
  [string]$Region = "asia-east1",
  [string]$ServiceName = "yantu-backend",
  [string]$ArtifactRepo = "yantu",
  [string]$ImageTag = "latest"
)

$ErrorActionPreference = "Stop"

# PowerShell 7+ may treat native stderr output as error records; keep gcloud failures
# non-terminating so we can branch on $LASTEXITCODE explicitly.
if (Test-Path variable:PSNativeCommandUseErrorActionPreference) { $PSNativeCommandUseErrorActionPreference = $false }

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

function Resolve-GcloudCommand() {
  # Prefer gcloud.cmd over gcloud.ps1 to avoid PowerShell-native error behavior.
  $cmd = Get-Command gcloud -ErrorAction SilentlyContinue
  if (-not $cmd) { return $null }
  if ($cmd.Source -and $cmd.Source.ToLower().EndsWith("gcloud.ps1")) {
    $dir = Split-Path -Parent $cmd.Source
    $gcCmd = Join-Path $dir "gcloud.cmd"
    if (Test-Path $gcCmd) { return $gcCmd }
  }
  return "gcloud"
}

$Gcloud = Resolve-GcloudCommand
if (-not $Gcloud) { throw "gcloud not found in PATH. Install Google Cloud SDK and restart your terminal." }

function Invoke-Gcloud {
  param(
    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]]$Args
  )
  $prev = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  try {
    & $Gcloud @Args
    return $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $prev
  }
}

function Invoke-GcloudQuiet {
  param(
    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]]$Args
  )
  $prev = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  try {
    & $Gcloud @Args 2>$null | Out-Null
    return $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $prev
  }
}

function Invoke-GcloudCapture {
  param(
    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]]$Args
  )
  $prev = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  try {
    $out = & $Gcloud @Args 2>$null
    if ($LASTEXITCODE -ne 0) { return $null }
    return ($out | Out-String).Trim()
  } finally {
    $ErrorActionPreference = $prev
  }
}

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
  $ProjectId = (Invoke-GcloudCapture config get-value project)
}
if ([string]::IsNullOrWhiteSpace($ProjectId)) {
  throw "GCP project is not set. Run: gcloud config set project <YOUR_PROJECT_ID> or pass -ProjectId."
}

Write-Host "[1/5] Project=$ProjectId Region=$Region Service=$ServiceName"

$null = Invoke-Gcloud config set project $ProjectId

Write-Host "[2/5] Enabling required APIs (run, cloudbuild, artifactregistry)"
$null = Invoke-Gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com

Write-Host "[3/5] Ensuring Artifact Registry repo exists: $ArtifactRepo ($Region)"
$code = Invoke-GcloudQuiet artifacts repositories describe $ArtifactRepo --location $Region
if ($code -ne 0) {
  $code2 = Invoke-Gcloud artifacts repositories create $ArtifactRepo --repository-format=docker --location $Region
  if ($code2 -ne 0) {
    throw "Failed to create Artifact Registry repo: $ArtifactRepo"
  }
}

$image = "$Region-docker.pkg.dev/$ProjectId/$ArtifactRepo/yantu:$ImageTag"

Write-Host "[4/5] Building image with Cloud Build: $image"
# Use an explicit Cloud Build config so we always build with Dockerfile.cloudrun.
$buildOut = @()
$prev = $ErrorActionPreference
$ErrorActionPreference = "Continue"
try {
  # Capture stderr too because gcloud prints the build URL/id there.
  $buildOut = & $Gcloud builds submit --config cloudbuild.cloudrun.yaml --substitutions=_IMAGE=$image . 2>&1
  $code = $LASTEXITCODE
} finally {
  $ErrorActionPreference = $prev
}

$buildText = ($buildOut | Out-String)
$buildId = $null
if ($buildText -match 'builds/([0-9a-fA-F-]{16,})') {
  $buildId = $Matches[1]
}
if ($buildId) {
  Write-Host "Cloud Build id: $buildId"
  Write-Host "Tip: gcloud builds log $buildId --project $ProjectId --stream"
}

if ($code -ne 0) {
  if ($buildId) {
    throw "Cloud Build failed (build id: $buildId). Run: gcloud builds log $buildId --project $ProjectId"
  }
  throw "Cloud Build failed. Check build logs in Cloud Console."
}

Write-Host "[5/5] Deploying to Cloud Run"
# Do not print secrets.
$code = Invoke-Gcloud run deploy $ServiceName `
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
if ($code -ne 0) {
  throw "Cloud Run deploy failed."
}

$backendUrl = Invoke-GcloudCapture run services describe $ServiceName --region $Region --format "value(status.url)"
if ($backendUrl) {
  Write-Host "Deployed backend URL: $backendUrl"
}
