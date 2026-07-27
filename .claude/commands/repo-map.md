---
description: Apresenta o mapa do repositório sensei-hub sem escanear o filesystem. Use no início de uma sessão ou ao mudar de contexto (ex: de auth para bracket engine).
allowed-tools: Read
---

# Sensei Hub — Mapa do Repositório

Use este mapa para orientar a sessão sem precisar reler arquivos de estrutura.
Fonte de verdade: `docs/status-e-plano.md` §3 (estrutura) e §3.1 (pontes de
domínio) — releia lá se algo aqui parecer desatualizado.

Sensei Hub é a marca guarda-chuva de **dois produtos independentes** que
compartilham stack técnica mas rodam e persistem dados separadamente:

- **Sensei Dojô** (`apps/dojo/`) — gestão de academia: atletas, anamnese,
  responsáveis, faixas, acompanhamento de peso, staff.
- **Sensei Arena** (`apps/arena/`) — gestão de campeonato: eventos, divisões,
  inscrições, check-in, pesagem oficial, brackets, mesas, placar, display
  público, impressão, import de Excel, PWA/offline, cluster mDNS.

Os dois só se integram por arquivo (o Dojô exporta um `.xlsx` que a Arena
importa) — nunca em runtime. Não misture responsabilidades: recurso de
gestão de academia é Dojô, recurso de campeonato é Arena.

## Pacotes

| Pacote | Caminho | Porta (dev) | Responsabilidade |
|--------|---------|-------------|-------------------|
| `@dojo/shared` | `apps/dojo/shared/src/` | — | Schemas Zod do domínio Dojô (Athlete completo) |
| `@dojo/server` | `apps/dojo/server/src/` | 3101 | Fastify — atleta, guardian, belt/weight, export .xlsx |
| `@dojo/web` | `apps/dojo/web/src/` | 3100 | Next.js 15 App Router |
| `@dojo/desktop` | `apps/dojo/desktop/src/` | — | Electron (janela simples) |
| `@arena/shared` | `apps/arena/shared/src/` | — | Schemas Zod de evento, divisão, bracket, scoreboard, competidor slim |
| `@arena/server` | `apps/arena/server/src/` | 3001 | Fastify — evento/divisão/bracket/placar/check-in/import + cluster mDNS |
| `@arena/web` | `apps/arena/web/src/` | 3000 | Next.js 15 App Router, PWA (Serwist) |
| `@arena/desktop` | `apps/arena/desktop/src/` | — | Electron (kiosk/placar + arbiter) |
| `@sensei-hub/shared` | `packages/shared/src/` | — | Tipos comuns aos dois produtos (ver abaixo) |
| `@sensei-hub/core-server` | `packages/core-server/src/` | — | Auth/RBAC/setup/health genéricos (ver abaixo) |
| `@sensei-hub/core-web` | `packages/core-web/src/` | — | Client de API, labels comuns, LoginPage/SetupPage |
| `@sensei-hub/desktop-runtime` | `packages/desktop-runtime/src/` | — | Supervisor de processos + kiosk parametrizados |

## Arquivos-chave por domínio

### `@sensei-hub/shared` (tipos compartilhados pelos dois produtos)
- `packages/shared/src/domain/user.ts` — UserRole, ROLE_HIERARCHY, hasMinRole, FirstRunSetupInput, UserDTO
- `packages/shared/src/domain/common.ts` — Belt, Gender, WeightSource, `BELT_LABEL_PT`, `ATHLETE_SHEET_HEADERS` (contrato do .xlsx Dojô→Arena)
- `packages/shared/src/domain/cpf.ts` — validação de CPF

### `@sensei-hub/core-server` (infra genérica de auth/setup)
- `packages/core-server/src/routes/setup.ts` — `GET /setup/status`, `POST /setup` (first-run: academia + admin)
- `packages/core-server/src/routes/auth.ts` — `POST /auth/login|refresh|logout`
- `packages/core-server/src/middleware/authenticate.ts` / `authorize.ts` — RBAC server-side
- `packages/core-server/src/services/AuthService.ts` — login, refresh, TokenPair
- `packages/core-server/src/repositories/{AcademyModel,UserModel,RefreshTokenModel,AuditLogModel}.ts`
- `packages/core-server/src/testing/db.ts` — helper de Mongo in-memory para testes
- `packages/core-server/src/context.ts` — `AuthCtx` (userId, academyId, role, sessionId, ip) — usado por todos os services dos dois produtos

