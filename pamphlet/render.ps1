# powershell -File pamphlet\render.ps1  ->  pamphlet\out\page-1..4.png (2x) and flowxp-pamphlet.pdf, using headless Chrome
$chrome = 'C:\Program Files\Google\Chrome\Application\chrome.exe'
$dir = Split-Path -Parent $MyInvocation.MyCommand.Path
$out = Join-Path $dir 'out'; New-Item -ItemType Directory -Force $out | Out-Null
$src = ([System.Uri](Join-Path $dir 'pamphlet.html')).AbsoluteUri
foreach ($i in 1..4) {
  & $chrome --headless=new --disable-gpu --hide-scrollbars --force-device-scale-factor=2 --window-size=1240,1754 --virtual-time-budget=4000 "--screenshot=$out\page-$i.png" "$src#p$i" | Out-Null
}
# all four pages in one PDF (each page is one A4-shaped sheet)
& $chrome --headless=new --disable-gpu --no-pdf-header-footer --virtual-time-budget=4000 "--print-to-pdf=$out\flowxp-pamphlet.pdf" $src | Out-Null
