#!/usr/bin/env bash
# Injetado automaticamente no início de cada sessão via SessionStart hook.
# Detecta fases pelo sistema de arquivos — nunca precisa de edição manual.
set -euo pipefail

# ── Detecção de fases ──────────────────────────────────────────────────────────
exists_any() { for f in "$@"; do [ -f "$f" ] && return 0; done; return 1; }

P0="✅"
P05="✅"

exists_any \
  packages/server/src/repositories/UserModel.ts \
  packages/server/src/routes/auth.ts \
  && P1="✅" || P1="—"

exists_any \
  packages/server/src/repositories/AthleteModel.ts \
  && P2="✅" || P2="—"

exists_any \
  packages/server/src/repositories/EventModel.ts \
  && P3A="✅" || P3A="—"

exists_any \
  packages/server/src/domain/bracket/EliminationEngine.ts \
  && P3B="✅" || P3B="—"

exists_any \
  packages/server/src/routes/bracket.ts \
  && P3C="✅" || P3C="—"

exists_any \
  packages/server/src/domain/event/ImportService.ts \
  && P3D="✅" || P3D="—"

exists_any \
  packages/server/src/domain/scoreboard/ScoreboardService.ts \
  && P4="✅" || P4="—"

exists_any \
  packages/server/src/domain/checkin/CheckInService.ts \
  && P5="✅" || P5="—"

exists_any \
  packages/web/app/sw.ts \
  packages/web/public/sw.js \
  && P6="✅" || P6="—"

exists_any \
  packages/server/src/cluster/ClusterManager.ts \
  && P7="✅" || P7="—"

# Marca "🔄 próxima" na primeira fase incompleta
NEXT_MARKED=false
for VAR in P1 P2 P3A P3B P3C P3D P4 P5 P6 P7; do
  if [ "${!VAR}" = "—" ] && [ "$NEXT_MARKED" = false ]; then
    eval "$VAR='🔄 próxima'"
    NEXT_MARKED=true
  fi
done

# ── Descoberta dinâmica de arquivos ───────────────────────────────────────────
domain_files=$(find packages/shared/src/domain -name "*.ts" 2>/dev/null | sort | \
  sed 's|^|- |')

server_models=$(find packages/server/src -name "*Model.ts" -o -name "*Service.ts" 2>/dev/null | \
  sort | sed 's|^|- |')

server_routes=$(find packages/server/src/routes -name "*.ts" 2>/dev/null | \
  sort | sed 's|^|- |')

# Número de itens implementados para feedback rápido
n_models=$(find packages/server/src -name "*Model.ts" 2>/dev/null | wc -l | tr -d ' ')
n_routes=$(find packages/server/src/routes -name "*.ts" 2>/dev/null | wc -l | tr -d ' ')
n_tests=$(find packages -name "*.test.ts" -o -name "*.spec.ts" 2>/dev/null | wc -l | tr -d ' ')

# ── Monta contexto ────────────────────────────────────────────────────────────
CONTEXT="## Sensei Hub — Estado da Sessão

**Models:** ${n_models} | **Rotas:** ${n_routes} | **Testes:** ${n_tests}

### Pacotes

| Pacote | Caminho | Responsabilidade |
|--------|---------|-----------------|
| @sensei-hub/shared | packages/shared/src/ | Schemas Zod + tipos TypeScript |
| @sensei-hub/server | packages/server/src/ | API Fastify 5, Mongoose, serviços |
| @sensei-hub/web | packages/web/app/ | Next.js 15 App Router, UI |
| @sensei-hub/app | packages/app/src/ | Electron: supervisor + kiosk |

### Arquivos de domínio compartilhados
${domain_files:-nenhum ainda}

### Models e Services no servidor
${server_models:-nenhum ainda}

### Rotas HTTP registradas
${server_routes:-nenhum ainda}

### Arquivos-chave fixos
- packages/server/src/config/env.ts — env vars validadas com Zod
- packages/server/src/config/database.ts — connectDatabase(), isDatabaseConnected()
- packages/app/src/supervisor.ts — Supervisor class (mongod + RS init + health loop + restart lock)
- packages/app/src/kiosk.ts — BrowserWindow kiosk

### Convenções
- Datas civis: YYYY-MM-DD | Timestamps: ISO 8601 UTC | IDs: string (ObjectId serializado)
- writeConcern: { w: 'majority' } em todas as escritas
- Mongoose: select: false em passwordHash, dados médicos

### Fases
- Fase 0  ${P0}  — Monorepo, shared types, server stub, Electron, Docker RS
- Fase 0.5 ${P05} — Bugs supervisor, discriminated union bracket, DTOs separados
- Fase 1  ${P1}  — Auth + RBAC + first-run setup
- Fase 2  ${P2}  — Atleta CRUD + Guardian + Belt/Weight records
- Fase 3A ${P3A} — Evento + Divisões + Inscrições
- Fase 3B ${P3B} — Bracket engine puro + testes
- Fase 3C ${P3C} — Persistência de bracket + match results
- Fase 3D ${P3D} — Import Excel
- Fase 4  ${P4}  — Scoreboard + WebSocket
- Fase 5  ${P5}  — Check-in + Weigh-in
- Fase 6  ${P6}  — PWA + Offline
- Fase 7  ${P7}  — ClusterManager mDNS + RS dinâmico"

# ── Saída JSON ────────────────────────────────────────────────────────────────
python3 -c "
import json, sys
ctx = sys.stdin.read()
print(json.dumps({
    'hookSpecificOutput': {
        'hookEventName': 'SessionStart',
        'additionalContext': ctx
    }
}))
" <<< "$CONTEXT"
