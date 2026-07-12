' Hidden-window wrapper so double-clicking the desktop shortcut doesn't
' flash a console window -- it just launches open_dashboard.bat silently.
Set shell = CreateObject("WScript.Shell")
shell.Run "cmd /c ""C:\nq_dashboard\scripts\open_dashboard.bat""", 0, False
