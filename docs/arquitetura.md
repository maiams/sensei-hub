# Plano de Arquitetura — Sensei Hub

## Contexto

O Sensei Hub é uma plataforma local-first para academias de judô gerenciarem atletas, aulas, check-in, pesagem e competições com chaves de luta. O sistema precisa operar em hardware limitado (Celeron/i3, 4GB RAM), em redes locais de ginásio (WiFi instável), e sobreviver à falha de qualquer nó.

**Modelo de operação:** cada laptop rodando o Sensei Hub é simultaneamente cliente (browser) e servidor (API + banco de dados). Um nó é eleito primary; os demais são secondary. Se o primary cair, um secondary é eleito automaticamente. O cluster suporta N nós — qualquer número de laptops pode entrar ou sair.

---

## Stack Técnica

| Camada | Tecnologia | Versão | Justificativa |
|--------|-----------|--------|---------------|
| Runtime | Node.js | **24 LTS** | Active LTS (jun/2026), suporte até abril 2028; Node 26 é "Current", não LTS ainda |
| Linguagem | TypeScript | 5.x | Tipagem forte para dados críticos de competição |
| Backend | Fastify | 5.x | 2× mais rápido que Express, startup < 100ms em Celeron |
| Banco de dados | MongoDB | 7.x | Replica set nativo com eleição automática de primary |
| ODM | Mongoose | 8.x | Schema validation + tipos TypeScript |
| Frontend | Next.js | 15 (App Router) | SSR para carga inicial rápida + suporte a PWA |
| UI | shadcn/ui + Tailwind CSS | latest | Mobile-first, componentes acessíveis |
| Real-time | WebSocket (`@fastify/websocket`) | — | Scoreboard push < 500ms |
| Auth | JWT access (15min) + refresh (7d) | — | Stateless, funciona com N nós sem sessão centralizada |
| Validação | Zod | 3.x | Runtime + inferência TypeScript |
| Service discovery | `mdns-js` | — | Nós se descobrem automaticamente via mDNS/Bonjour |
| Testes | Vitest + Supertest | — | Integrado ao TypeScript, sem config extra |
| Shell | Electron | 32.x | Supervisor de processos + browser embutido em kiosk mode |
| Monorepo | pnpm workspaces + Turborepo | — | Build paralelo, cache de artefatos |

---

## Arquitetura: Cluster Dinâmico de N Nós

### Modelo

Cada laptop roda três processos gerenciados pelo **Electron**:
1. **MongoDB** — nó do replica set (porta 27017)
2. **Node.js / Fastify** — API + WebSocket + serve o Next.js (porta 3000)
3. **Electron (main process)** — supervisor + browser embutido (kiosk)

O Electron inicia os dois primeiros como child processes e abre a `BrowserWindow` apontando para `localhost:3000`. Tablets e phones externos conectam via browser normal ao IP do laptop.

### Electron: Supervisor de Processos

O processo main do Electron (`packages/app/src/main.ts`) é responsável por:

**Inicialização ordenada:**
```
1. Electron inicia
2. Spawna MongoDB como child_process (aguarda porta 27017 responder)
3. Spawna Fastify como child_process (aguarda GET /api/health → 200)
4. ClusterManager conecta ao replica set
5. Abre BrowserWindow em kiosk fullscreen → localhost:3000
```

**Health check contínuo (a cada 5s):**
```
GET /api/health → 200 OK?
  NÃO (3 falhas consecutivas):
    → Flush de pendências (POST /api/flush-pending)
    → Encerra processo Fastify
    → Aguarda 2s
    → Reinicia Fastify
    → Log: { timestamp, reason: 'health_check_failed', restartCount }

MongoDB ping → OK?
  NÃO:
    → Aguarda 5s (pode ser transiente)
    → Ping de novo
    → Se falhar: reinicia MongoDB
    → Aguarda MongoDB responder antes de reiniciar Fastify
```

