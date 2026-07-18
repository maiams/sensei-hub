---
description: Apresenta o mapa do repositório sensei-hub sem escanear o filesystem. Use no início de uma sessão ou ao mudar de contexto (ex: de auth para bracket engine).
allowed-tools: Read
---

# Sensei Hub — Mapa do Repositório

Use este mapa para orientar a sessão sem precisar reler arquivos de estrutura.

## Pacotes

| Pacote | Caminho | Responsabilidade |
|--------|---------|-----------------|
| `@sensei-hub/shared` | `packages/shared/src/domain/` | Schemas Zod + tipos TypeScript de domínio |
| `@sensei-hub/server` | `packages/server/src/` | API Fastify 5, Mongoose models, serviços |
| `@sensei-hub/web` | `packages/web/app/` | Next.js 15 App Router, UI |
| `@sensei-hub/app` | `packages/app/src/` | Electron: supervisor de processos + kiosk |

## Arquivos-chave por domínio

### Shared (tipos)
- `packages/shared/src/domain/user.ts` — UserRole, ROLE_HIERARCHY, hasMinRole, CreateUserInput, UserDTO
- `packages/shared/src/domain/athlete.ts` — Belt, AgeClass, CreateAthleteInput, AthleteDTO, AthleteDocumentSchema
- `packages/shared/src/domain/event.ts` — EventStatus, EventEntryStatus, CreateEventInput, DivisionSchema, EventEntrySchema
- `packages/shared/src/domain/bracket.ts` — BracketConfig (discriminated union), EliminationBracketConfig, RoundRobinBracketConfig, MatchSchema
- `packages/shared/src/domain/scoreboard.ts` — ScoreboardSchema

### Server
- `packages/server/src/config/env.ts` — variáveis de ambiente validadas com Zod
- `packages/server/src/config/database.ts` — connectDatabase(), isDatabaseConnected()
- `packages/server/src/routes/health.ts` — GET /api/health (verifica isWritablePrimary), POST /api/shutdown-prep
- `packages/server/src/app.ts` — buildApp() Fastify

### App (Electron)
- `packages/app/src/main.ts` — entry point, cria Supervisor e janela kiosk
- `packages/app/src/supervisor.ts` — Supervisor class: spawna mongod + server, RS init, health loop, restart lock
- `packages/app/src/kiosk.ts` — BrowserWindow kiosk, bloqueio de atalhos, saída de emergência

## Convenções

- Datas civis: `YYYY-MM-DD` (z.string().date())
- Timestamps: ISO 8601 UTC (z.string().datetime())
- IDs: string (ObjectId serializado como string nas respostas de API)
- writeConcern: `{ w: 'majority' }` em todas as escritas críticas
- Mongoose: `select: false` em campos sensíveis (passwordHash, dados médicos)

## Fases de implementação

- **Fase 0 ✅** — Monorepo, shared types, server stub, Electron supervisor, Docker RS
- **Fase 0.5 ✅** — Bugs do supervisor corrigidos, discriminated union de bracket, DTOs separados
- **Fase 1 🔄** — Auth + RBAC + first-run setup (próxima)
- **Fase 2** — Atleta CRUD + Guardian + Belt/Weight records
- **Fase 3A** — Evento + Divisões + Inscrições
- **Fase 3B** — Bracket engine puro + testes
- **Fase 3C** — Persistência de bracket + match results
- **Fase 3D** — Import Excel
- **Fase 4** — Scoreboard + WebSocket
- **Fase 5** — Check-in + Weigh-in
- **Fase 6** — PWA + Offline
- **Fase 7** — ClusterManager mDNS + RS dinâmico

## Comandos úteis

```bash
# Typecheck de todos os pacotes
npx tsc --noEmit -p packages/shared/tsconfig.json
npx tsc --noEmit -p packages/server/tsconfig.json
npx tsc --noEmit -p packages/app/tsconfig.json
npx tsc --noEmit -p packages/web/tsconfig.json

# Dev com Docker (3 nós MongoDB)
docker compose up -d
pnpm --filter @sensei-hub/server dev
pnpm --filter @sensei-hub/web dev

# Health check
curl http://localhost:3001/api/health
```