### Dojô — domínio
- `apps/dojo/shared/src/athlete.ts` — Athlete completo (anamnese, matrícula), Guardian, BeltRecord
- `apps/dojo/server/src/services/AthleteService.ts`, `WeightService.ts`, `ExportService.ts` (gera o .xlsx que a Arena importa)
- `apps/dojo/server/src/repositories/{AthleteModel,GuardianModel,BeltRecordModel,WeightRecordModel}.ts`
- `apps/dojo/server/src/routes/athletes.ts`

### Arena — domínio
- `apps/arena/shared/src/{event,bracket,scoreboard,competitor,divisionTemplate,attendance,scale,cluster}.ts`
- `apps/arena/server/src/services/EventService.ts`, `DivisionService.ts`, `EventEntryService.ts` — evento/divisão/inscrição
- `apps/arena/server/src/services/DivisionTemplateService.ts` + `fpjPreset.ts` — preset de divisões FPJ, `loadFpjPreset()` idempotente
- `apps/arena/server/src/services/BracketService.ts` + `domain/bracket/{EliminationEngine,RodizioEngine,bracketTree,seeding}.ts` — bracket engine puro, testado à parte
- `apps/arena/server/src/services/ScoreboardService.ts`, `MatchDispatchService.ts`, `PublicDisplayService.ts` — placar, roteamento de lutas, display público
- `apps/arena/server/src/services/CompetitorService.ts` — competidor slim (sem anamnese, sempre ligado a `EventEntry`; o model Mongoose continua chamado `Athlete` para preservar refs)
- `apps/arena/server/src/services/CheckInService.ts`, `WeightService.ts` — check-in e pesagem oficial de evento (`WeightRecord` da Arena exige `eventId`, diferente do Dojô)
- `apps/arena/server/src/services/ImportService.ts` — import do .xlsx (colunas de `ATHLETE_SHEET_HEADERS`, sem coluna "categoria" — divisão é derivada de idade+peso+gênero)
- `apps/arena/server/src/adapters/ScaleAdapter.ts` — integração de balança isolada atrás de adapter
- `apps/arena/server/src/cluster/{ClusterManager,mdns,rules}.ts` — cluster mDNS, replica set dinâmico
- `apps/arena/web/src/app/sw.ts` + `src/components/ServiceWorkerRegister.tsx` — PWA/offline; ver `docs/dev-service-worker-cache-recovery.md` para a estratégia de recuperação de service worker fossilizado

## Convenções

- Datas civis: `YYYY-MM-DD` (`z.string().date()`)
- Timestamps: ISO 8601 UTC (`z.string().datetime()`)
- IDs: string (ObjectId serializado como string nas respostas de API)
- `writeConcern: { w: 'majority' }` em todas as escritas críticas
- Mongoose: `select: false` em campos sensíveis (passwordHash, dados médicos)
- Cada service expõe uma classe de erro própria (`*ServiceError`) com `statusCode`; rotas convertem em `handleError(err, reply)`

## Estado do roadmap

Fases 0 a 7 (fundação → auth/RBAC → atleta → evento/divisão → bracket engine
→ persistência de bracket/match → import Excel → scoreboard/WebSocket →
check-in/weigh-in → PWA/offline → cluster mDNS) estão **concluídas** — isso
foi implementado como monolito único e depois **separado em dois produtos**
(Dojô/Arena, ver `docs/status-e-plano.md` §3.1 para as pontes de domínio).
Não trate isso como trabalho futuro; consulte `docs/status-e-plano.md` para
o que está em andamento agora.

## Comandos que funcionam neste ambiente

Não há Docker disponível neste ambiente de desenvolvimento — mesmo existindo
um `docker-compose.yml` na raiz (3 nós MongoDB), ele não é usado aqui. O dev
local sobe um `MongoMemoryReplSet` efêmero por processo (ver
`scripts/dev-run.mjs`) — cada restart apaga os dados; use `pnpm dev:seed`
depois de subir para recriar academia/admin/preset FPJ/evento de exemplo com
atletas de teste (ver `scripts/dev-seed.mjs`).

```bash
# Dev — sobe mongo in-memory + server + web do produto escolhido
pnpm dev:arena   # @arena/server :3001 + @arena/web :3000
pnpm dev:dojo    # @dojo/server :3101 + @dojo/web :3100

# Seed de desenvolvimento (idempotente, só localhost)
pnpm dev:seed

# Typecheck / test / build — cobrem todos os pacotes via turbo
pnpm typecheck
pnpm test
pnpm build
pnpm lint

# Empacotar o Electron de um produto
pnpm package:dojo
pnpm package:arena

# Health check (com o server do produto rodando)
curl http://localhost:3001/api/health   # arena
curl http://localhost:3101/api/health   # dojo
```
