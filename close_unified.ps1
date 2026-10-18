Add-Type @"
using System;
using System.Runtime.InteropServices;
public class FgGuard {
    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
    public static string Name(uint pid) {
        try { return System.Diagnostics.Process.GetProcessById((int)pid).ProcessName.ToLower(); }
        catch { return ""; }
    }
}
"@
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type -AssemblyName System.Windows.Forms
$targetPid = 2320
$keys = '%{F4}'
$safeTitle = '(2) Quora - Google Chrome'
$wantKill = $false
$tabTitle = 'Instagram - Memory usage - 227 MB'
$targetName = '',
$protected = 'whatsapp,discord,spotify,code,winword,excel,powerpoint,notepad,teams,zoom,slack,explorer'
try {
  $protList = $protected.Split(",")
  $tp = Get-Process -Id $targetPid -ErrorAction SilentlyContinue
  if ($null -eq $tp) { exit }
  $tnl = $tp.ProcessName.ToLower()
  foreach ($p in $protList) { if ($tnl -like ("*" + $p + "*")) { exit } }
  if ($targetName -ne "" -and -not ($tnl -like ("*" + $targetName + "*"))) { exit }
  $s = New-Object -ComObject WScript.Shell
  if ($tabTitle -ne "") {
    $root = [System.Windows.Automation.AutomationElement]::RootElement
    $cond = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::NativeWindowHandleProperty, [int]$tp.MainWindowHandle)
    $winEl = $root.FindFirst([System.Windows.Automation.TreeScope]::Children, $cond)
    if ($winEl -eq $null) { exit }
    $tabCond = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty, [System.Windows.Automation.ControlType]::TabItem)
    $tabs = $winEl.FindAll([System.Windows.Automation.TreeScope]::Descendants, $tabCond)
    $found = $false
    foreach ($t in $tabs) {
      if ($t.Current.Name -eq $tabTitle) {
        try {
          $sel = $t.GetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern)
          $sel.Select()
        } catch {
          try {
            $inv = $t.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)
            $inv.Invoke()
          } catch { }
        }
        $found = $true
        break
      }
    }
    if (-not $found) { exit }
    Start-Sleep -Milliseconds 300
  }
  $s.AppActivate([int]$targetPid) | Out-Null
  Start-Sleep -Milliseconds 250
  $fgPid = 0
  $h = [FgGuard]::GetForegroundWindow()
  [FgGuard]::GetWindowThreadProcessId($h, [ref]$fgPid) | Out-Null
  if ($fgPid -ne [uint32]$targetPid) {
    $s.AppActivate([int]$targetPid) | Out-Null
    Start-Sleep -Milliseconds 250
    $h = [FgGuard]::GetForegroundWindow()
    [FgGuard]::GetWindowThreadProcessId($h, [ref]$fgPid) | Out-Null
  }
  if ($fgPid -ne [uint32]$targetPid) { exit }
  $fgName = [FgGuard]::Name($fgPid)
  foreach ($p in $protList) { if ($fgName -like ("*" + $p + "*")) { exit } }
  if ($targetName -ne "" -and -not ($fgName -like ("*" + $targetName + "*"))) { exit }
  $s.SendKeys($keys)
  if ($wantKill) {
    Start-Sleep -Milliseconds 400
    $alive = Get-Process -Id $targetPid -ErrorAction SilentlyContinue
    if ($alive -and $alive.ProcessName.ToLower() -like ("*" + $targetName + "*")) { taskkill /F /PID $targetPid /T | Out-Null }
  }
  Start-Sleep -Milliseconds 250
  if ($safeTitle -ne '') { $s.AppActivate($safeTitle) | Out-Null }
} catch { }