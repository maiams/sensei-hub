# Deploy Windows — instalador desktop (Dojô + Arena)

Este documento descreve como gerar o instalador Windows do Sensei Hub, o que
foi verificado nesta máquina (macOS) e o que só dá para confirmar numa
máquina Windows de verdade (ou CI `windows-latest`). Não trate nada marcado
como "não verificado" como funcionando — é exatamente o oposto do ponto
deste documento.

## 1. O bloqueio original (standalone do Next) — resolvido

Foi relatado que `apps/*/web/.next/standalone/server.js` falhava com
`Cannot find module '.../vendor-chunks/next@...js'` ao rodar dentro do app
empacotado, e que `next start` não funcionava com `output: 'standalone'`.

**Não foi possível reproduzir esse erro exato** com um build limpo. O que
foi encontrado, e que bloqueava mesmo assim, foi outra coisa:

- Havia **symlinks quebrados** em `node_modules` (`apps/arena/web/node_modules/@dojo/shared`,
  `apps/dojo/server/node_modules/@arena/shared`, e três entradas em
  `node_modules/.pnpm/node_modules/@sensei-hub/{app,server,web}`) apontando
  para caminhos que não existem mais desde a separação Dojô/Arena (commits
  "refactor: packages/server vira @dojo/server..." e "refactor: fork do
  web..."). `pnpm install` e `pnpm install --force` não os removeram — são
  artefatos órfãos que o pnpm não detecta como extraneous porque não
  correspondem a nenhuma dependência declarada.
- Isso não quebrava `next build` nem `node server.js` isoladamente (testado),
  mas quebrava o `@electron/rebuild` do electron-builder com
  `ENOENT: no such file or directory, stat '.../node_modules/@dojo/shared'`,
  quem sabe é essa a origem do relato original (o agente que reportou o
  problema pode ter interpretado um erro de empacotamento como um erro do
  Next). De qualquer forma, os symlinks quebrados foram removidos — ver
  "O que foi verificado" abaixo.

Duas hipóteses do enunciado foram checadas e **descartadas**:

- `outputFileTracingRoot`: o Next 15.5.19 já **detecta sozinho** a raiz do
  monorepo (acha `pnpm-lock.yaml` subindo os diretórios) — o `server.js`
  gerado já embute `"outputFileTracingRoot":"/Users/.../sensei-hub"` mesmo
  sem essa opção estar em `next.config.ts`. Não é preciso setar
  explicitamente.
- Cópia de `.next/static` e `public/`: `scripts/package-app.mjs` **já fazia**
  isso (passo 4/6) antes desta sessão — não era a causa.

### O que foi verificado

1. `next build` limpo (Arena e Dojô) + `node .next/standalone/.../server.js`
   direto: HTTP 200, HTML real da tela de login (`Sensei Arena`, `Sensei
   Dojô`, formulário com `Entrar`), nada de "Cannot find module".
2. Pipeline completo (`node scripts/package-app.mjs arena -- --mac`): gerou
   `Sensei Arena.app` + `.dmg` de verdade. Rodei o `server.js` **de dentro do
   `.app` empacotado**, usando o próprio binário Electron do app em modo
   `ELECTRON_RUN_AS_NODE=1` — exatamente como `supervisor.ts` faz — e o
   HTML da tela de login voltou completo (8685 bytes, sem erro).
3. `pnpm typecheck`, `pnpm test` (237 testes, Dojô + Arena server) e
   `pnpm build` continuam verdes depois de tudo isso.

Isso é evidência do **pipeline em macOS**, não de que o app funciona em
Windows — ver §4.

## 2. Correção feita (para não voltar a acontecer)

Os 8 symlinks órfãos foram apagados manualmente (não são rastreados pelo
git — `node_modules/` é ignorado). Se isso reaparecer depois de mover
pastas do monorepo de novo, o sintoma é `ENOENT` no `@electron/rebuild` do
electron-builder (não no Next). Para checar:

```bash
find . -path ./node_modules/.pnpm -prune -o -type l -print 2>/dev/null | \
  while read -r l; do [ -e "$l" ] || echo "quebrado: $l"; done
```

Também corrigido: `.gitignore` ainda tinha os caminhos antigos
(`packages/server/deploy/`, `packages/app/release/`) de antes da separação
em produtos — os caminhos reais hoje são `apps/*/server/deploy/` e
`apps/*/desktop/release/`, e não estavam ignorados. Ou seja, um `git add -A`
descuidado teria puxado gigabytes de instaladores e `node_modules` de deploy
para o repositório. Corrigido para o padrão atual.

## 3. Gerando o instalador

### Um produto por vez (build normal, qualquer plataforma)

```bash
node scripts/package-app.mjs arena -- --mac      # ou --win, --linux
node scripts/package-app.mjs dojo -- --win
```

Saída em `apps/<produto>/desktop/release/`.

### Instalador único Windows (Dojô + Arena, dois atalhos)

```bash
pnpm package:installer:win
# equivale a: node scripts/package-installer.mjs -- --x64
```

Saída: **um único** `Sensei Arena Setup 0.1.0.exe` em
`apps/arena/desktop/release/` que instala os dois produtos.

**Como funciona** — electron-builder empacota um app por vez; não existe
"modo dois produtos" nativo. A abordagem usa só mecanismos documentados do
electron-builder (nada de `.nsi` escrito do zero nem `makensis` manual):

1. Empacota o Dojô com o alvo `--win dir` (pasta desempacotada, sem
   instalador próprio).
2. Empacota o Arena com o alvo `nsis` normal. `apps/arena/desktop/package.json`
   traz a pasta do Dojô do passo 1 como `win.extraResources` (`to:
   "dojo-app"`) e inclui `installer/win/custom.nsh` via `nsis.include`.
3. `installer/win/custom.nsh` usa os hooks `customInstall`/`customUnInstall`
   do electron-builder para: copiar os arquivos do Dojô (já extraídos em
   `$INSTDIR\resources\dojo-app`) para `Program Files\Sensei Dojo`, criar
   atalhos dos dois produtos (Menu Iniciar e Área de Trabalho), e liberar as
   regras de firewall (§5). No desinstalador, desfaz tudo isso.

Se essa abordagem se mostrar frágil na prática (ex.: colisão de recursos,
caminho com "ô" causando problema em alguma ferramenta Windows), a
alternativa mais simples é dois instaladores `.exe` separados chamados em
sequência por um instalador "wrapper" (`ExecWait ... /S`) — não foi o
caminho escolhido porque a abordagem de `extraResources` +
`customInstall`/`customUnInstall` é a documentada oficialmente pelo
electron-builder e tem menos superfície pra erro de sintaxe NSIS que eu não
consigo detectar sem um compilador rodando em Windows de verdade.

### O que foi verificado sobre o instalador combinado

Cross-build **rodou até o fim em macOS, sem Wine instalado manualmente** —
o electron-builder baixa seu próprio NSIS e um Wine vendorizado
(`wine-4.0.1-mac`) na primeira vez que precisa assinar/editar recursos de um
PE do Windows. Isso prova que:

- O `.nsh` customizado **compila sem erro de sintaxe** (senão o
  electron-builder teria abortado o build).
- O `.exe` final é um **PE32 NSIS self-extracting archive válido** (`file`
  confirma), ~254 MB, com o payload do Dojô de fato embutido em
  `resources/dojo-app/Sensei Dojô.exe` dentro do pacote.
- O log confirma `oneClick=false perMachine=true` — a config de elevação
  (§5) foi aplicada.

**O que isso NÃO prova**: que o instalador roda em Windows de verdade. Não
dá pra saber se o UAC aparece corretamente, se `CopyFiles` para
`$PROGRAMFILES64\Sensei Dojo` funciona, se os atalhos apontam certo, se o
`netsh` de fato roda com permissão suficiente, ou se o desinstalador limpa
tudo. Isso só valida numa VM/máquina Windows real ou num runner
`windows-latest` de CI.

## 4. O que exige Windows real (não validado aqui)

- Instalar o `.exe` de verdade e confirmar que o UAC pede elevação, que os
  dois atalhos aparecem (Menu Iniciar e Área de Trabalho) e abrem os apps
  certos.
- Confirmar que as regras de firewall foram criadas (`netsh advfirewall
  firewall show rule name=all | findstr Sensei`) e que **nenhum popup do
  Firewall do Windows aparece** ao ligar o modo "Em rede" (mongod bind
  `0.0.0.0` + o processo do app, que já escuta em `0.0.0.0` mesmo sozinho —
  ver §5).
- Rodar o app instalado numa mesa/pesagem/telão real e confirmar que os
  processos filhos (mongod, server Fastify, Next standalone) sobem via
  `ELECTRON_RUN_AS_NODE=1` sem erro — a lógica é a mesma testada no `.app`
  do macOS, mas o binário Windows do Electron/Node nunca rodou aqui.
- Confirmar que o desinstalador remove `Program Files\Sensei Dojo`, os
  atalhos e as regras de firewall.
- `resources/mongodb/win-x64/mongod.exe` nunca foi executado nesta sessão
  (não dá para rodar um binário Windows em macOS) — só confirmei que o
  arquivo existe e é referenciado corretamente pelo `extraResources`.

Caminho recomendado: uma VM Windows (ou uma máquina física) para o primeiro
teste manual completo, depois um workflow de CI em `windows-latest` que rode
`pnpm package:installer:win` e pelo menos instale silenciosamente
(`/S`) + confira que os processos sobem, antes de qualquer release real.

## 5. Regras de firewall — quais portas e por quê

O instalador roda **elevado** (`nsis.perMachine: true` +
`oneClick: false`, aplicado a `apps/arena/desktop/package.json` e
`apps/dojo/desktop/package.json` — antes desta mudança o padrão do
electron-builder era `oneClick: true, perMachine: false`, que instala sem
elevação e **não conseguiria** nem copiar para Program Files nem chamar
`netsh`). É essa elevação que permite `installer/win/custom.nsh` rodar
`netsh advfirewall` durante a instalação, evitando o popup interativo do
Firewall do Windows na frente do operador durante o evento.

As regras são **por programa**, não por porta:

| Regra | Programa | Por quê |
|---|---|---|
| `Sensei Arena` | `Sensei Arena.exe` | O servidor Fastify da Arena escuta em `0.0.0.0:3001` **sempre**, mesmo no modo "Sozinho" (`apps/arena/server/src/index.ts` — não é condicional ao modo de rede). Ele roda no mesmo processo do app principal, via `ELECTRON_RUN_AS_NODE=1` (`packages/desktop-runtime/src/supervisor.ts`), por isso a regra é no `.exe` do app, não num processo separado. |
| `Sensei Arena (mongod)` | `resources\mongodb\mongod.exe` | Só bind em `0.0.0.0` no modo "Em rede" (`bindIp` — ver `Supervisor`), mas a regra é criada na instalação porque é o único momento em que o instalador roda elevado; o modo de rede é escolhido depois, na primeira execução (§6). |
| `Sensei Dojo` | `Sensei Dojô.exe` (copiado para `Program Files\Sensei Dojo`) | Mesmo motivo do Arena — `apps/dojo/server/src/index.ts` também escuta em `0.0.0.0` sempre. O Dojô não tem modo cluster (`features.cluster: false`), mas o servidor Fastify liga em `0.0.0.0` de qualquer forma. |
| `Sensei Dojo (mongod)` | `Program Files\Sensei Dojo\resources\mongodb\mongod.exe` | Defesa em profundidade — hoje o Dojô nunca liga `bindIp: '0.0.0.0'`, mas a regra evita surpresa se isso mudar. |

Todas as regras usam `profile=private,domain` — **nunca `public`**. Decisão
deliberada: a rede Wi-Fi de um ginásio raramente está classificada como
"privada" de propósito, e liberar portas de banco de dados e da API numa
rede que o Windows não considera confiável é uma exposição desnecessária.
Se o Wi-Fi do local estiver classificado como "Pública" no Windows, o modo
"Em rede" não vai funcionar até o operador reclassificar a rede — isso é
esperado, não um bug.

Regras por programa (em vez de por porta) porque a porta é configurável e
pode mudar; a regra por caminho do executável cobre a porta certa
automaticamente e é mais fácil de auditar (`netsh advfirewall firewall show
rule name=all` mostra o nome "Sensei Arena"/"Sensei Dojo" e para quê serve).

Descoberta mDNS (`multicast-dns`, UDP 5353) roda dentro do mesmo processo do
servidor Fastify — já coberta pela regra do `.exe` do app, sem regra extra.

## 6. Modo de rede — "sozinho" vs "em rede"

O enunciado original pedia para o instalador/app perguntar se a máquina é
"o SERVIDOR" ou "uma ESTAÇÃO". **Isso não corresponde exatamente à
arquitetura que a Fase 7 implementou**, e acho importante deixar isso
registrado em vez de simular uma distinção que o código não tem:

O `ClusterManager` (Fase 7, `apps/arena/server/src/cluster/`) é **peer-to-
peer**: toda máquina que entra no cluster mantém seu próprio `mongod` como
membro do replica set e pode virar primary numa eleição. Não existe um papel
de "estação" que não guarda dados — todo nó guarda uma réplica completa. A
própria descoberta via mDNS já decide sozinha, em cada nó, se ele funda um
replica set novo (não achou ninguém) ou entra num existente (achou peers) —
não precisa que o operador diga qual máquina é "a principal".

O que foi implementado (`packages/desktop-runtime/src/networkMode.ts`) é a
pergunta que **de fato** corresponde ao código: um diálogo nativo, uma vez
por máquina, na primeira execução — "Este computador vai ser usado sozinho
ou em rede com outros computadores do ginásio?" — com duas opções:

- **Sozinho**: `bindIp: '127.0.0.1'`, cluster desligado (era o
  comportamento padrão já existente).
- **Em rede**: `bindIp: '0.0.0.0'`, `clusterEnabled: true`. Todo computador
  que vai participar do mesmo evento escolhe essa opção — não precisa
  indicar qual é "o servidor".

A resposta fica salva em
`app.getPath('userData')/network-mode.json` e só é perguntada de novo se o
operador escolher "Rede → Alterar modo de rede…" no menu do app (que apaga o
arquivo e reinicia). Só o Arena pergunta isso — o Dojô
(`features.cluster: false`) sempre roda sozinho, sem diálogo.

`CLUSTER_ENABLED=true` (variável de ambiente) continua funcionando como
bypass de desenvolvimento/CI, sem passar pelo diálogo — usado por
`scripts/dev-run.mjs` e por testes automatizados de empacotamento.

**Não verificado**: o diálogo nativo (`dialog.showMessageBoxSync`) foi
revisado e passa no typecheck, mas nunca foi clicado de verdade (exige uma
janela do Electron rodando interativamente, o que não dá para automatizar
nesta sessão). A lógica de persistência (ler/escrever o JSON) é simples o
suficiente para não preocupar, mas o fluxo completo — diálogo → gravação →
próxima abertura não pergunta de novo → menu "Alterar modo de rede" reabre a
pergunta — não foi exercitado ponta a ponta.

## 7. Assinatura de código — pendência conhecida

**Não implementado, e não deveria ser contornado.** Sem um certificado de
assinatura de código ("Developer ID" / certificado EV ou padrão para
Windows), o SmartScreen do Windows vai bloquear a instalação com um aviso de
"Windows protegeu seu computador" / "aplicativo não reconhecido", exigindo
que o usuário clique em "Mais informações → Executar assim mesmo". Isso é
esperado neste estágio — o log do electron-builder confirma
`no signing info identified, signing is skipped` em todos os `.exe`
gerados nesta sessão.

Para academias/donos de ginásio leigos, esse aviso é assustador e pode
travar a adoção. Não é um problema deste código — é uma decisão de negócio
pendente (comprar um certificado de assinatura de código, tipicamente
pago e recorrente) que precisa ser resolvida antes de distribuir o
instalador para usuários finais fora de um ambiente controlado (ex.:
entregando o `.exe` pessoalmente com instrução para clicar em "Executar
assim mesmo").

## 8. Resumo dos comandos

```bash
# Um produto, qualquer plataforma
node scripts/package-app.mjs arena -- --mac
node scripts/package-app.mjs dojo -- --win

# Instalador único Windows (recomendado para distribuição)
pnpm package:installer:win

# Verificar symlinks quebrados (sintoma: ENOENT no @electron/rebuild)
find . -path ./node_modules/.pnpm -prune -o -type l -print 2>/dev/null | \
  while read -r l; do [ -e "$l" ] || echo "quebrado: $l"; done
```
