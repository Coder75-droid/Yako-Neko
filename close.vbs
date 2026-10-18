Set WshShell = CreateObject("WScript.Shell")
WshShell.SendKeys "^w"
WScript.Sleep 250
CreateObject("WScript.Shell").AppActivate "New Tab - Google Chrome"