**Shutdown gracioso (fechar app ou Ctrl+C):**
```
1. Fastify: POST /api/shutdown-prep → drena writes pendentes
2. ClusterManager: rs.stepDown() se for primary
3. MongoDB: mongod --shutdown
4. Electron fecha
```

### Electron: Browser Embutido (Kiosk)

```typescript
new BrowserWindow({
  fullscreen: true,
  kiosk: true,               // F11 e ESC não saem do fullscreen
  autoHideMenuBar: true,
  webPreferences: {
    spellcheck: false,
    enableWebSQL: false,
    // Sem plugins, sem extensões
  }
})

// Desabilitar atalhos que expõem o browser
win.webContents.on('before-input-event', (event, input) => {
  const blocked = ['F12', 'ctrl+shift+i', 'ctrl+r', 'ctrl+l', 'alt+F4']
  if (blocked.includes(input.key)) event.preventDefault()
})

// Impedir navegação para fora do localhost
win.webContents.on('will-navigate', (event, url) => {
  if (!url.startsWith('http://localhost:3000')) event.preventDefault()
})
```

**O que fica desabilitado por padrão no kiosk Electron:**
- Barra de endereço (não existe)
- Salvar senhas (Chrome prompts não aparecem)
- Tradução automática
- Extensões e plugins
- DevTools (bloqueado via input-event)
- Navegação para fora do app

**Saída de emergência (para manutenção):**
Sequência de tecla configurável (ex: `Ctrl+Alt+Shift+Q`) que exibe um prompt de senha de admin antes de sair do kiosk. Registrado no audit log.

```
Laptop A (primary)              Laptop B (secondary)         Laptop C (secondary)
┌──────────────────────┐       ┌──────────────────────┐      ┌──────────────────────┐
│ MongoDB primary      │◄─────►│ MongoDB secondary    │◄────►│ MongoDB secondary    │
│ Fastify + WS         │       │ Fastify + WS         │      │ Fastify + WS         │
│ Next.js              │       │ Next.js              │      │ Next.js              │
│ mDNS advertise       │       │ mDNS advertise       │      │ mDNS advertise       │
│ ClusterManager       │       │ ClusterManager       │      │ ClusterManager       │
│ Browser → localhost  │       │ Browser → localhost  │      │ Browser → localhost  │
└──────────────────────┘       └──────────────────────┘      └──────────────────────┘
         ▲                              ▲                              ▲
         │         WiFi local           │                              │
         ▼                              ▼                              ▼
┌──────────────────────────────────────────────────────────────────────────────────┐
│  Tablets / Phones / Displays — PWA browser                                      │
│  Armazena lista de nós conhecidos, conecta ao primeiro disponível               │
└──────────────────────────────────────────────────────────────────────────────────┘
```

### ClusterManager — Gestão Dinâmica do Replica Set

Serviço Node.js (`src/cluster/ClusterManager.ts`) que roda junto com a API:

**Startup de um novo nó:**
```
1. Anuncia presença via mDNS: _senseihub._tcp.local (hostname único: senseihub-<machineid>.local)
2. Aguarda 3s para descobrir outros nós na rede
3a. SE nenhum nó encontrado → inicia como primary: rs.initiate()
      → Passa a anunciar também o alias senseihub.local (hostname canônico do primary)
3b. SE cluster existente encontrado → pede ao primary para adicioná-lo: POST /api/cluster/join
4. Primary chama rs.add({ host: newNode, priority: 0.5 }) via mongosh/driver
5. MongoDB sincroniza os dados automaticamente (initial sync)
```

**Shutdown gracioso de um nó:**
```
1. Se for secondary: rs.remove(self) → saída limpa
2. Se for primary: rs.stepDown() → força nova eleição antes de sair
3. Avisa os peers via mDNS "goodbye" packet
```

