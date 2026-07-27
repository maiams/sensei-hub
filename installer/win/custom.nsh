; Sensei Hub — instalador único Windows (Dojô + Arena).
;
; electron-builder gera o instalador NSIS "base" para UM app (aqui, o Arena —
; ver apps/arena/desktop/package.json). Este script usa os hooks
; customInstall/customUnInstall (mecanismo documentado do electron-builder,
; não um .nsi escrito do zero) para:
;
;   1) copiar o Sensei Dojô — já empacotado como pasta "--win dir" e trazido
;      para dentro deste instalador via `win.extraResources` (ver
;      apps/arena/desktop/package.json, entrada "to": "dojo-app") — para sua
;      própria pasta em Program Files, com atalhos próprios;
;   2) liberar os dois .exe do app e os dois mongod.exe no Firewall do
;      Windows, só nos perfis privado/domínio (nunca público), para o popup
;      de permissão não aparecer na frente do operador durante o evento.
;
; Pré-requisito: o instalador PRECISA rodar elevado (perMachine: true no
; nsis config de apps/arena/desktop/package.json) — sem isso, nem a cópia
; para Program Files nem o `netsh advfirewall` funcionam. oneClick também
; precisa estar desligado para o UAC aparecer com uma janela normal em vez
; de instalar silenciosamente sem o usuário perceber.
;
; NÃO TESTADO EM WINDOWS REAL — só compilado cross-platform (electron-builder
; traz seu próprio NSIS via macOS). Ver docs/deploy-windows.md para o que
; ainda falta validar numa máquina Windows de verdade.

!macro customInstall
  ; --- Sensei Dojô: copia os arquivos (extraResources já os deixou em
  ; $INSTDIR\resources\dojo-app) para uma pasta própria, fora da do Arena ---
  CreateDirectory "$PROGRAMFILES64\Sensei Dojo"
  CopyFiles /SILENT "$INSTDIR\resources\dojo-app\*.*" "$PROGRAMFILES64\Sensei Dojo"

  CreateDirectory "$SMPROGRAMS\Sensei Hub"
  CreateShortCut "$SMPROGRAMS\Sensei Hub\Sensei Dojo.lnk" "$PROGRAMFILES64\Sensei Dojo\Sensei Dojô.exe"
  CreateShortCut "$SMPROGRAMS\Sensei Hub\Sensei Arena.lnk" "$INSTDIR\Sensei Arena.exe"
  CreateShortCut "$DESKTOP\Sensei Dojo.lnk" "$PROGRAMFILES64\Sensei Dojo\Sensei Dojô.exe"
  CreateShortCut "$DESKTOP\Sensei Arena.lnk" "$INSTDIR\Sensei Arena.exe"

  ; --- Firewall ---
  ; Por que liberar o .exe do APP (não só o mongod): o servidor Fastify de
  ; cada produto escuta em 0.0.0.0 sempre (mesmo em modo "Sozinho" — ver
  ; apps/{arena,dojo}/server/src/index.ts), porque roda no mesmo processo
  ; que a janela principal (ELECTRON_RUN_AS_NODE=1 — ver
  ; packages/desktop-runtime/src/supervisor.ts). Regra por programa, não por
  ; porta: mais simples de manter e cobre a porta certa mesmo se ela mudar.
  ; profile=private,domain (nunca "public") — rede do ginásio não deve ser
  ; tratada como confiável só por estar plugada.
  nsExec::ExecToLog 'netsh advfirewall firewall add rule name="Sensei Arena" dir=in action=allow program="$INSTDIR\Sensei Arena.exe" enable=yes profile=private,domain'
  nsExec::ExecToLog 'netsh advfirewall firewall add rule name="Sensei Arena (mongod)" dir=in action=allow program="$INSTDIR\resources\mongodb\mongod.exe" enable=yes profile=private,domain'
  nsExec::ExecToLog 'netsh advfirewall firewall add rule name="Sensei Dojo" dir=in action=allow program="$PROGRAMFILES64\Sensei Dojo\Sensei Dojô.exe" enable=yes profile=private,domain'
  nsExec::ExecToLog 'netsh advfirewall firewall add rule name="Sensei Dojo (mongod)" dir=in action=allow program="$PROGRAMFILES64\Sensei Dojo\resources\mongodb\mongod.exe" enable=yes profile=private,domain'
!macroend

!macro customUnInstall
  nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="Sensei Arena"'
  nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="Sensei Arena (mongod)"'
  nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="Sensei Dojo"'
  nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="Sensei Dojo (mongod)"'

  RMDir /r "$PROGRAMFILES64\Sensei Dojo"
  Delete "$SMPROGRAMS\Sensei Hub\Sensei Dojo.lnk"
  Delete "$SMPROGRAMS\Sensei Hub\Sensei Arena.lnk"
  RMDir "$SMPROGRAMS\Sensei Hub"
  Delete "$DESKTOP\Sensei Dojo.lnk"
  Delete "$DESKTOP\Sensei Arena.lnk"
!macroend
