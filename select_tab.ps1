Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
$procId = 15996
$tabTitle = 'Reddit - The heart of the internet - Memory usage - 287 MB'
$okPath = 'C:\Users\ziari\OneDrive\Desktop\Work\Coding\87451\select_ok.txt'
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
      Set-Content -Path $okPath -Value '1'
      break
    }
  }
} catch { }