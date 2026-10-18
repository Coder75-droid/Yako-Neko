Set s = CreateObject("WScript.Shell")
If s.AppActivate(8432) Then
    WScript.Sleep 150
    s.SendKeys "^w"
End If
WScript.Sleep 250
s.AppActivate "New Tab - Google Chrome"
