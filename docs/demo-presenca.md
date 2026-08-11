# Checkpoint — presença do Sensei Dojô

## Como retomar

Quando o usuário disser **“retome o projeto”**, usar este documento como ponto
de partida. Não reiniciar a modelagem: a primeira versão navegável do sistema de
presença já está implementada. Primeiro verificar `git status`, executar as
validações abaixo e subir novamente o ambiente de demonstração.

**Branch de trabalho:** `feat/arena-operacao-e-deploy-windows`.

## Estado salvo em 2026-08-10

Implementado no backend:

- Vínculo opcional entre conta (`User`) e atleta (`Athlete.userId`).
- Turmas, matrículas e aulas concretas.
- Chamada com projeção atual por aluno.
- Solicitações `pending`, `confirmed`, `rejected` e `expired`.
- Resultados `unmarked`, `present` e `absent`.
- Confirmação, recusa com motivo, presença direta e correção auditada.
- `AttendanceEvent` append-only, `AuditLog`, transações, proteção contra
  concorrência e idempotência nos POSTs críticos.
- Isolamento por academia e autorização explícita para aluno, Sensei e admin.
- Janela materializada por aula: abre 30 minutos antes, fecha 60 minutos após o
  início e decisões pendentes expiram 24 horas após o término.

Implementado no frontend:

- Navegação específica para aluno, Sensei e administrador.
- Página Hoje e histórico do aluno.
- Turmas, matrículas, aulas e criação manual de aula.
- Chamada responsiva em ordem alfabética, com nome e idade.
- Filtros e ações individuais de confirmar, recusar, dar presença e corrigir.
- Motivo obrigatório, prevenção de duplo toque e estados de carregamento,
  vazio, erro, offline e envio.
- Layout acessível e utilizável a partir de 320 px.
- Manifesto PWA; instalação e GPS dependem de HTTPS.

## Validação já realizada

- Backend: **53/53 testes passando**.
- Typecheck de shared, server e web: passou.
- Build de produção do web: passou.
- Fluxo real validado: aluno solicitou presença, repetição retornou o mesmo
  registro, Sensei confirmou, nova repetição não duplicou e dashboard/histórico
  exibiram `present`.
- O lint não foi executado porque ESLint ainda não está configurado e o comando
  atual abre configuração interativa.

## Arquivos centrais

- `apps/dojo/shared/src/attendance.ts`
- `apps/dojo/server/src/services/AttendanceService.ts`
- `apps/dojo/server/src/routes/attendance.ts`
- `apps/dojo/server/src/repositories/{TrainingClass,ClassEnrollment,Lesson,AttendanceRequest,AttendanceRecord,AttendanceEvent}Model.ts`
- `apps/dojo/server/src/__tests__/attendance.test.ts`
- `apps/dojo/web/src/app/{attendance,classes,lessons}/`
- `apps/dojo/web/src/components/PresenceShell.tsx`
- `apps/dojo/web/src/components/PresenceUI.tsx`
- `apps/dojo/web/src/lib/presence.ts`
- `scripts/dev-seed-dojo.mjs`

## Como executar a demo

Com o ambiente do Dojô em execução, rode:

```bash
pnpm seed:dojo
```

O seed só aceita a API em `localhost`/`127.0.0.1`, cria uma turma, uma aula que começa em dez minutos e três contas:

- Administrador: `admin@dojo.demo` / `sensei123`
- Sensei: `sensei@dojo.demo` / `sensei123`
- Aluno: `aluno@dojo.demo` / `sensei123`

As credenciais são somente para desenvolvimento. Use um banco de desenvolvimento limpo se o setup inicial já tiver sido feito com outra conta.

O servidor do Dojô já escuta em `0.0.0.0:3101`. O endereço da interface na LAN depende da porta publicada pelo Next.js; consulte o IP Linux com `hostname -I` e abra `http://IP:PORTA` no celular.

Na validação de 2026-08-10 foi usado `http://10.0.1.220:3100`, mas esse IP é
**temporário** e pode mudar após reiniciar a máquina ou o roteador. Para a
próxima sessão, redescobrir o IP e confirmar tanto `/login` quanto
`/api/health` antes de entregá-lo ao usuário.

Em HTTP por IP local, navegadores móveis normalmente recusam geolocalização e instalação PWA por falta de contexto seguro. O pedido continua funcionando com localização “não informada”. Para testar GPS/PWA é necessário HTTPS com certificado confiado pelo celular.

## Próximos passos recomendados

1. Revisar visualmente as telas no celular real e anotar atritos.
2. Configurar coordenadas e raio do dojô.
3. Servir a demo em HTTPS local para validar geolocalização e instalação PWA.
4. Implementar autocadastro e aprovação de aluno.
5. Implementar cronograma recorrente e geração idempotente de aulas.
6. Adicionar notificações internas e gerenciamento de sessões/dispositivos.
7. Configurar ESLint sem interação e adicioná-lo à validação.
8. Fazer commit intencional depois da revisão do usuário.