**Failover automático (crash):**
```
MongoDB detecta nó indisponível após heartbeat timeout (~10s)
→ Elege novo primary entre os secundários ativos (maioria dos votos)
→ Novo primary assume anúncio mDNS de senseihub.local
→ Clientes (telefones/tablets) reconectam automaticamente — senseihub.local agora aponta para novo IP
→ Clientes Node.js reconectam ao novo primary via connection string multi-host
→ Sem intervenção manual necessária (N >= 3)
```

### Quorum e N de Nós

| N de laptops | Comportamento |
|:---:|---|
| 1 | Single node RS. Sem failover mas funciona completamente. Recomendado para treinamentos. |
| 2 | RS de 2 data nodes + arbiter automático (processo leve no nó que iniciou o cluster). Failover funciona. |
| 3+ | RS padrão com eleição por maioria. Failover robusto. Recomendado para competições. |
| 5+ | Adiciona resiliência extra. MongoDB suporta até 50 membros. |

**Arbiter automático para N=2:** O `ClusterManager` detecta que só há 2 nós e inicia automaticamente um processo MongoDB `--arbiter` no primary (sem dados, apenas voto). Isso garante quorum 2/3 mesmo com apenas 2 laptops.

### Strings de Conexão

Todos os clientes Node.js usam:
```
mongodb://host1:27017,host2:27017,host3:27017/?replicaSet=sensei-rs&readPreference=primaryPreferred
```
O driver MongoDB reconecta automaticamente ao novo primary após eleição. Zero intervenção.

### RAM por Nó (hardware mínimo 4GB)

| Processo | RAM estimada |
|----------|:-----------:|
| MongoDB 7 (`cacheSizeGB: 0.5`) | ~600MB |
| Node.js 24 + Fastify + Next.js | ~250MB |
| Electron (main process) | ~80MB |
| OS | ~500MB |
| Browser (localhost) | ~400MB |
| Chromium embutido (Electron renderer) | ~300MB |
| **Total** | **~1.73GB** |
| **Livre** | **~2.27GB** |

---

## Real-time: MongoDB Change Streams + WebSocket

```
Operador altera scoreboard
→ Fastify grava no MongoDB primary
→ MongoDB oplog replica para todos os secondaries (~50ms)
→ Todos os Node.js watchers recebem o Change Stream event
→ Cada Node.js faz broadcast via WebSocket para seus clientes conectados
→ Latência total: < 500ms (local network)
```

Cada nó escuta seu próprio Change Stream local — sem HTTP entre nós para real-time. A sincronização passa pelo MongoDB, não pela aplicação.

---

## Estrutura do Monorepo

```
sensei-hub/
├── packages/
│   ├── app/                       # Electron (supervisor + kiosk browser)
│   │   └── src/
│   │       ├── main.ts            # Main process: spawna MongoDB + Fastify, health check
│   │       ├── supervisor.ts      # Health check loop + restart logic
│   │       ├── kiosk.ts           # BrowserWindow config + input blocking
│   │       └── shutdown.ts        # Graceful shutdown sequence
│   ├── server/                    # Fastify 5 API + WebSocket
│   │   └── src/
│   │       ├── cluster/           # ClusterManager (mDNS + RS management)
│   │       ├── config/            # MongoDB, JWT, env
│   │       ├── domain/
│   │       │   ├── athlete/
│   │       │   ├── event/
│   │       │   ├── bracket/       # BracketEngine (Rodízio + Chave-N + Repescagem)
│   │       │   ├── match/
│   │       │   ├── scoreboard/
│   │       │   ├── checkin/
│   │       │   └── weighin/
│   │       ├── routes/
│   │       ├── services/
│   │       ├── repositories/      # Mongoose models
│   │       ├── websocket/
│   │       ├── middleware/        # Auth, RBAC, AuditLog
│   │       └── adapters/          # ScaleAdapter, CheckInDeviceAdapter
│   ├── web/                       # Next.js 15 PWA
│   │   └── app/
│   │       ├── (auth)/
│   │       ├── admin/
│   │       ├── check-in/
│   │       ├── weigh-in/
│   │       ├── event/[id]/
│   │       │   ├── bracket/
│   │       │   └── matches/
│   │       └── scoreboard/[id]/   # URL pública sem auth
│   └── shared/                    # Tipos TypeScript + Zod schemas
├── scripts/
│   ├── bootstrap.sh               # Instala Node 22, MongoDB 7, pnpm
│   └── start-node.sh              # Inicia MongoDB + Fastify num laptop
├── docs/
│   └── zempo-modelos/             # ← referência de bracket (já existente)
├── docker-compose.yml             # Dev: 3 MongoDB instances
├── turbo.json
└── package.json
```

