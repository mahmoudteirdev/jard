; "Scan with Jard" in Explorer's right-click menu, for folders and drives. Per user, removed on uninstall.
!macro NSIS_HOOK_POSTINSTALL
  WriteRegStr HKCU "Software\Classes\Directory\shell\Jard" "" "افحص بجرد"
  WriteRegStr HKCU "Software\Classes\Directory\shell\Jard" "Icon" "$INSTDIR\${MAINBINARYNAME}.exe"
  WriteRegStr HKCU "Software\Classes\Directory\shell\Jard\command" "" '"$INSTDIR\${MAINBINARYNAME}.exe" "%1"'
  WriteRegStr HKCU "Software\Classes\Drive\shell\Jard" "" "افحص بجرد"
  WriteRegStr HKCU "Software\Classes\Drive\shell\Jard" "Icon" "$INSTDIR\${MAINBINARYNAME}.exe"
  WriteRegStr HKCU "Software\Classes\Drive\shell\Jard\command" "" '"$INSTDIR\${MAINBINARYNAME}.exe" "%1"'
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  DeleteRegKey HKCU "Software\Classes\Directory\shell\Jard"
  DeleteRegKey HKCU "Software\Classes\Drive\shell\Jard"
!macroend
