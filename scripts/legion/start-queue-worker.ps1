<#
.SYNOPSIS
  Start aigen-queue-worker.py jeśli nie działa (z odpornością na stale PID po reboocie).
#>
[CmdletBinding()]
param(
  [string]$ComfyRoot = "",
  [double]$PollSeconds = 4.0
)

$ErrorActionPreference = "Stop"

function Resolve-ComfyRoot {
  param([string]$Hint)
  if ($Hint -and (Test-Path (Join-Path $Hint "main.py"))) { return (Resolve-Path $Hint).Path }
  foreach ($cand in @(
      (Join-Path $PSScriptRoot "..\.."),
      (Join-Path $PSScriptRoot ".."),
      "C:\Users\mkozl\Sites\ComfyUI"
    )) {
    $p = [System.IO.Path]::GetFullPath($cand)
    if (Test-Path (Join-Path $p "main.py")) { return $p }
  }
  throw "Nie znaleziono ComfyUI. Podaj -ComfyRoot."
}

$root = Resolve-ComfyRoot -Hint $ComfyRoot
$workerDir = Join-Path $root "user\aigen-queue-worker"
New-Item -ItemType Directory -Force -Path $workerDir | Out-Null
$pidFile = Join-Path $workerDir "pid.txt"
$logFile = Join-Path $workerDir "worker.log"

function Test-WorkerAlive([int]$ProcId) {
  $p = Get-Process -Id $ProcId -ErrorAction SilentlyContinue
  if (-not $p) { return $false }
  # Po reboocie Windows moze recyklowac PID — sprawdz nazwe procesu.
  $name = $p.ProcessName.ToLowerInvariant()
  if ($name -match "python|py|pythonw") { return $true }
  return $false
}

if (Test-Path $pidFile) {
  $raw = (Get-Content $pidFile -Raw).Trim()
  $oldId = 0
  if ([int]::TryParse($raw, [ref]$oldId) -and $oldId -gt 0) {
    if (Test-WorkerAlive $oldId) {
      Write-Host "Queue worker juz dziala (PID $oldId)"
      exit 0
    }
    $stale = Get-Process -Id $oldId -ErrorAction SilentlyContinue
    $staleName = if ($stale) { $stale.ProcessName } else { "gone" }
    Write-Host "Stale PID $oldId ($staleName) — czyszcze pid.txt"
    Remove-Item $pidFile -Force -ErrorAction SilentlyContinue
  }
}

$candidates = @(
  (Join-Path $root "custom_nodes\aigen-queue-worker\aigen-queue-worker.py"),
  (Join-Path $root "user\aigen-queue-worker\aigen-queue-worker.py"),
  (Join-Path $root "aigen-queue-worker.py"),
  (Join-Path $PSScriptRoot "..\aigen-queue-worker.py")
)
$workerPy = $candidates | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $workerPy) {
  Write-Host "Brak aigen-queue-worker.py — pomijam (opcjonalny)."
  exit 0
}

$venvPy = Join-Path $root "venv\Scripts\python.exe"
$py = if (Test-Path $venvPy) { $venvPy } else { "python" }

Write-Host "Start queue worker: $workerPy"
$argList = @(
  $workerPy,
  "--comfy-url", "http://127.0.0.1:8188",
  "--poll", "$PollSeconds"
)
# Worker sam zapisuje pid.txt — startujemy w tle.
Start-Process -FilePath $py -ArgumentList $argList -WorkingDirectory $root `
  -RedirectStandardOutput $logFile -RedirectStandardError $logFile `
  -WindowStyle Hidden

Start-Sleep -Seconds 2
if (Test-Path $pidFile) {
  Write-Host "Worker PID: $((Get-Content $pidFile -Raw).Trim())"
} else {
  Write-Host "Worker uruchomiony (brak pid.txt jeszcze) — log: $logFile"
}
