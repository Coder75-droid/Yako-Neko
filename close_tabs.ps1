Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type -AssemblyName System.Windows.Forms
$safeTitle = 'Yako neko'
$pids = @(12612,4872)
$keywords = @('instagram','youtube','tiktok','twitter','reddit','facebook','discord')
try {
  $s = New-Object -ComObject WScript.Shell
  $root = [System.Windows.Automation.AutomationElement]::RootElement
  $winCond = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty, [System.Windows.Automation.ControlType]::Window)
  $tabCond = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty, [System.Windows.Automation.ControlType]::TabItem)
  foreach ($pid in $pids) {
    $p = Get-Process -Id $pid -ErrorAction SilentlyContinue
    if ($null -eq $p) { continue }
    if (-not $s.AppActivate([int]$pid)) { continue }
    Start-Sleep -Milliseconds 200
    $pidCond = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ProcessIdProperty, [int]$pid)
    $andCond = New-Object System.Windows.Automation.AndCondition($pidCond, $winCond)
    $wins = $root.FindAll([System.Windows.Automation.TreeScope]::Children, $andCond)
    foreach ($w in $wins) {
      $again = $true
      while ($again) {
        $again = $false
        $tabsEl = $w.FindAll([System.Windows.Automation.TreeScope]::Descendants, $tabCond)
        foreach ($t in $tabsEl) {
          $nm = $t.Current.Name
          if ($null -eq $nm) { continue }
          $clean = ($nm -replace "^\(\d+\)\s*", "").ToLower()
          $hit = $false
          foreach ($k in $keywords) {
            if ($clean -like ("*" + $k + "*")) { $hit = $true; break }
          }
          if ($hit) {
            try {
              $sel = $t.GetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern)
              $sel.Select()
            } catch {
              try {
                $inv = $t.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)
                $inv.Invoke()
              } catch { }
            }
            Start-Sleep -Milliseconds 200
            [System.Windows.Forms.SendKeys]::SendWait('^w')
            Start-Sleep -Milliseconds 200
            $again = $true
            break
          }
        }
      }
    }
  }
  if ($safeTitle -ne '') { Start-Sleep -Milliseconds 250; $s.AppActivate($safeTitle) | Out-Null }
} catch { }