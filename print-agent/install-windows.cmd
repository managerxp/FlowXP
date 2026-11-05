@echo off
rem Double-click to install the FlowXP print agent (starts with Windows). To use your own web address:  install-windows.cmd https://your.address
if "%~1"=="" (
  powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install-windows.ps1"
) else (
  powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install-windows.ps1" -Origins "%~1"
)
echo.
pause
