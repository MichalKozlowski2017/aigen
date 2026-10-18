<#
.SYNOPSIS
  Publikuje aktualny Quick Tunnel URL do panelu AIGen (Vercel) bez ręcznych Settings.

.DESCRIPTION
  Option A (domyślnie): POST /api/settings/comfy-url z Bearer COMFY_URL_UPDATE_SECRET
  (dedykowany; REVALIDATE_SECRET nie wystarczy). Panel trzyma override w pamięci
  + opcjonalnie Vercel KV (KV_REST_API_*) — bez redeploy.
  Hosty: *.trycloudflare.com (+ COMFY_URL_ALLOW_HOSTS na Vercel).

  Option B (-UpdateVercelEnv): aktualizuje env COMFYUI_URL przez Vercel REST API
  i próbuje redeploy (wolniejsze, działa bez KV).

  Zmienne ENV (Legion):
    AIGEN_PANEL_URL          np. https://aigen.vercel.app
    COMFY_URL_UPDATE_SECRET   ten sam sekret co na Vercel (wymagany)
    VERCEL_TOKEN / VERCEL_PROJECT_ID / VERCEL_TEAM_ID  — tylko Option B

.EXAMPLE
  powershell -File scripts\legion\publish-comfy-url.ps1 `
    -PanelUrl "https://aigen.vercel.app" `
    -Secret $env:COMFY_URL_UPDATE_SECRET

.EXAMPLE
  powershell -File scripts\legion\publish-comfy-url.ps1 -ComfyRoot "C:\Users\mkozl\Sites\ComfyUI"
#>
[CmdletBinding()]
param(
  [string]$ComfyRoot = "",
  [string]$Url = "",
  [string]$PanelUrl = "",
  [string]$Secret = "",
  [switch]$UpdateVercelEnv,
  [string]$VercelToken = "",
  [string]$VercelProjectId = "",
  [string]$VercelTeamId = ""
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
  return $null
}

function Read-TunnelUrl([string]$Root) {
  if (-not $Root) { return $null }
  $f = Join-Path $Root "logs\cloudflared-tunnel-url.txt"
  if (-not (Test-Path $f)) { return $null }
  $u = (Get-Content $f -Raw).Trim()
  if ($u -match "^https?://") { return $u.TrimEnd("/") }
  return $null
}

if (-not $Url) {
  $root = Resolve-ComfyRoot -Hint $ComfyRoot
  $Url = Read-TunnelUrl -Root $root
}
if (-not $Url) {
  throw "Brak URL. Podaj -Url albo upewnij sie ze istnieje logs\cloudflared-tunnel-url.txt"
}
$Url = $Url.Trim().TrimEnd("/")

if (-not $PanelUrl) { $PanelUrl = $env:AIGEN_PANEL_URL }
if (-not $PanelUrl) { $PanelUrl = $env:AIGEN_URL }
if (-not $Secret) {
  $Secret = $env:COMFY_URL_UPDATE_SECRET
}

if (-not $UpdateVercelEnv) {
  if (-not $PanelUrl) {
    throw "Brak -PanelUrl / AIGEN_PANEL_URL (np. https://twoj-projekt.vercel.app)"
  }
  if (-not $Secret) {
    throw "Brak -Secret / COMFY_URL_UPDATE_SECRET (REVALIDATE_SECRET nie wystarczy)"
  }

  $endpoint = ($PanelUrl.TrimEnd("/")) + "/api/settings/comfy-url"
  Write-Host "POST $endpoint"
  Write-Host "  url=$Url"

  $body = @{ url = $Url } | ConvertTo-Json -Compress
  $headers = @{
    Authorization  = "Bearer $Secret"
    "Content-Type" = "application/json"
  }

  try {
    $res = Invoke-RestMethod -Method Post -Uri $endpoint -Headers $headers -Body $body -TimeoutSec 30
  } catch {
    throw "Publish nieudany: $($_.Exception.Message)"
  }

  Write-Host ($res | ConvertTo-Json -Depth 5)
  if (-not $res.ok) {
    throw "API zwrocilo ok=false"
  }
  if ($res.durable) {
    Write-Host "OK — durable (KV). Galeria/proxy uzyja nowego URL bez redeploy." -ForegroundColor Green
  } else {
    Write-Host "OK — override w pamieci. Dla trwalosci: wlacz Vercel KV albo uzyj -UpdateVercelEnv." -ForegroundColor Yellow
  }
  exit 0
}

