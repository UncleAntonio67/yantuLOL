param(
  [Parameter(Mandatory = $true)]
  [string]$ProjectId,

  [Parameter(Mandatory = $false)]
  [string]$Region = "asia-east1",

  [Parameter(Mandatory = $false)]
  [string]$JobName = "yantu-seed",

  [Parameter(Mandatory = $false)]
  [string]$Image = "",

  [Parameter(Mandatory = $false)]
  [string]$EnvVarsFile = "env-bootstrap.yaml",

  [Parameter(Mandatory = $false)]
  [switch]$Purge = $true,

  [Parameter(Mandatory = $false)]
  [switch]$RequireR2 = $true
)

$ErrorActionPreference = "Stop"

function Ensure-Ok($lastExitCode, $msg) {
  if ($lastExitCode -ne 0) { throw $msg }
}

Write-Host "[1/4] Using project=$ProjectId region=$Region job=$JobName"
gcloud config set project $ProjectId | Out-Null
Ensure-Ok $LASTEXITCODE "Failed to set gcloud project"

if ([string]::IsNullOrWhiteSpace($Image)) {
  # This matches our deploy script convention.
  $Image = "$Region-docker.pkg.dev/$ProjectId/yantu/yantu:latest"
}
Write-Host "[2/4] Image=$Image"

if (-not (Test-Path $EnvVarsFile)) {
  throw "Env vars file not found: $EnvVarsFile (Tip: keep secrets out of git; this repo ignores env-*.yaml)"
}

$argsList = @("/srv/backend/scripts/seed_neon_r2.py")
if ($RequireR2) { $argsList += "--require-r2" }
if ($Purge) { $argsList += "--purge" }
$argsCsv = ($argsList -join ",")

Write-Host "[3/4] Creating or updating Cloud Run job..."
gcloud run jobs describe $JobName --region $Region *> $null
if ($LASTEXITCODE -eq 0) {
  gcloud run jobs update $JobName `
    --region $Region `
    --image $Image `
    --command python `
    --args $argsCsv `
    --env-vars-file $EnvVarsFile `
    --memory 1Gi `
    --max-retries 0 `
    --tasks 1 | Out-Null
  Ensure-Ok $LASTEXITCODE "Failed to update Cloud Run job"
} else {
  gcloud run jobs create $JobName `
    --region $Region `
    --image $Image `
    --command python `
    --args $argsCsv `
    --env-vars-file $EnvVarsFile `
    --memory 1Gi `
    --max-retries 0 `
    --tasks 1 | Out-Null
  Ensure-Ok $LASTEXITCODE "Failed to create Cloud Run job"
}

Write-Host "[4/4] Executing job (waiting for completion)..."
gcloud run jobs execute $JobName --region $Region --wait
Ensure-Ok $LASTEXITCODE "Seed job execution failed"

Write-Host ""
Write-Host "Seed job finished. If this was first-time bootstrap, remove BOOTSTRAP_* env vars from the Cloud Run service after you can log in."
