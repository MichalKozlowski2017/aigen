<#
.SYNOPSIS
  Tworzy skrót w Startup folder Windows (autostart po logowaniu).

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts\legion\install-startup-shortcut.ps1 -ComfyRoot "C:\Users\mkozl\Sites\ComfyUI"
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$ComfyRoot
)

$ErrorActionPreference = "Stop"
$stack = Join-Path $PSScriptRoot "start-comfy-stack.ps1"
if (-not (Test-Path $stack)) { throw "Brak $stack" }
if (-not (Test-Path (Join-Path $ComfyRoot "main.py"))) {
  throw "ComfyRoot bez main.py: $ComfyRoot"
}

$startup = [Environment]::GetFolderPath("Startup")
$lnkPath = Join-Path $startup "AIGen-Comfy-Stack.lnk"
$shell = New-Object -ComObject WScript.Shell
$lnk = $shell.CreateShortcut($lnkPath)
$lnk.TargetPath = "powershell.exe"
$lnk.Arguments = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Minimized -File `"$stack`" -ComfyRoot `"$ComfyRoot`""
$lnk.WorkingDirectory = $ComfyRoot
$lnk.WindowStyle = 7
$lnk.Description = "AIGen: ComfyUI + cloudflared + queue worker"
$lnk.Save()

Write-Host "Utworzono skrot: $lnkPath"
Write-Host "Po zalogowaniu do Windows stack wystartuje sam."
Write-Host "Pamietaj: Quick Tunnel URL zmienia sie — zaktualizuj Vercel COMFYUI_URL albo przejdz na Named Tunnel."
