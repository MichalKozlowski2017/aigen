<#
.SYNOPSIS
  Jeden skrypt: ComfyUI + cloudflared Quick Tunnel + aigen queue worker.

.DESCRIPTION
  Skopiuj ten folder do katalogu ComfyUI (obok main.py) albo uruchom z AIGen:
    powershell -File scripts/legion/start-comfy-stack.ps1 -ComfyRoot "C:\Users\...\ComfyUI"

  Po starcie Quick Tunnel URL trafia do:
    <ComfyRoot>\logs\cloudflared-tunnel-url.txt
  Bez domeny: ustaw AIGEN_PANEL_URL + COMFY_URL_UPDATE_SECRET na Legionie —
  skrypt wywoła publish-comfy-url.ps1 (POST /api/settings/comfy-url).
  Named Tunnel (stały hostname) — docs/named-cloudflare-tunnel.md.

.NOTES
  Wymaga: cloudflared w PATH, venv Comfy (opcjonalnie), Python.
#>
[CmdletBinding()]
param(
  [string]$ComfyRoot = "",
  [string]$Listen = "127.0.0.1",
  [int]$Port = 8188,
  [switch]$SkipWorker,
  [switch]$SkipTunnel,
  [string[]]$ComfyExtraArgs = @()
)

$ErrorActionPreference = "Stop"

function Resolve-ComfyRoot {
  param([string]$Hint)
  if ($Hint -and (Test-Path (Join-Path $Hint "main.py"))) { return (Resolve-Path $Hint).Path }
  $here = $PSScriptRoot
  # scripts/legion → repo aigen; albo skrypt leży bezpośrednio w ComfyUI\scripts\legion
  foreach ($cand in @(
      (Join-Path $here "..\.."),
      (Join-Path $here "..\..\.."),
      (Join-Path $here ".."),
      $here,
      "C:\Users\mkozl\Sites\ComfyUI"
    )) {
    $p = [System.IO.Path]::GetFullPath($cand)
    if (Test-Path (Join-Path $p "main.py")) { return $p }
  }
  throw "Nie znaleziono ComfyUI (main.py). Podaj -ComfyRoot."
}

$root = Resolve-ComfyRoot -Hint $ComfyRoot
$logs = Join-Path $root "logs"
New-Item -ItemType Directory -Force -Path $logs | Out-Null

$urlFile = Join-Path $logs "cloudflared-tunnel-url.txt"
$tunnelLog = Join-Path $logs "cloudflared-tunnel.log"
$stackLog = Join-Path $logs "aigen-stack.log"

function Write-StackLog([string]$msg) {
  $line = "[{0}] {1}" -f (Get-Date -Format "o"), $msg
  Add-Content -Path $stackLog -Value $line
  Write-Host $line
}

function Test-ComfyUp {
  try {
    $r = Invoke-WebRequest -Uri "http://${Listen}:${Port}/system_stats" -UseBasicParsing -TimeoutSec 2
    return ($r.StatusCode -eq 200)
  } catch { return $false }
}

function Start-ComfyIfNeeded {
  if (Test-ComfyUp) {
    Write-StackLog "ComfyUI juz dziala na ${Listen}:${Port}"
    return
  }
  $venvPy = Join-Path $root "venv\Scripts\python.exe"
  $py = if (Test-Path $venvPy) { $venvPy } else { "python" }
  $args = @("main.py", "--listen", $Listen, "--port", "$Port") + $ComfyExtraArgs
  Write-StackLog "Start ComfyUI: $py $($args -join ' ')"
  Start-Process -FilePath $py -ArgumentList $args -WorkingDirectory $root -WindowStyle Minimized
  $deadline = (Get-Date).AddSeconds(90)
  while ((Get-Date) -lt $deadline) {
    if (Test-ComfyUp) {
      Write-StackLog "ComfyUI OK (/system_stats 200)"
      return
    }
    Start-Sleep -Seconds 2
  }
  throw "ComfyUI nie odpowiedzial na /system_stats w 90s"
}

