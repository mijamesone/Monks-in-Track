' Starts the MonksTracker server in the background with no window.
' The server writes its log to %LOCALAPPDATA%\MonksTracker\server.log.
' If MonksTracker is already running, the second copy exits on its own.
Option Explicit
Dim fso, shell, root, cmd
Set fso = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")
' This file lives in <repo>\scripts\windows\ ; the repository root is two folders up.
root = fso.GetParentFolderName(fso.GetParentFolderName(fso.GetParentFolderName(WScript.ScriptFullName)))
shell.CurrentDirectory = root
cmd = "cmd /c (if not exist ""%LOCALAPPDATA%\MonksTracker"" mkdir ""%LOCALAPPDATA%\MonksTracker"") & " & _
      "node ""apps\server\dist\server.mjs"" >> ""%LOCALAPPDATA%\MonksTracker\server.log"" 2>&1"
shell.Run cmd, 0, False
