param([Parameter(Mandatory)][string]$Printer, [Parameter(Mandatory)][string]$File)
# Sends the raw bytes in $File to a Windows printer queue by name (no sharing needed). Exit 1 + message on failure.
Add-Type -TypeDefinition @'
using System; using System.Runtime.InteropServices;
public class Raw {
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Ansi)] public class DOCINFO { [MarshalAs(UnmanagedType.LPStr)] public string n; [MarshalAs(UnmanagedType.LPStr)] public string o; [MarshalAs(UnmanagedType.LPStr)] public string t; }
  [DllImport("winspool.Drv", EntryPoint="OpenPrinterA", CharSet=CharSet.Ansi, SetLastError=true)] static extern bool OpenPrinter(string p, out IntPtr h, IntPtr d);
  [DllImport("winspool.Drv", SetLastError=true)] static extern bool ClosePrinter(IntPtr h);
  [DllImport("winspool.Drv", EntryPoint="StartDocPrinterA", CharSet=CharSet.Ansi, SetLastError=true)] static extern bool StartDocPrinter(IntPtr h, int l, [In] DOCINFO d);
  [DllImport("winspool.Drv", SetLastError=true)] static extern bool EndDocPrinter(IntPtr h);
  [DllImport("winspool.Drv", SetLastError=true)] static extern bool StartPagePrinter(IntPtr h);
  [DllImport("winspool.Drv", SetLastError=true)] static extern bool EndPagePrinter(IntPtr h);
  [DllImport("winspool.Drv", SetLastError=true)] static extern bool WritePrinter(IntPtr h, byte[] b, int c, out int w);
  public static string Send(string printer, byte[] bytes) {
    IntPtr h; if (!OpenPrinter(printer, out h, IntPtr.Zero)) return "There is no printer called '" + printer + "' on this computer";
    var di = new DOCINFO { n = "FlowXP", o = null, t = "RAW" };
    if (!StartDocPrinter(h, 1, di)) { ClosePrinter(h); return "Windows would not start the print job (error " + Marshal.GetLastWin32Error() + ")"; }
    StartPagePrinter(h); int w; bool ok = WritePrinter(h, bytes, bytes.Length, out w); EndPagePrinter(h); EndDocPrinter(h); ClosePrinter(h);
    return ok ? null : "Writing to the printer failed (error " + Marshal.GetLastWin32Error() + ")";
  }
}
'@
$err = [Raw]::Send($Printer, [IO.File]::ReadAllBytes($File))
if ($err) { [Console]::Error.WriteLine($err); exit 1 }