---

## Modelo de Dados (MongoDB Collections)

### Multi-academia

O sistema suporta múltiplas academias/agremiações na mesma instalação. Um `Event` é organizado por uma academia anfitriã (`hostAcademyId`) mas pode receber atletas de qualquer academia cadastrada. Atletas de academias externas podem ser cadastrados como `scope: 'event-only'` (perfil mínimo, sem persistência permanente) ou `scope: 'academy'` (perfil completo com histórico).

### Fluxo de inscrição em campeonato

**Pré-evento:**
```
Organizador distribui template Excel (.xlsx) para cada academia participante
→ Academia preenche: nome, academia/agremiação, data nascimento, faixa, peso declarado, categoria
→ Envia arquivo para o organizador
→ Organizador importa o Excel no sistema (tela de importação do evento)
→ Sistema valida cada linha (campos obrigatórios, categoria calculada por peso+idade)
→ Exibe preview com erros/alertas antes de confirmar
→ Confirma → cria Athletes (event-only) + EventEntries em lote
→ Atletas com dados incompletos ficam em status 'incomplete' para correção manual
```

**Dia do evento:**
```
Atleta chega → check-in (confirma presença)
→ Pesagem → WeighIn registra peso real
→ Se peso real ≠ categoria declarada → sistema alerta e oferece reclassificação
→ Organizador confirma categoria final
→ EventEntry.status → 'confirmed'
→ Bracket gerado apenas com atletas status 'confirmed'
→ Atletas ausentes ficam 'checked-in' mas não são incluídos no bracket
```

O template Excel tem colunas fixas definidas pelo sistema. Academias não inventam colunas — preenchem o template fornecido.

### Coleções principais

| Collection | Índices críticos |
|-----------|-----------------|
| `academies` | `{ slug: 1 }` unique |
| `users` | `{ email: 1 }` unique, `{ academyId: 1, role: 1 }` |
| `athletes` | `{ academyId: 1, scope: 1, status: 1 }`, `{ cpf: 1 }` sparse |
| `beltRecords` | `{ athleteId: 1, grantedAt: -1 }` |
| `weightRecords` | `{ athleteId: 1, eventId: 1 }`, `{ eventId: 1, recordedAt: -1 }` |
| `classes` | `{ academyId: 1 }` |
| `attendances` | `{ athleteId: 1, targetId: 1 }` unique (duplicate prevention) |
| `events` | `{ hostAcademyId: 1, eventDate: -1 }` |
| `divisions` | `{ eventId: 1 }` |
| **`eventEntries`** | `{ eventId: 1, athleteId: 1 }` unique, `{ divisionId: 1, status: 1 }` |
| **`importJobs`** | `{ eventId: 1, createdAt: -1 }` |
| `brackets` | `{ divisionId: 1 }` unique |
| `matches` | `{ bracketId: 1, matchNumber: 1 }` unique |
| `scoreboards` | `{ matchId: 1 }` unique |
| `results` | `{ athleteId: 1, divisionId: 1 }` unique |
| `auditLogs` | `{ entityType: 1, entityId: 1, timestamp: -1 }` |
| `sessions` | `{ token: 1 }`, TTL index em `expiresAt` |

