; Sensei Dojô — instalador standalone (usado por `pnpm package:dojo -- --win`,
; fora do fluxo do instalador único). Ver installer/win/custom.nsh para o
; porquê de liberar o .exe do app e não só o mongod.exe, e por que só nos
; perfis privado/domínio.
;
; NÃO TESTADO EM WINDOWS REAL — ver docs/deploy-windows.md.

!macro customInstall
  nsExec::ExecToLog 'netsh advfirewall firewall add rule name="Sensei Dojo" dir=in action=allow program="$INSTDIR\Sensei Dojô.exe" enable=yes profile=private,domain'
  nsExec::ExecToLog 'netsh advfirewall firewall add rule name="Sensei Dojo (mongod)" dir=in action=allow program="$INSTDIR\resources\mongodb\mongod.exe" enable=yes profile=private,domain'
!macroend

!macro customUnInstall
  nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="Sensei Dojo"'
  nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="Sensei Dojo (mongod)"'
!macroend
