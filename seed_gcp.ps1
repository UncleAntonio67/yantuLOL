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
# PowerShell 7.2+ can treat non-zero exit codes from native commands as PowerShell errors
# when $ErrorActionPreference=Stop. We always check $LASTEXITCODE ourselves for gcloud.
$global:PSNativeCommandUseErrorActionPreference = $false

function Resolve-Gcloud() {
  $cmd = Get-Command gcloud.cmd -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }
  $exe = Get-Command gcloud -ErrorAction SilentlyContinue
  if ($exe) { return $exe.Source }
  throw "gcloud not found on PATH"
}

function Ensure-Ok($lastExitCode, $msg) {
  if ($lastExitCode -ne 0) { throw $msg }
}

$gcloud = Resolve-Gcloud

function Invoke-GcloudViaCmd([string]$argsLine, [switch]$Quiet) {
  # Using cmd.exe avoids PowerShell converting gcloud stderr/non-zero to NativeCommandError
  # which would terminate the script under $ErrorActionPreference=Stop.
  $cmdLine = ('"' + $gcloud + '" ' + $argsLine)
  if ($Quiet) { $cmdLine += " >NUL 2>NUL" }
  cmd /c $cmdLine
  return $LASTEXITCODE
}

$global:LAST_GCLOUD_OUTPUT = @()
function Invoke-GcloudCapture([string]$argsLine) {
  $cmdLine = ('"' + $gcloud + '" ' + $argsLine)
  $out = cmd /c $cmdLine 2>&1
  $global:LAST_GCLOUD_OUTPUT = @($out)
  return $out
}

Write-Host "[1/4] Using project=$ProjectId region=$Region job=$JobName"
& $gcloud config set project $ProjectId | Out-Null
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
& $gcloud config set run/region $Region | Out-Null

$describeExit = Invoke-GcloudViaCmd "run jobs describe $JobName --region $Region" -Quiet
if ($LASTEXITCODE -eq 0) {
  $exit = Invoke-GcloudViaCmd ("run jobs update {0} --region {1} --image {2} --command python --args {3} --env-vars-file {4} --memory 1Gi --max-retries 0 --tasks 1" -f $JobName,$Region,$Image,$argsCsv,$EnvVarsFile)
  Ensure-Ok $exit "Failed to update Cloud Run job"
} else {
  $exit = Invoke-GcloudViaCmd ("run jobs create {0} --region {1} --image {2} --command python --args {3} --env-vars-file {4} --memory 1Gi --max-retries 0 --tasks 1" -f $JobName,$Region,$Image,$argsCsv,$EnvVarsFile)
  Ensure-Ok $exit "Failed to create Cloud Run job"
}

Write-Host "[4/4] Executing job (waiting for completion)..."
$exit = Invoke-GcloudViaCmd ("run jobs execute {0} --region {1} --wait" -f $JobName,$Region)
if ($exit -ne 0) {
  Write-Host ""
  Write-Host "Seed job failed. Fetching latest execution details and logs..."
  $execName = (Invoke-GcloudCapture ("run jobs executions list --job {0} --region {1} --limit 1 --sort-by=~createTime --format=value(name)" -f $JobName,$Region) | Select-Object -First 1).Trim()
  if ($execName) {
    Write-Host ""
    Write-Host ("Execution: {0}" -f $execName)
    Write-Host ""
    Invoke-GcloudCapture ("run jobs executions describe {0} --region {1}" -f $execName,$Region) | Write-Host
    Write-Host ""
    Write-Host "[logs] (last 200 lines)"
    $logs = Invoke-GcloudCapture ("run jobs executions logs read {0} --region {1} --limit 200" -f $execName,$Region)
    if ($LASTEXITCODE -eq 0) {
      $logs | Write-Host
    } else {
      Write-Host "Failed to read logs via gcloud. Open Cloud Console execution details:"
      Write-Host ("https://console.cloud.google.com/run/jobs/executions/details/{0}/{1}?project={2}" -f $Region,$execName,$ProjectId)
    }
  } else {
    Write-Host "Unable to resolve latest execution name. List executions:"
    Invoke-GcloudCapture ("run jobs executions list --job {0} --region {1} --limit 5" -f $JobName,$Region) | Write-Host
  }
  throw "Seed job execution failed"
}

Write-Host ""
Write-Host "Seed job finished. If this was first-time bootstrap, remove BOOTSTRAP_* env vars from the Cloud Run service after you can log in."

Write-Host ""
Write-Host "Seed job finished. If this was first-time bootstrap, remove BOOTSTRAP_* env vars from the Cloud Run service after you can log in."
