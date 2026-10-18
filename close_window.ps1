Add-Type @"
using System;
using System.Runtime.InteropServices;
public class FgCheckWin {
    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
}
"@
$targetPid = 20444
$keys = '^w'
$safeTitle = 'New Tab - Google Chrome'
try {
    $s = New-Object -ComObject WScript.Shell
    $s.AppActivate([int]$targetPid) | Out-Null
    Start-Sleep -Milliseconds 300
    $fgPid = 0
    $h = [FgCheckWin]::GetForegroundWindow()
    [FgCheckWin]::GetWindowThreadProcessId($h, [ref]$fgPid) | Out-Null
    if ($fgPid -ne [uint32]$targetPid) {
        $s.AppActivate([int]$targetPid) | Out-Null
        Start-Sleep -Milliseconds 300
        $h = [FgCheckWin]::GetForegroundWindow()
        [FgCheckWin]::GetWindowThreadProcessId($h, [ref]$fgPid) | Out-Null
    }
    if ($fgPid -ne [uint32]$targetPid) { exit }
    $s.SendKeys($keys)
    Start-Sleep -Milliseconds 250
    if ($safeTitle -ne '') { $s.AppActivate($safeTitle) | Out-Null }
} catch { }