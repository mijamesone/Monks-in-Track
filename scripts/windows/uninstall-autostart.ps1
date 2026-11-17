# Stops MonksTracker from starting with Windows. Your data in %LOCALAPPDATA%\MonksTracker is not touched.
$shortcut = Join-Path ([Environment]::GetFolderPath('Startup')) 'MonksTracker.lnk'
if (Test-Path $shortcut) {
  Remove-Item $shortcut
  Write-Host 'Autostart removed.'
} else {
  Write-Host 'Autostart was not installed.'
}