# --- Option B: Vercel REST env update + redeploy ---
if (-not $VercelToken) { $VercelToken = $env:VERCEL_TOKEN }
if (-not $VercelProjectId) { $VercelProjectId = $env:VERCEL_PROJECT_ID }
if (-not $VercelTeamId) { $VercelTeamId = $env:VERCEL_TEAM_ID }

if (-not $VercelToken -or -not $VercelProjectId) {
  throw "Option B wymaga -VercelToken / VERCEL_TOKEN oraz -VercelProjectId / VERCEL_PROJECT_ID"
}

function Get-VercelQs {
  $q = "projectId=$([uri]::EscapeDataString($VercelProjectId))"
  if ($VercelTeamId) { $q += "&teamId=$([uri]::EscapeDataString($VercelTeamId))" }
  return $q
}

$headers = @{
  Authorization  = "Bearer $VercelToken"
  "Content-Type" = "application/json"
}
$qs = Get-VercelQs

Write-Host "Vercel env upsert COMFYUI_URL=$Url"

$listUrl = "https://api.vercel.com/v9/projects/$([uri]::EscapeDataString($VercelProjectId))/env?$qs"
$existing = Invoke-RestMethod -Method Get -Uri $listUrl -Headers $headers
$comfyEnv = @($existing.envs) | Where-Object { $_.key -eq "COMFYUI_URL" } | Select-Object -First 1

$payloadObj = @{
  key    = "COMFYUI_URL"
  value  = $Url
  type   = "plain"
  target = @("production", "preview", "development")
}
$payload = $payloadObj | ConvertTo-Json -Compress

if ($comfyEnv -and $comfyEnv.id) {
  $patchUrl = "https://api.vercel.com/v9/projects/$([uri]::EscapeDataString($VercelProjectId))/env/$($comfyEnv.id)?$qs"
  Invoke-RestMethod -Method Patch -Uri $patchUrl -Headers $headers -Body $payload | Out-Null
  Write-Host "Zaktualizowano istniejace env id=$($comfyEnv.id)"
} else {
  $createUrl = "https://api.vercel.com/v10/projects/$([uri]::EscapeDataString($VercelProjectId))/env?$qs"
  Invoke-RestMethod -Method Post -Uri $createUrl -Headers $headers -Body $payload | Out-Null
  Write-Host "Utworzono nowe env COMFYUI_URL"
}

$depQs = "projectId=$([uri]::EscapeDataString($VercelProjectId))&target=production&limit=1"
if ($VercelTeamId) { $depQs += "&teamId=$([uri]::EscapeDataString($VercelTeamId))" }
$deps = Invoke-RestMethod -Method Get -Uri "https://api.vercel.com/v6/deployments?$depQs" -Headers $headers
$latest = @($deps.deployments) | Select-Object -First 1
if (-not $latest) {
  Write-Host "Env OK. Brak deploymentu — Redeploy recznie w Vercel Dashboard." -ForegroundColor Yellow
  exit 0
}

$redeployQs = if ($VercelTeamId) { "?teamId=$([uri]::EscapeDataString($VercelTeamId))" } else { "" }
try {
  $rd = Invoke-RestMethod -Method Post `
    -Uri "https://api.vercel.com/v13/deployments/$($latest.uid)/redeploy$redeployQs" `
    -Headers $headers
  Write-Host "Redeploy started (uid=$($rd.id)). Poczekaj az build bedzie Ready." -ForegroundColor Green
} catch {
  Write-Host "Env zaktualizowane. Redeploy API: $($_.Exception.Message)" -ForegroundColor Yellow
  Write-Host "Uruchom Redeploy w Vercel Dashboard." -ForegroundColor Yellow
}
