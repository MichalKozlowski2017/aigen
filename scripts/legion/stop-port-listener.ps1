<#
.SYNOPSIS
  Zatrzymuje proces, ktory NASLUCHUJE na podanym porcie TCP.

.DESCRIPTION
  Bije wylacznie PID z Get-NetTCPConnection -State Listen (albo netstat LISTENING).
  Nie zatrzymuje po nazwie procesu — obce python.exe, ktore nie trzymaja tego portu,
  zostaja. PID 0 i 4 (Idle/System) sa pomijane.

.EXAMPLE
  powershell -File scripts\legion\stop-port-listener.ps1 -Port 8080
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [int]$Port
)

$ErrorActionPreference = "Stop"

if ($Port -lt 1 -or $Port -gt 65535) {
  throw "Nieprawidlowy port: $Port"
}

function Get-ListenPids {
  param([int]$LocalPort)
  $ids = New-Object System.Collections.Generic.List[int]
  try {
    $conns = @(Get-NetTCPConnection -LocalPort $LocalPort -State Listen -ErrorAction Stop)
    foreach ($conn in $conns) {
      $own = [int]$conn.OwningProcess
      if ($own -gt 4) { $ids.Add($own) }
    }
    return @($ids | Select-Object -Unique)
  } catch {
    Write-Verbose "Get-NetTCPConnection: $($_.Exception.Message)"
  }

  $net = & netstat.exe -ano -p tcp
  foreach ($line in $net) {
    if ($line -notmatch ":$LocalPort\s+") { continue }
    if ($line -notmatch "(\d+)\s*$") { continue }
    $procId = [int]$Matches[1]
    if ($procId -le 4) { continue }
    # EN: LISTENING. PL: NASLUCHIWANIE / NASŁUCHIWANIE (konsola moze obciac diakrytyki).
    $norm = $line.ToUpperInvariant()
    $listening = ($norm -match "LISTENING") -or ($norm -match "NASL")
    if ($listening) { $ids.Add($procId) }
  }
  return @($ids | Select-Object -Unique)
}

$pids = @(Get-ListenPids -LocalPort $Port)
$killed = @()
foreach ($procId in $pids) {
  if ($procId -le 4) { continue }
  $proc = Get-Process -Id $procId -ErrorAction SilentlyContinue
  if (-not $proc) { continue }
  Stop-Process -Id $procId -Force -ErrorAction Stop
  $killed += $procId
}

if ($killed.Count -eq 0) {
  Write-Output "Brak procesu na porcie $Port"
} else {
  Write-Output ("Zatrzymano PID " + ($killed -join ","))
}
exit 0
