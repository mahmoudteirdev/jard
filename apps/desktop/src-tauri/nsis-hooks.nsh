; "Scan with Jard" in Explorer's right-click menu, for folders and drives. Per user, removed on uninstall.
; Turned off in Settings stays off through updates: Settings records the choice in Software\Jard.
!macro NSIS_HOOK_POSTINSTALL
  ReadRegStr $0 HKCU "Software\Jard" "ContextMenu"
  ${If} $0 != "0"
    WriteRegStr HKCU "Software\Classes\Directory\shell\Jard" "" "افحص بجرد"
    WriteRegStr HKCU "Software\Classes\Directory\shell\Jard" "Icon" "$INSTDIR\${MAINBINARYNAME}.exe"
    WriteRegStr HKCU "Software\Classes\Directory\shell\Jard\command" "" '"$INSTDIR\${MAINBINARYNAME}.exe" "%1"'
    WriteRegStr HKCU "Software\Classes\Drive\shell\Jard" "" "افحص بجرد"
    WriteRegStr HKCU "Software\Classes\Drive\shell\Jard" "Icon" "$INSTDIR\${MAINBINARYNAME}.exe"
    WriteRegStr HKCU "Software\Classes\Drive\shell\Jard\command" "" '"$INSTDIR\${MAINBINARYNAME}.exe" "%1"'
  ${EndIf}
!macroend

; One question for each thing that outlives the program. The default answer is to keep it, and a
; silent uninstall keeps everything. An update replaces the program, so it asks nothing.
!macro JARD_ASK_REMOVE AR EN WHAT
  ${If} $LANGUAGE == 1025
    StrCpy $R9 "${AR}"
  ${Else}
    StrCpy $R9 "${EN}"
  ${EndIf}
  MessageBox MB_YESNO|MB_ICONQUESTION|MB_DEFBUTTON2 "$R9" /SD IDNO IDNO +2
    ExecWait '"$INSTDIR\${MAINBINARYNAME}.exe" --uninstall-clean ${WHAT}'
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  DeleteRegKey HKCU "Software\Classes\Directory\shell\Jard"
  DeleteRegKey HKCU "Software\Classes\Drive\shell\Jard"
  ${If} $UpdateMode <> 1
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "Jard"
    DeleteRegKey HKCU "Software\Jard"
    ${If} $DeleteAppDataCheckboxState <> 1
      !insertmacro JARD_ASK_REMOVE "احذف نتائج الفحوص المحفوظة أيضاً؟" "Also delete saved scan results?" "scans"
      !insertmacro JARD_ASK_REMOVE "احذف محتوى الحجر المؤقت نهائياً؟ لا يمكن استرجاعه بعدها." "Permanently delete what's in quarantine? It can't be restored after this." "quarantine"
      !insertmacro JARD_ASK_REMOVE "احذف مفتاح التفعيل من هذا الجهاز؟" "Remove the activation key from this device?" "license"
    ${Else}
      ; "Delete the application data" covers these. Quarantine on other drives is not in that folder.
      ExecWait '"$INSTDIR\${MAINBINARYNAME}.exe" --uninstall-clean quarantine'
    ${EndIf}
  ${EndIf}
!macroend
