import type { UserRole } from '@sensei-hub/shared'

// Authenticated request context passed from routes into services — carries
// everything the audit trail needs (who, from which academy, which session).
//
// stationId/clientSeq/occurredAt are populated only for requests that came
// through a client-side durable queue (see apps/arena/web/src/lib/
// offlineQueue.ts) — a write made on an area-station notebook while offline
// and replayed once connectivity returns. They answer, respectively: which
// physical station originated this, this station's own monotonic sequence
// number (never wall-clock — station clocks are not trusted, see
// docs/status-e-plano.md resilience notes), and when the operator says it
// actually happened (client wall clock, informational only — never used to
// order or gate anything, only to annotate the audit trail). All three are
// optional: a normal, always-online request simply omits them.
export interface AuthCtx {
  userId: string
  academyId: string
  role: UserRole
  sessionId: string
  ip?: string
  stationId?: string
  clientSeq?: number
  occurredAt?: string
}