### Documentos-chave adicionais

```typescript
// athletes — campo scope adicionado
{
  scope: 'academy' | 'event-only',
  eventOnlyEventId?: ObjectId,  // se event-only, qual evento originou
  academyId: ObjectId,          // academia que representa
  name: string,
  birthDate: Date,
  // demais campos opcionais conforme requiredFields do evento
}

// eventEntries — inscrição de atleta em divisão do evento
{
  eventId: ObjectId,
  divisionId: ObjectId,           // categoria declarada na inscrição
  confirmedDivisionId?: ObjectId, // categoria confirmada após pesagem (pode diferir)
  athleteId: ObjectId,
  academyId: ObjectId,
  registrationMethod: 'import' | 'manual',
  importJobId?: ObjectId,
  status: 'incomplete'            // dados faltando, requer correção
         | 'registered'           // inscrito, aguardando check-in
         | 'checked-in'           // presente no evento
         | 'weighed-in'           // pesado, categoria pendente de confirmação
         | 'confirmed'            // categoria confirmada, apto para bracket
         | 'withdrawn',           // retirado
  declaredWeight?: number,        // peso informado na inscrição
  confirmedWeight?: number,       // peso medido na pesagem
  weightUnit: 'kg',
  notes?: string
}

// importJobs — registro de cada importação de Excel
{
  eventId: ObjectId,
  filename: string,
  importedBy: ObjectId,
  importedAt: Date,
  totalRows: number,
  successCount: number,
  errorCount: number,
  errors: [{ row: number, field: string, message: string }]
}

// events — hostAcademyId e sem self-registration
{
  hostAcademyId: ObjectId,
  name: string,
  eventDate: Date,
  venue: string,
  status: 'draft' | 'registration' | 'in-progress' | 'completed'
}
```

### Bracket como documento BSON (natural no MongoDB)

```typescript
// brackets collection
{
  divisionId: ObjectId,
  format: 'elimination' | 'roundRobin',
  size: 8 | 16 | 32 | 64 | 128 | 3 | 4 | 5 | 6,
  repechageType: 'none' | 'simple' | 'quarterFinal' | 'semiFinal' | 'finalist',
  athletes: [{ position: number, athleteId: ObjectId, seed: number, bye: boolean }],
  generatedAt: Date,
  generatedBy: ObjectId,
  version: number  // optimistic locking
}

// matches collection (separado para query individual)
{
  bracketId: ObjectId,
  divisionId: ObjectId,
  matchNumber: number,
  phase: 'R1' | 'QF' | 'SF' | 'F' | 'Bronze' | 'Rep',
  athleteAId: ObjectId | null,  // null = TBD (aguardando resultado anterior)
  athleteBId: ObjectId | null,
  state: 'pending' | 'ready' | 'inProgress' | 'completed' | 'bye' | 'walkover',
  winnerId: ObjectId | null,
  nextMatchNumber: number | null,  // onde o vencedor avança
  repNextMatchNumber: number | null  // onde o perdedor vai (se repescagem)
}
```

---

## Lógica de Bracket

Encapsulada em `packages/server/src/domain/bracket/`, com base nos docs de `docs/zempo-modelos/`:

```typescript
interface BracketEngine {
  generate(athletes: Athlete[], config: BracketConfig): BracketState
  getMatchesReady(bracket: BracketState, matches: Match[]): Match[]
  advanceMatch(bracket: BracketState, result: MatchResult): { updatedMatches: Match[], repechageMatches: Match[] }
  calculateRepechage(bracket: BracketState, type: RepechageType, completedRound: Match[]): Match[]
  getFinalRankings(bracket: BracketState, matches: Match[]): AthleteRanking[]
}
```

- `RodizioEngine` e `EliminationEngine` implementam `BracketEngine`
- Repescagem calculada **progressivamente** após cada resultado — não pré-gerada
- Todas as funções são **puras** (testáveis sem banco, sem I/O)
- Referência: `docs/zempo-modelos/rodizio.md`, `chave-eliminacao.md`, `repescagem.md`

