<#
.SYNOPSIS
  Start lokalnego endpointu sterowania GPU (engine-control.py), jesli jeszcze nie slucha.

.DESCRIPTION
  Bind domyslnie 127.0.0.1:8199 — osobno od Comfy (8188) i llama-server (8080).
  Bez LEGION_ENGINE_SECRET skrypt konczy sie bez nasluchu (nie otwieramy
  sterowania procesami bez sekretu).

  Panel (Vercel) woła ten URL z Authorization: Bearer <tym samym sekretem>.
  To nie jest tunel Comfy. Ingress Named Tunnel: hostname → http://127.0.0.1:8199.
#>
[CmdletBinding()]
param(
  [int]$Port = 8199,
  [string]$Listen = "127.0.0.1"
)

$ErrorActionPreference = "Stop"

if (-not $env:LEGION_ENGINE_SECRET) {
  Write-Host "Engine control pominiety — ustaw LEGION_ENGINE_SECRET (bez sekretu nie nasluchujemy)."
  exit 0
}

if ($Port -eq 8080 -or $Port -eq 8188) {
  throw "Port $Port jest zajety przez llama-server albo Comfy. Uzyj innego (domyslnie 8199)."
}

function Test-PortOpen {
  param([string]$HostName, [int]$LocalPort)
  try {
    $client = New-Object System.Net.Sockets.TcpClient
    $iar = $client.BeginConnect($HostName, $LocalPort, $null, $null)
    $ok = $iar.AsyncWaitHandle.WaitOne(400, $false)
    if (-not $ok) { $client.Close(); return $false }
    $client.EndConnect($iar)
    $client.Close()
    return $true
  } catch {
    return $false
  }
}

if (Test-PortOpen -HostName $Listen -LocalPort $Port) {
  Write-Host "Engine control juz slucha na ${Listen}:${Port}"
  exit 0
}

$script = Join-Path $PSScriptRoot "engine-control.py"
if (-not (Test-Path $script)) {
  throw "Brak $script"
}

$py = $null
foreach ($cand in @("py", "python")) {
  $cmd = Get-Command $cand -ErrorAction SilentlyContinue
  if ($cmd) { $py = $cmd.Source; break }
}
if (-not $py) { throw "Brak py/python w PATH." }

$env:LEGION_ENGINE_PORT = "$Port"
$env:LEGION_ENGINE_LISTEN = $Listen
$log = Join-Path $PSScriptRoot "engine-control.log"
$leaf = [System.IO.Path]::GetFileName($py)
$argList = if ($leaf -match '^py(\.exe)?$') { @("-3", $script) } else { @($script) }
Write-Host "Start engine-control: $py $($argList -join ' ') (${Listen}:${Port})"
Start-Process -FilePath $py -ArgumentList $argList -WorkingDirectory $PSScriptRoot `
  -RedirectStandardOutput $log -RedirectStandardError $log -WindowStyle Hidden

$deadline = (Get-Date).AddSeconds(15)
while ((Get-Date) -lt $deadline) {
  if (Test-PortOpen -HostName $Listen -LocalPort $Port) {
    Write-Host "Engine control OK ${Listen}:${Port}"
    exit 0
  }
  Start-Sleep -Milliseconds 400
}
Write-Host "Engine control nie otworzyl portu w 15s — log: $log"
exit 1