function Start-TunnelIfNeeded {
  if ($SkipTunnel) {
    Write-StackLog "Pomijam tunnel (-SkipTunnel)"
    return
  }
  $existing = Get-Process -Name cloudflared -ErrorAction SilentlyContinue
  if ($existing) {
    Write-StackLog "cloudflared juz dziala (PID $($existing.Id -join ','))"
    if (Test-Path $urlFile) {
      $prev = (Get-Content $urlFile -Raw).Trim()
      Write-StackLog "URL: $prev"
    }
    return
  }
  $cf = Get-Command cloudflared -ErrorAction SilentlyContinue
  if (-not $cf) {
    throw "Brak cloudflared w PATH (winget install Cloudflare.cloudflared)"
  }
  if (Test-Path $tunnelLog) { Remove-Item $tunnelLog -Force }
  if (Test-Path $urlFile) { Remove-Item $urlFile -Force }

  Write-StackLog "Start cloudflared Quick Tunnel → http://${Listen}:${Port}"
  $arg = "tunnel --url http://${Listen}:${Port}"
  Start-Process -FilePath $cf.Source -ArgumentList $arg -WorkingDirectory $root `
    -RedirectStandardOutput $tunnelLog -RedirectStandardError $tunnelLog `
    -WindowStyle Hidden

  $deadline = (Get-Date).AddSeconds(45)
  $url = $null
  while ((Get-Date) -lt $deadline) {
    Start-Sleep -Seconds 1
    if (-not (Test-Path $tunnelLog)) { continue }
    $text = Get-Content $tunnelLog -Raw -ErrorAction SilentlyContinue
    if (-not $text) { continue }
    $m = [regex]::Match($text, "https://[a-zA-Z0-9-]+\.trycloudflare\.com")
    if ($m.Success) {
      $url = $m.Value
      Set-Content -Path $urlFile -Value $url -NoNewline
      Write-StackLog "Tunnel URL zapisany: $url"
      Write-StackLog "Ustaw Vercel COMFYUI_URL=$url (Quick Tunnel zmienia sie po reboocie)"
      return
    }
  }
  throw "Nie udalo sie odczytac URL z $tunnelLog"
}

function Start-WorkerIfNeeded {
  if ($SkipWorker) {
    Write-StackLog "Pomijam queue worker (-SkipWorker)"
    return
  }
  $workerScript = Join-Path $PSScriptRoot "start-queue-worker.ps1"
  if (-not (Test-Path $workerScript)) {
    Write-StackLog "Brak start-queue-worker.ps1 — pomijam worker"
    return
  }
  & $workerScript -ComfyRoot $root
}

function Start-EngineControlIfNeeded {
  # Osobny proces (port 8199). Zostaje, gdy stopujemy Comfy na 8188 —
  # panel musi moc wrocic z kodera na Comfy.
  $ctl = Join-Path $PSScriptRoot "start-engine-control.ps1"
  if (-not (Test-Path $ctl)) {
    Write-StackLog "Brak start-engine-control.ps1 — pomijam sterowanie GPU"
    return
  }
  if (-not $env:LEGION_ENGINE_SECRET) {
    Write-StackLog "Engine control pominiety (ustaw LEGION_ENGINE_SECRET — bez sekretu nie nasluchujemy)"
    return
  }
  try {
    & $ctl
  } catch {
    Write-StackLog "Engine control nieudany: $($_.Exception.Message)"
  }
}

function Publish-ComfyUrlIfConfigured {
  if (-not (Test-Path $urlFile)) { return }
  $panel = $env:AIGEN_PANEL_URL
  if (-not $panel) { $panel = $env:AIGEN_URL }
  $secret = $env:COMFY_URL_UPDATE_SECRET
  if (-not $panel -or -not $secret) {
    Write-StackLog "Auto-publish pominiety (ustaw AIGEN_PANEL_URL + COMFY_URL_UPDATE_SECRET)"
    return
  }
  $pub = Join-Path $PSScriptRoot "publish-comfy-url.ps1"
  if (-not (Test-Path $pub)) {
    Write-StackLog "Brak publish-comfy-url.ps1 — pomijam"
    return
  }
  try {
    Write-StackLog "Auto-publish Quick Tunnel URL → $panel"
    & $pub -ComfyRoot $root -PanelUrl $panel -Secret $secret
  } catch {
    Write-StackLog "Auto-publish nieudany: $($_.Exception.Message)"
  }
}

Write-StackLog "=== start-comfy-stack root=$root ==="
Start-ComfyIfNeeded
Start-TunnelIfNeeded
Publish-ComfyUrlIfConfigured
Start-WorkerIfNeeded
Start-EngineControlIfNeeded
Write-StackLog "=== stack gotowy ==="
if (Test-Path $urlFile) {
  $finalUrl = (Get-Content $urlFile -Raw).Trim()
  Write-Host ""
  Write-Host "COMFYUI_URL=$finalUrl" -ForegroundColor Cyan
  if ($env:AIGEN_PANEL_URL -or $env:AIGEN_URL) {
    Write-Host "Auto-publish: AIGEN_PANEL_URL ustawione (patrz log wyzej)." -ForegroundColor Cyan
  } else {
    Write-Host "Bez domeny: ustaw AIGEN_PANEL_URL + COMFY_URL_UPDATE_SECRET i re-run, albo:" -ForegroundColor Yellow
    Write-Host "  powershell -File scripts\legion\publish-comfy-url.ps1 -ComfyRoot `"$root`"" -ForegroundColor Yellow
  }
}