---

## RBAC Server-Side

```
super_admin > academy_admin > event_manager > coach > staff >
weigh_in_operator > scoreboard_operator > athlete > guardian
```

- `scoreboard/:id` público (sem auth) — nunca expõe controles administrativos
- Dados de saúde: somente `coach` e acima
- Dados de atleta menor: somente guardian vinculado + acima de `staff`
- Correção de resultado: somente `event_manager` e acima, campo `reason` obrigatório

---

## Audit Log

Middleware automático intercepta toda mutação:
```typescript
{ userId, entityType, entityId, action, fieldName, oldValue, newValue, timestamp, sessionId, reason? }
```

---

## PWA + Offline

- **Service Worker** (via Serwist) cacheia: lista de atletas, estrutura do evento, bracket atual
- **Writes offline**: fila em IndexedDB → sincroniza ao reconectar
- **Check-in offline**: valida contra cache local, queued para sync posterior
- **Scoreboard**: não funciona offline (requer WebSocket) — exibe mensagem clara
- **Node discovery**: clientes navegam para `http://senseihub.local:3000` — hostname `.local` resolvido via mDNS nativamente em iOS, Android, Windows, macOS e Linux sem nenhuma configuração. Fallback: QR code exibido permanentemente no kiosk Electron com URL de IP direto.

---

## Distribuição e Empacotamento

### Formato do pacote

O Sensei Hub é distribuído como **instalador único por plataforma** contendo tudo — sem dependências externas na máquina do usuário:

| Plataforma | Formato | Conteúdo |
|-----------|---------|----------|
| Windows | `.exe` (NSIS installer) | Electron + Chromium + Node.js + Fastify + Next.js + `mongod.exe` |
| macOS | `.dmg` → `.app` | Idem + `mongod` para macOS |
| Linux | `.AppImage` | Idem + `mongod` para Linux |

### Como os componentes são empacotados

- **Electron** já inclui Node.js — o Fastify roda direto no processo main do Electron sem nenhuma instalação de Node.js na máquina do usuário
- **`mongod` binário** incluído em `resources/mongodb/<platform>/mongod[.exe]` via `extraResources` no electron-builder
- **Next.js** compilado como output estático (`next build`), servido pelo Fastify
- **Dados MongoDB** armazenados fora do pacote em `%APPDATA%/SenseiHub/data` (Windows) ou `~/Library/Application Support/SenseiHub/data` (macOS/Linux) — sobrevivem a atualizações

### Ferramenta de build: electron-builder

```json
{
  "build": {
    "appId": "com.senseihub.app",
    "productName": "Sensei Hub",
    "extraResources": [
      { "from": "resources/mongodb/${platform}-${arch}", "to": "mongodb" }
    ],
    "win": { "target": "nsis" },
    "mac": { "target": "dmg" },
    "linux": { "target": "AppImage" }
  }
}
```

### Tamanho estimado por instalador

| Componente | Tamanho |
|-----------|:-------:|
| Electron (Chromium + Node.js) | ~130MB |
| Next.js build + Fastify + deps | ~70MB |
| `mongod` binary (por plataforma) | ~100MB |
| **Total instalado** | **~300MB** |

Comparável ao VSCode (~150MB instalado) ou Slack (~300MB).

### Atualizações

`electron-updater` verifica atualizações ao iniciar. Se disponível, o usuário aceita, o instalador baixa e substitui o app — os dados MongoDB em `AppData` ficam intactos.

---

## Fases de Desenvolvimento

