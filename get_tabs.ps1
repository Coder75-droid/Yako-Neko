$out = @()
try {
    Add-Type -AssemblyName UIAutomationClient
    Add-Type -AssemblyName UIAutomationTypes
    $procs = Get-Process | Where-Object { $_.MainWindowHandle -ne 0 -and ($_.ProcessName -match 'chrome|msedge|brave|vivaldi|opera') }
    $root = [System.Windows.Automation.AutomationElement]::RootElement
    $winCond = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty, [System.Windows.Automation.ControlType]::Window)
    $tabCond = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty, [System.Windows.Automation.ControlType]::TabItem)
    $editCond = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty, [System.Windows.Automation.ControlType]::Edit)
    foreach ($bp in $procs) {
        try {
            $pidCond = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ProcessIdProperty, [int]$bp.Id)
            $andCond = New-Object System.Windows.Automation.AndCondition($pidCond, $winCond)
            $wins = $root.FindAll([System.Windows.Automation.TreeScope]::Children, $andCond)
            foreach ($w in $wins) {
                $tabs = $w.FindAll([System.Windows.Automation.TreeScope]::Descendants, $tabCond)
                foreach ($t in $tabs) {
                    $nm = $t.Current.Name
                    if ($nm) { $out += ("TAB`t" + $nm + "`t" + $bp.Id) }
                }
                $edits = $w.FindAll([System.Windows.Automation.TreeScope]::Descendants, $editCond)
                foreach ($e in $edits) {
                    $enm = $e.Current.Name
                    if ($enm -match 'address|search|url') {
                        try {
                            $vp = $e.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)
                            $val = $vp.Current.Value
                            if ($val) { $out += ("TABURL`t" + $bp.Id + "`t" + $val); break }
                        } catch { }
                    }
                }
            }
        } catch { }
    }
} catch { }
($out -join "`n")
