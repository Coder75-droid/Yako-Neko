Add-Type @"
using System;
using System.Text;
using System.Runtime.InteropServices;
public class Win32 {
    public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
    [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc cb, IntPtr lParam);
    [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);
    [DllImport("user32.dll")] public static extern int GetWindowTextLength(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
    public static string ProcName(uint pid) {
        try { return System.Diagnostics.Process.GetProcessById((int)pid).ProcessName; }
        catch { return ""; }
    }
    public static string ListWindows() {
        StringBuilder sb = new StringBuilder();
        EnumWindows(delegate(IntPtr hWnd, IntPtr lParam) {
            if (IsWindowVisible(hWnd)) {
                StringBuilder t = new StringBuilder(256);
                GetWindowText(hWnd, t, 256);
                uint pid; GetWindowThreadProcessId(hWnd, out pid);
                sb.AppendLine("WIN\t" + t.ToString() + "\t" + ProcName(pid) + "\t" + pid);
            }
            return true;
        }, IntPtr.Zero);
        return sb.ToString();
    }
}
"@

$fg = [Win32]::GetForegroundWindow()
$fgText = ''
$fgProc = ''
$fgPid = 0
if ($fg -ne [IntPtr]::Zero) {
    $sb = New-Object System.Text.StringBuilder 256
    [Win32]::GetWindowText($fg, $sb, 256) | Out-Null
    $fgText = $sb.ToString()
    [Win32]::GetWindowThreadProcessId($fg, [ref]$fgPid) | Out-Null
    $fgProc = [Win32]::ProcName($fgPid)
}
Write-Output ("FG`t" + $fgText + "`t" + $fgProc + "`t" + $fgPid)
Write-Output '==='
Write-Output ([Win32]::ListWindows())