### Fase 0 — Infraestrutura + Electron shell (2-3 dias)
- [ ] Monorepo pnpm + Turborepo
- [ ] TypeScript config compartilhado
- [ ] Docker Compose (dev: 3 MongoDB nodes formando RS automaticamente)
- [ ] Script `bootstrap.sh` (instala Node 24 LTS, MongoDB 7, pnpm em um laptop limpo)
- [ ] Pacote `shared` com todos os tipos de domínio e schemas Zod
- [ ] Pacote `app` (Electron): spawn de MongoDB + Fastify como child processes
- [ ] Health check loop (ping /api/health a cada 5s, restart após 3 falhas)
- [ ] BrowserWindow em kiosk fullscreen, bloqueio de atalhos e navegação externa
- [ ] Shutdown gracioso (flush → stepDown → mongod shutdown)
- [ ] Saída de emergência protegida por senha de admin

### Fase 1 — Auth + RBAC (2-3 dias)
- [ ] User model + registro
- [ ] JWT (access 15min + refresh 7d em MongoDB com TTL index)
- [ ] Middleware RBAC
- [ ] Academy CRUD
- [ ] Audit log middleware automático

### Fase 2 — Atleta (3-4 dias)
- [ ] Athlete CRUD completo (campos de `docs/campos-cadastro-atleta.md`)
- [ ] Guardian (obrigatório para menores de 18)
- [ ] Belt records
- [ ] Weight records com correção + audit trail
- [ ] Cálculo automático: classe etária (data de nascimento) + categoria de peso

### Fase 3 — Evento + Inscrição via Excel + Chave (7-10 dias)
- [ ] Event + Division CRUD (`hostAcademyId`, status do evento)
- [ ] Template Excel para download (colunas fixas definidas pelo sistema)
- [ ] Import de Excel: parse `.xlsx`, validação por linha, preview com erros, criação em lote de Athletes (event-only) + EventEntries
- [ ] `importJobs` com relatório de erros por linha
- [ ] Cadastro manual individual de atleta no dia (complemento ao import)
- [ ] `EventEntry` lifecycle: `incomplete → registered → checked-in → weighed-in → confirmed | withdrawn`
- [ ] Tela de gestão de inscrições por divisão (filtro por status, busca, reclassificação de categoria)
- [ ] Suporte a múltiplas academias por evento (mesma chave pode ter atletas de N agremiações)
- [ ] `RodizioEngine` (3-6 atletas, ordem de lutas conforme `docs/`)
- [ ] `EliminationEngine` (8-128 atletas, seeding, byes, mesmo-clube separation)
- [ ] 5 tipos de repescagem com cálculo progressivo
- [ ] Match management: registro de resultado → avanço automático
- [ ] Testes unitários extensivos (bracket é lógica crítica)

### Fase 4 — Scoreboard (2-3 dias)
- [ ] WebSocket server
- [ ] MongoDB Change Stream → broadcast para todos os clientes WS do nó
- [ ] Estado: timer, osaekomi timer, score, penalidades (shido, hansoku-make)
- [ ] Operator view (autenticado, com controles)
- [ ] Public display view (URL pública, sem auth, sem controles)
- [ ] Persistência a cada 2s para sobreviver a crash/reload

### Fase 5 — Check-in + Weigh-in (2-3 dias)
- [ ] Check-in: QR code, código curto, busca por nome/CPF/telefone
- [ ] Duplicate prevention (índice único `athleteId + targetId`)
- [ ] Weigh-in: manual com validação de categoria + alerta de flag médica
- [ ] `ScaleAdapter` interface com mock para dev e testes

### Fase 6 — PWA + Offline (2-3 dias)
- [ ] Service Worker com Serwist
- [ ] Cache de atletas + bracket em IndexedDB
- [ ] Background sync para writes offline
- [ ] UI de status: ícone de conexão, "N registros pendentes de sync"

### Fase 7 — Cluster Dinâmico (3-4 dias)
- [ ] `ClusterManager` com mDNS discovery
- [ ] Lógica de bootstrap: inicia RS ou entra em RS existente
- [ ] Arbiter automático para N=2
- [ ] Endpoint `GET /api/cluster/status` (lista nós, qual é primary)
- [ ] UI: painel de status do cluster na tela de admin
- [ ] Teste de failover documentado e automatizado

