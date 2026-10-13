; 仅加入“打开方式”，不改写其他播放器的默认文件关联。
!macroundef APP_ASSOCIATE
!macro APP_ASSOCIATE EXT FILECLASS DESCRIPTION ICON COMMANDTEXT COMMAND
  WriteRegNone SHELL_CONTEXT "Software\Classes\.${EXT}\OpenWithProgids" "${FILECLASS}"
  WriteRegStr SHELL_CONTEXT "Software\Classes\${FILECLASS}" "" `${DESCRIPTION}`
  WriteRegStr SHELL_CONTEXT "Software\Classes\${FILECLASS}\DefaultIcon" "" `${ICON}`
  WriteRegStr SHELL_CONTEXT "Software\Classes\${FILECLASS}\shell" "" "open"
  WriteRegStr SHELL_CONTEXT "Software\Classes\${FILECLASS}\shell\open" "" `${COMMANDTEXT}`
  WriteRegStr SHELL_CONTEXT "Software\Classes\${FILECLASS}\shell\open\command" "" `"$appExe" "%1"`
!macroend

; 删除前核对命令归属，不恢复可能已经失效的备份或覆盖用户后来选择的处理器。
!macroundef APP_UNASSOCIATE
!macro APP_UNASSOCIATE EXT FILECLASS
  ReadRegStr $R0 SHELL_CONTEXT "Software\Classes\${FILECLASS}\shell\open\command" ""
  StrCpy $R1 `"$INSTDIR\${APP_EXECUTABLE_FILENAME}" "%1"`
  ${If} $R0 == $R1
    ReadRegStr $R0 SHELL_CONTEXT "Software\Classes\.${EXT}" ""
    ${If} $R0 == "${FILECLASS}"
      DeleteRegValue SHELL_CONTEXT "Software\Classes\.${EXT}" ""
    ${EndIf}
    DeleteRegValue SHELL_CONTEXT "Software\Classes\.${EXT}\OpenWithProgids" "${FILECLASS}"
    DeleteRegKey SHELL_CONTEXT "Software\Classes\${FILECLASS}"
  ${EndIf}
!macroend
