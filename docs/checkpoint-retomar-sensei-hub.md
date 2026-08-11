# Checkpoint para retomar o Sensei Hub

Data do checkpoint: 2026-08-11

## Estado

O projeto foi executado em ambiente local com MongoDB efêmero e Playwright MCP.
Os servidores foram encerrados ao final; não há processos de desenvolvimento ou
MongoDB pendurados.

## Validações realizadas

- Arena: 242 testes do servidor passaram.
- Arena: typechecks de shared, servidor e web passaram; o build web passou.
- Dojo: 53 testes do servidor passaram.
- Dojo: typechecks e builds de shared, servidor e web passaram; o Next gerou
  as 12 páginas esperadas.
- Arena via Playwright: login, evento seed com 106 divisões e 52 atletas,
  inscrições, check-in e desfazer, pesagem, áreas, telão, configurações e
  bloqueio de geração de chave foram verificados. Não houve erro inesperado de
  console ou rede.
- Dojo via Playwright: login de administrador, sensei e aluno, RBAC, atletas,
  turmas, aulas, solicitação e confirmação de presença, histórico e
  recarregamento foram verificados. Não houve erro inesperado de console ou
  rede.
- O encerramento foi repetido três vezes na Arena e três no Dojo. Todos os
  ciclos terminaram sem erro de cleanup, processos órfãos ou novos diretórios
  temporários.

Os testes cobrem autenticação, RBAC, atletas, usuários, divisões, inscrições,
check-in, pesagem, importação, chaves, placar, áreas, modo offline, privacidade
e cluster.

## Pendências conhecidas

- O Dojo publica um manifesto, mas não registra service worker no modo de
  desenvolvimento; portanto o comportamento offline não foi exercitado.
- No Windows, ainda convém validar nativamente o encerramento da árvore de
  processos `pnpm`/Next/tsx. Linux foi validado; a configuração usada também é
  compatível com macOS.

## Como retomar

1. Ler este checkpoint e verificar `git status`, preservando as alterações já
   existentes.
2. Executar novamente o produto necessário (`pnpm dev:run arena` ou
   `pnpm dev:run dojo`).
3. Rodar o seed correspondente (`pnpm dev:seed` ou `pnpm seed:dojo`).
4. Continuar a evolução do fluxo de presença do Dojo.
5. Rodar `pnpm test` e repetir a validação pelo Playwright quando houver novas
   alterações relevantes.

As credenciais de desenvolvimento permanecem definidas nos scripts de seed;
não duplicá-las neste documento.
