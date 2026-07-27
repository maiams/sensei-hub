# Service Worker fossilizado — diagnóstico e recuperação

Incidente de referência: 26/jul/2026. `http://localhost:3000` (Sensei Arena)
abriu com tela branca e "Application error: a client-side exception has
occurred", com ~14 erros no console `TypeError: Cannot read properties of
undefined (reading 'call')` — em módulos internos do próprio Next, não só no
código da aplicação.

## Sintoma

- Tela branca ou erro genérico do React ao abrir a aplicação.
- Console cheio de `Cannot read properties of undefined (reading 'call')`,
  em muitos módulos ao mesmo tempo (não um erro isolado de um componente).
- `rm -rf .next` + reiniciar o servidor de dev **não resolve**.
- Em geral acontece depois que alguém rodou `next build && next start` (ou um
  build de produção) uma vez na mesma origem (`localhost:3000`), mesmo que
  volte a usar `next dev` depois.

## Causa raiz

O Sensei Arena tem um service worker gerado pelo Serwist
(`apps/arena/web/src/app/sw.ts` → `public/sw.js`, ver
`apps/arena/web/next.config.ts`). Ele só é gerado/ativado em build de
**produção** (`disable: process.env.NODE_ENV !== 'production'`) — em dev
normal ele nem existe.

Se em algum momento alguém rodou a aplicação em modo produção nessa mesma
origem (`localhost:3000`), o navegador registrou esse service worker e ele
passou a controlar a aba, com um precache dos assets daquele build (chunks JS
com hash, RSC payloads, etc).

Quando o ambiente volta a rodar em `next dev`:

- O dev server não serve `/sw.js` (arquivo não existe nesse modo) — a chamada
  de atualização do navegador para esse recurso falha (404), então o
  navegador **nunca instala uma versão mais nova** do service worker.
- O service worker antigo continua ativo e controlando a aba indefinidamente,
  servindo os chunks do precache antigo — que não têm nenhuma relação com o
  que o dev server está servindo agora.
- O resultado é exatamente o sintoma acima: módulos incompatíveis entre si,
  erro de "reading 'call'" (registro de módulos do webpack corrompido/
  incoerente), em qualquer parte da aplicação.

`rm -rf .next` não ajuda porque o problema não está no build do Next — está
no **navegador**, num service worker e caches que já foram salvos ali antes.

Achado relacionado (e corrigido nesta mesma sessão): `apps/arena/web/public/sw.js`
estava **commitado no git**, mesmo sendo artefato gerado a cada build de
produção (`swDest: 'public/sw.js'`). Isso significa que o arquivo em disco
podia ficar dessincronizado da árvore de fontes por dias — exatamente o tipo
de situação que alimenta esse bug. Ele foi removido do controle de versão
(`git rm --cached`, mantido em disco) e adicionado ao `.gitignore`.

## Diagnóstico rápido

No DevTools do navegador, com a aba problemática aberta:

1. **Application → Service Workers**: veja se há um worker registrado para
   `localhost:3000`, e desde quando (a data do arquivo `sw.js` que ele
   instalou costuma aparecer indiretamente pelo "Source" — ou compare com
   `git log -1 -- apps/arena/web/public/sw.js` / a data de modificação do
   arquivo em disco).
2. **Application → Cache Storage**: procure entradas como
   `serwist-precache-v2-http://localhost:3000/`, `next-static-js-assets`,
   `pages-rsc` — presença delas confirma que há caching residual de um build
   anterior.

## Recuperação manual (sempre funciona)

1. DevTools → Application → Service Workers → **Unregister** no worker de
   `localhost:3000`.
2. DevTools → Application → Storage → **Clear site data** (ou apagar cada
   entrada em Cache Storage manualmente).
3. Recarregar a página (hard reload: Cmd/Ctrl+Shift+R).

Isso resolveu o incidente de 26/jul instantaneamente.

