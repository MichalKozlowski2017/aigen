<#
.SYNOPSIS
  Sam Quick Tunnel cloudflared → 127.0.0.1:8188 + zapis URL do logs\.
#>
[CmdletBinding()]
param(
  [string]$ComfyRoot = "",
  [string]$Listen = "127.0.0.1",
  [int]$Port = 8188
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
& (Join-Path $PSScriptRoot "start-comfy-stack.ps1") -ComfyRoot $root -Listen $Listen -Port $Port -SkipWorker
