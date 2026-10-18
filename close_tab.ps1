Add-Type @"
using System;
using System.Runtime.InteropServices;
public class FgCheckTab {
    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
}
"@
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type -AssemblyName System.Windows.Forms
$procId = 13184
$tabTitle = 'Instagram  Messages - Memory usage - 237 MB'
$safeTitle = 'main.js - 87451 - Visual Studio Code'
try {
  $p = Get-Process -Id $procId
  $root = [System.Windows.Automation.AutomationElement]::RootElement
  $cond = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::NativeWindowHandleProperty, [int]$p.MainWindowHandle)
  $winEl = $root.FindFirst([System.Windows.Automation.TreeScope]::Children, $cond)
  if ($winEl -eq $null) { exit }
  $tabCond = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty, [System.Windows.Automation.ControlType]::TabItem)
  $tabs = $winEl.FindAll([System.Windows.Automation.TreeScope]::Descendants, $tabCond)
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
      break
    }
  }
  Start-Sleep -Milliseconds 350
  $s = New-Object -ComObject WScript.Shell
  $s.AppActivate([int]$procId) | Out-Null
  Start-Sleep -Milliseconds 250
  $fgPid = 0
  $h = [FgCheckTab]::GetForegroundWindow()
  [FgCheckTab]::GetWindowThreadProcessId($h, [ref]$fgPid) | Out-Null
  if ($fgPid -eq [uint32]$procId) {
    [System.Windows.Forms.SendKeys]::SendWait('^w')
  }
  Start-Sleep -Milliseconds 250
  if ($safeTitle -ne '') { $s.AppActivate($safeTitle) | Out-Null }
} catch { }