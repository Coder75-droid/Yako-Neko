Set s = CreateObject("WScript.Shell")
If s.AppActivate(17828) Then
    s.SendKeys "%{F4}"
End If
WScript.Sleep 400
s.Run "taskkill /F /PID 17828 /T", 0, False
WScript.Sleep 250
s.AppActivate "System tray overflow window."
