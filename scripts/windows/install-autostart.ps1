# Makes MonksTracker start automatically when you log in to Windows, and starts it now.
# Run from the repository folder:  powershell -ExecutionPolicy Bypass -File scripts\windows\install-autostart.ps1
$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$launcher = Join-Path $root 'scripts\windows\start-monkstracker.vbs'
$server = Join-Path $root 'apps\server\dist\server.mjs'

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  throw 'Node.js was not found. Install Node.js 22 LTS from https://nodejs.org first.'
}
if (-not (Test-Path $server)) {
  throw "The server is not built yet. In $root run:  pnpm install  then  pnpm build"
}

$startup = [Environment]::GetFolderPath('Startup')
$shortcut = Join-Path $startup 'MonksTracker.lnk'
$shell = New-Object -ComObject WScript.Shell
$link = $shell.CreateShortcut($shortcut)
$link.TargetPath = Join-Path $env:WINDIR 'System32\wscript.exe'
$link.Arguments = "`"$launcher`""
$link.WorkingDirectory = $root
$link.Description = 'Start the MonksTracker local server'
$link.Save()
Write-Host "Autostart installed: $shortcut"

Start-Process -FilePath (Join-Path $env:WINDIR 'System32\wscript.exe') -ArgumentList "`"$launcher`"" -WorkingDirectory $root
Start-Sleep -Seconds 2
try {
  $health = Invoke-RestMethod -Uri 'http://127.0.0.1:4545/api/health' -TimeoutSec 5
  Write-Host 'MonksTracker is running at http://127.0.0.1:4545'
} catch {
  Write-Warning "Started, but the server did not answer yet. Check $env:LOCALAPPDATA\MonksTracker\server.log"
}