## Recuperação automática (o que foi implementado)

Depender de um humano lembrar desses passos no meio de um campeonato é
inaceitável (ver CLAUDE.md — recuperação de erro do operador precisa ser
autônoma). `apps/arena/web/src/components/ServiceWorkerRegister.tsx` agora
implementa duas camadas:

1. **Reload em `controllerchange`.** `sw.ts` já usa `skipWaiting` +
   `clientsClaim`, então um novo service worker assume o controle das abas
   abertas imediatamente ao ser instalado — mas o JS que já está rodando na
   aba continua sendo o do build anterior até uma navegação acontecer. O
   registro agora escuta `controllerchange` e recarrega a página nesse
   momento, mantendo o JS em execução sincronizado com o que o novo service
   worker/precache realmente têm. É o par padrão recomendado para
   `skipWaiting` (Workbox/Serwist) e cobre o caso de **upgrade legítimo**
   produção → produção.
2. **Recuperação forçada ao detectar falha de chunk.** O mecanismo 1 só age
   quando existe um service worker *novo* para assumir o controle. Não ajuda
   no caso realmente observado no incidente: um service worker de um build
   antigo, sem nenhuma versão nova para atualizar (porque em dev `/sw.js`
   nem existe, então a checagem de atualização do navegador nunca encontra
   nada mais novo). Para esse caso não há evento de "atualização" para
   escutar — em vez disso o código observa o **sintoma**: um chunk que falha
   ao carregar, ou o `TypeError` de registro de módulo que vem de rodar
   chunks incompatíveis juntos. Ao detectar isso, ele desregistra todos os
   service workers, limpa todo o Cache Storage e recarrega — os mesmos
   passos manuais acima, automáticos.

Trade-off (documentado no próprio arquivo): (2) é uma heurística por
correspondência de mensagem de erro, não uma garantia — um erro de script
genuinamente não relacionado poderia, em tese, disparar essa recuperação.
Por isso há um teto de 2 tentativas automáticas por minuto
(`MAX_AUTO_RECOVERIES`); depois disso a aplicação para de tentar sozinha e
mostra um aviso fixo pedindo para o operador recarregar manualmente, em vez
de entrar num loop de reload infinito. Esse mecanismo também não recupera
estado de UI não salvo — por isso continua valendo a regra do CLAUDE.md de
que estado que importa para operação do torneio (ex.: placar) precisa estar
persistido no servidor com frequência suficiente para sobreviver a um
refresh; a recuperação automática assume isso, não substitui.

## Verificação feita nesta sessão

- `next build` em `apps/arena/web` gera `public/sw.js` do zero a partir de
  `src/app/sw.ts` (confirma que é artefato de build, não deve ser
  versionado).
- A lógica de recuperação (registro, `controllerchange`, detecção de falha
  de chunk, teto de tentativas e aviso de esgotamento) foi extraída para um
  harness estático isolado e testada via Playwright: confirma-se que, ao
  simular o erro `Cannot read properties of undefined (reading 'call')`, o
  código desregistra o service worker, limpa os caches e aciona o reload —
  duas vezes seguidas — e na terceira ocorrência para de tentar sozinho e
  mostra o aviso de recuperação esgotada, em vez de entrar em loop.
- **Não foi possível** validar esse fluxo dentro de um `next build && next
  start` real de ponta a ponta neste ambiente: `next start` não funciona com
  `output: 'standalone'` (aviso do próprio Next), e rodar o servidor
  standalone gerado (`node .next/standalone/apps/arena/web/server.js`) falha
  com `Cannot find module '.../vendor-chunks/next@...js'` ao processar
  qualquer rota — um problema pré-existente de tracing de arquivos do Next
  em monorepo pnpm, sem relação com o service worker, e fora do escopo desta
  correção. Recomenda-se investigar esse problema separadamente antes de um
  primeiro deploy real de produção do Arena.
