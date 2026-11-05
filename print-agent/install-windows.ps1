# Installs the FlowXP print agent for the current Windows user: copies it to %LOCALAPPDATA%\FlowXP\print-agent and makes it start
# by itself (hidden) every time this user signs in (a launcher in the user's Startup folder: no admin rights needed).
# Run it once: double-click install-windows.cmd. Remove it with -Remove.
param(
  [string]$Origins = '',   # the FlowXP web address(es) allowed to print and to pair; empty: the .origins file the website put in the download, else flowxp.in
  [switch]$Remove
)
$ErrorActionPreference = 'Stop'
$dir = Join-Path $env:LOCALAPPDATA 'FlowXP\print-agent'
$startup = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\Startup\FlowXP Print Agent.vbs'

# stop any copy that is running from this folder (and the older scheduled-task version, if it was ever installed)
function Stop-Agent {
  Unregister-ScheduledTask -TaskName 'FlowXP Print Agent' -Confirm:$false -ErrorAction SilentlyContinue
  Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -like "*$dir*" } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
}

if ($Remove) {
  Stop-Agent
  Remove-Item $startup -Force -ErrorAction SilentlyContinue
  Remove-Item $dir -Recurse -Force -ErrorAction SilentlyContinue
  Write-Host 'The FlowXP print agent was removed.'; return
}

# Node.js is what runs the agent
$node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $node -and (Get-Command winget -ErrorAction SilentlyContinue)) {
  Write-Host 'Installing Node.js (one time)...'
  winget install -e --id OpenJS.NodeJS.LTS --silent --accept-package-agreements --accept-source-agreements | Out-Null
  $node = Join-Path $env:ProgramFiles 'nodejs\node.exe'
}
if (-not $node -or -not (Test-Path $node)) { throw 'Node.js is needed. Install it from https://nodejs.org (the LTS version), then run this again.' }

Stop-Agent
# Copy the agent here (a token made on an earlier install is kept)
New-Item -ItemType Directory -Force $dir | Out-Null
foreach ($f in 'agent.js', 'winprint.ps1', 'comprint.ps1', 'package.json') { Copy-Item (Join-Path $PSScriptRoot $f) $dir -Force }
if (-not $Origins) { $given = Join-Path $PSScriptRoot '.origins'; $Origins = if (Test-Path $given) { (Get-Content $given -Raw).Trim() } else { 'https://flowxp.in,https://www.flowxp.in' } }
Set-Content -Path (Join-Path $dir '.origins') -Value $Origins -Encoding ASCII

# A tiny launcher that starts the agent with no window and keeps what it prints in agent.log (wscript is the plain way to run something hidden)
$vbs = Join-Path $dir 'start-hidden.vbs'
Set-Content -Path $vbs -Encoding ASCII -Value @"
Set sh = CreateObject("WScript.Shell")
sh.CurrentDirectory = "$dir"
sh.Run "cmd /c """"$node"" ""$dir\agent.js"" > ""$dir\agent.log"" 2>&1""", 0, False
"@
Copy-Item $vbs $startup -Force            # Windows runs everything in this folder when the user signs in
Start-Process -FilePath (Join-Path $env:SystemRoot 'System32\wscript.exe') -ArgumentList "`"$vbs`""

$up = $false
foreach ($i in 1..30) { Start-Sleep -Seconds 1; if (Get-NetTCPConnection -LocalPort 9101 -State Listen -ErrorAction SilentlyContinue) { $up = $true; break } }
if ($up) {
  Write-Host 'Done. The FlowXP print agent is running and will start by itself whenever you sign in to Windows.'
  Write-Host 'Now open FlowXP, Business settings, Silent printing, and press "Connect to the print agent".'
} else { Write-Host "Installed, but the agent did not answer yet. Look at $dir\agent.log, or sign out and in again." }