---

## Verificação

### Testes automatizados
```bash
pnpm test                   # unit + integration
pnpm --filter server test:bracket  # lógica de chave isolada
pnpm test:e2e               # fluxo completo: check-in → pesagem → chave → resultado
```

### Teste de failover (manual, repetível)
```bash
# Ambiente: docker-compose com 3 nós
docker-compose up
# Criar evento, registrar atletas, gerar bracket
docker stop sensei-mongo-1   # derruba primary
# Verificar: UI mostra "nó 1 offline, reconectando"
# Verificar: eleição concluída em ~10s, UI retoma normal
# Registrar resultado de luta no novo primary
# Verificar: resultado persistiu
docker start sensei-mongo-1  # reintegra
# Verificar: nó 1 volta como secondary, dados sincronizam
```

### Teste de scoreboard real-time
1. Abrir `/scoreboard/:id` em segundo dispositivo (ou tab) como public display
2. Operador adiciona ponto no operator view
3. Verificar: public display atualiza em < 1s

### Teste offline (check-in)
1. Desligar WiFi no tablet de check-in
2. Fazer check-in de atleta (deve funcionar com cache)
3. Reconectar
4. Verificar: check-in apareceu no servidor e no audit log

---

## Garantias do Cluster

### N=1 (laptop único)
- RS com 1 membro funciona completamente — sem failover, mas sem limitação funcional
- Recomendado para treinos e eventos pequenos
- Quando um segundo laptop entrar na rede, o `ClusterManager` o adiciona ao RS automaticamente sem reiniciar

### Split-brain (impossibilidade matemática)
O protocolo Raft garante que no máximo **um nó pode ser primary** em qualquer momento:
- Um nó só aceita o papel de primary após receber votos de **maioria estrita** (floor(N/2)+1)
- Uma maioria não pode existir em dois lados de uma partição simultaneamente
- `writeConcern: "majority"` em todas as escritas críticas — write só é confirmado após a maioria gravar; crash do primary não perde dados que já foram confirmados

### Comportamento por cenário de partição de rede

| Cenário | Resultado |
|---------|-----------|
| N=3, 1 nó isolado | Os 2 nós conectados elegem novo primary. Nó isolado aguarda como secondary. |
| N=3, partição 2+1 | O lado com 2 nós tem maioria → elege primary. O nó isolado não pode eleger. |
| N=2 sem arbiter, rede cai | Nenhum dos dois tem maioria → ambos recusam writes. **Sem split-brain, mas sem primary.** |
| N=2 com arbiter automático | Arbiter no nó sobrevivente completa quorum 2/3 → eleição normal. |
| Janela de eleição (~10s) | Writes recusados até nova eleição concluir. Reads de secondaries continuam disponíveis. |

---

## Riscos e Mitigações

| Risco | Mitigação |
|-------|-----------|
| MongoDB usa mais RAM que SQLite | `cacheSizeGB: 0.5` → ~600MB por nó; total ~1.75GB, ok em 4GB |
| N=2 sem quorum suficiente | Arbiter automático iniciado pelo ClusterManager |
| Split-brain (rede particionada) | MongoDB garante apenas 1 primary via quorum; minority não aceita writes |
| Scoreboard offline | Aceito por design; exibe mensagem clara; dados persistem no MongoDB |
| PWA/iOS limitações de Service Worker | Testar em Safari iOS cedo; fallback para polling |
| Lógica de repescagem complexa | Engines puras com 100% de cobertura de testes antes da UI |
| mDNS bloqueado em alguns roteadores WiFi | Fallback: QR code permanente no kiosk Electron com URL de IP direto. Para roteadores corporativos, configurar encaminhamento de multicast mDNS (IGMP snooping). |
