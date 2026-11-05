param([Parameter(Mandatory)][ValidatePattern('^COM\d{1,3}$')][string]$Port, [Parameter(Mandatory)][string]$File)
# Sends the raw bytes in $File to a printer on a serial / Bluetooth COM port (a paired Bluetooth printer with no driver). Exit 1 + message on failure.
$bytes = [IO.File]::ReadAllBytes($File)
$p = New-Object System.IO.Ports.SerialPort $Port, 9600, 'None', 8, 'One'
$p.WriteTimeout = 15000
try {
  $p.Open()
  for ($i = 0; $i -lt $bytes.Length; $i += 512) { $p.Write($bytes, $i, [Math]::Min(512, $bytes.Length - $i)) }
  Start-Sleep -Milliseconds 800   # let the printer take the last bytes before the link closes
} catch {
  [Console]::Error.WriteLine("Could not reach the printer on $Port. Is it switched on and in range? ($($_.Exception.Message))")
  exit 1
} finally { if ($p.IsOpen) { $p.Close() } }
