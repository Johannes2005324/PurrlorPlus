!include "MUI2.nsh"
!include "LogicLib.nsh"
!include "FileFunc.nsh"
!include "Sections.nsh"

!define APPNAME "PurrlorPlus"
!ifndef APPVERSION
  !define APPVERSION "0.0.0"
!endif
!define EXE_NAME "PurrlorPlus.exe"
!define OUTFILE "..\dist\PurrlorPlus-Setup.exe"
; Programs go under Programs\; %LOCALAPPDATA%\PurrlorPlus is the app's settings and browser data,
; which an upgrade or uninstall must leave alone (that's where people's sign-ins live).
!define INSTALLDIR "$LOCALAPPDATA\Programs\PurrlorPlus"
!define UNINSTALL_KEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\PurrlorPlus"
; Microsoft's documented registry key for the Evergreen WebView2 Runtime.
!define WEBVIEW2_KEY "Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}"

; Keep the icon next to this .nsi file and run makensis from this directory.
Icon "purrlor.ico"
UninstallIcon "purrlor.ico"

Name "${APPNAME}"
OutFile "${OUTFILE}"
InstallDir "${INSTALLDIR}"
RequestExecutionLevel user
Unicode True
SetCompressor /SOLID lzma

VIProductVersion "${APPVERSION}.0"
VIAddVersionKey "ProductName" "PurrlorPlus"
VIAddVersionKey "CompanyName" "MeowOps"
VIAddVersionKey "FileDescription" "PurrlorPlus Desktop Installer"
VIAddVersionKey "FileVersion" "${APPVERSION}"
VIAddVersionKey "ProductVersion" "${APPVERSION}"
VIAddVersionKey "LegalCopyright" "MeowOps"

!define MUI_ICON "purrlor.ico"
!define MUI_UNICON "purrlor.ico"
!define MUI_FINISHPAGE_RUN "$INSTDIR\${EXE_NAME}"
!define MUI_FINISHPAGE_RUN_TEXT "Start PurrlorPlus"

!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_COMPONENTS
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "English"

; PurrlorPlus keeps running in the tray after its window is closed, so an upgrade or uninstall has to
; stop it first or its files are locked.
!macro StopPurrlorPlus
  nsExec::Exec 'taskkill /IM "${EXE_NAME}" /F'
  Pop $0
  Sleep 500
!macroend

Section "PurrlorPlus" SEC_MAIN
  SectionIn RO
  SetShellVarContext current
  !insertmacro StopPurrlorPlus
  ; Replace, don't merge: files a newer build dropped shouldn't linger. $INSTDIR is always the
  ; fixed Programs\PurrlorPlus folder (there's no directory page), so this only ever removes our files.
  RMDir /r "$INSTDIR"
  SetOutPath "$INSTDIR"
  File /r "..\PurrlorPlus\bin\Release\net8.0-windows10.0.17763.0\win-x64\publish\*.*"

  Call EnsureWebView2

  WriteUninstaller "$INSTDIR\Uninstall.exe"

  WriteRegStr HKCU "${UNINSTALL_KEY}" "DisplayName" "${APPNAME}"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "DisplayVersion" "${APPVERSION}"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "Publisher" "MeowOps"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "DisplayIcon" "$INSTDIR\${EXE_NAME},0"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "UninstallString" '"$INSTDIR\Uninstall.exe"'
  WriteRegStr HKCU "${UNINSTALL_KEY}" "QuietUninstallString" '"$INSTDIR\Uninstall.exe" /S'
  WriteRegDWORD HKCU "${UNINSTALL_KEY}" "NoModify" 1
  WriteRegDWORD HKCU "${UNINSTALL_KEY}" "NoRepair" 1
SectionEnd

Section /o "Desktop Shortcut" SEC_DESKTOP
  SetShellVarContext current
  CreateShortCut "$DESKTOP\PurrlorPlus.lnk" "$INSTDIR\${EXE_NAME}" "" "$INSTDIR\${EXE_NAME}" 0
SectionEnd

Section "Start Menu Shortcut" SEC_STARTMENU
  SetShellVarContext current
  CreateDirectory "$SMPROGRAMS\PurrlorPlus"
  CreateShortCut "$SMPROGRAMS\PurrlorPlus\PurrlorPlus.lnk" "$INSTDIR\${EXE_NAME}" "" "$INSTDIR\${EXE_NAME}" 0
  CreateShortCut "$SMPROGRAMS\PurrlorPlus\Uninstall PurrlorPlus.lnk" "$INSTDIR\Uninstall.exe" "" "$INSTDIR\Uninstall.exe" 0
SectionEnd

; An automatic update (Updater.cs) runs this silently: /S, plus /RELAUNCH to start the new version
; afterwards (/TRAY: in the tray, as at sign-in). It leaves shortcuts as they were: the Start menu
; one is only made again if it's still there.
Function .onInit
  ${If} ${Silent}
  ${AndIfNot} ${FileExists} "$SMPROGRAMS\PurrlorPlus\PurrlorPlus.lnk"
    !insertmacro UnselectSection ${SEC_STARTMENU}
  ${EndIf}
FunctionEnd

Function .onInstSuccess
  ${GetParameters} $0
  ClearErrors
  ${GetOptions} $0 "/RELAUNCH" $1
  ${IfNot} ${Errors}
    ClearErrors
    ${GetOptions} $0 "/TRAY" $1
    ${If} ${Errors}
      Exec '"$INSTDIR\${EXE_NAME}"'
    ${Else}
      Exec '"$INSTDIR\${EXE_NAME}" --tray'
    ${EndIf}
  ${EndIf}
FunctionEnd

; Windows 11 ships the WebView2 Runtime; Windows 10 may not. The build downloads Microsoft's
; small bootstrapper into this folder, and it's only run when the runtime is missing.
Function EnsureWebView2
  ReadRegStr $0 HKLM "SOFTWARE\WOW6432Node\${WEBVIEW2_KEY}" "pv"
  ${If} $0 == ""
  ${OrIf} $0 == "0.0.0.0"
    ReadRegStr $0 HKCU "Software\${WEBVIEW2_KEY}" "pv"
  ${EndIf}
  ${If} $0 != ""
  ${AndIf} $0 != "0.0.0.0"
    Return
  ${EndIf}
!if /FileExists "MicrosoftEdgeWebview2Setup.exe"
  DetailPrint "Installing the Microsoft Edge WebView2 Runtime..."
  InitPluginsDir
  SetOutPath "$PLUGINSDIR"
  File "MicrosoftEdgeWebview2Setup.exe"
  ExecWait '"$PLUGINSDIR\MicrosoftEdgeWebview2Setup.exe" /silent /install' $1
  SetOutPath "$INSTDIR"
  ${If} $1 != 0
    MessageBox MB_ICONEXCLAMATION|MB_OK "The Microsoft Edge WebView2 Runtime couldn't be installed (code $1). PurrlorPlus needs it to run; you can get it from https://go.microsoft.com/fwlink/p/?LinkId=2124703"
  ${EndIf}
!else
  MessageBox MB_ICONEXCLAMATION|MB_OK "PurrlorPlus needs the Microsoft Edge WebView2 Runtime, which isn't installed. Get it from https://go.microsoft.com/fwlink/p/?LinkId=2124703"
!endif
FunctionEnd

Section "Uninstall"
  SetShellVarContext current
  !insertmacro StopPurrlorPlus
  ; Takes PurrlorPlus's notifications and its registration for them back off Windows (Toasts.cs).
  ExecWait '"$INSTDIR\PurrlorPlus.exe" --cleanup'
  Delete "$DESKTOP\PurrlorPlus.lnk"
  Delete "$SMPROGRAMS\PurrlorPlus\PurrlorPlus.lnk"
  Delete "$SMPROGRAMS\PurrlorPlus\Uninstall PurrlorPlus.lnk"
  RMDir "$SMPROGRAMS\PurrlorPlus"
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "PurrlorPlus"
  DeleteRegKey HKCU "${UNINSTALL_KEY}"
  RMDir /r "$INSTDIR"
SectionEnd
