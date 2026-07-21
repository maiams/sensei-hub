import { z } from 'zod'

// Fase 7 — Cluster Dinâmico. Multi-node MongoDB replica set formed
// automatically via mDNS discovery on the gym LAN — see
// apps/arena/server/src/cluster/ for the implementation and
// docs/status-e-plano.md for the architecture decisions/trade-offs.

export const ClusterNodeRole = z.enum(['primary', 'secondary', 'arbiter', 'unknown'])
export type ClusterNodeRole = z.infer<typeof ClusterNodeRole>

export const ClusterNodeHealth = z.enum(['healthy', 'lagging', 'unreachable'])
export type ClusterNodeHealth = z.infer<typeof ClusterNodeHealth>

export const ClusterNodeDTO = z.object({
  host: z.string(), // "ip:port" of the member's mongod
  role: ClusterNodeRole,
  health: ClusterNodeHealth,
  isSelf: z.boolean(),
  // null for the primary itself and for arbiters (they don't apply oplog).
  replicationLagSeconds: z.number().nonnegative().nullable(),
})
export type ClusterNodeDTO = z.infer<typeof ClusterNodeDTO>

// GET /api/cluster/status (super_admin+)
export const ClusterStatusDTO = z.object({
  enabled: z.boolean(), // CLUSTER_ENABLED — false means this node runs standalone, everything below is empty/irrelevant
  replicaSetName: z.string().nullable(),
  selfHost: z.string().nullable(),
  nodes: z.array(ClusterNodeDTO),
  hasArbiter: z.boolean(),
  // Exactly 2 data-bearing voting members and no arbiter yet — see
  // domain/cluster/rules.ts computeNeedsArbiter(). The server can only
  // detect this; spawning the extra arbiter mongod process is the
  // Electron Supervisor's job (packages/desktop-runtime), which polls this field.
  needsArbiter: z.boolean(),
})
export type ClusterStatusDTO = z.infer<typeof ClusterStatusDTO>

// POST /api/cluster/join — node-to-node only, authenticated via the
// X-Cluster-Secret header (CLUSTER_SECRET env var), never a user JWT: a
// freshly-installed joining node has no academy/user context to present one.
export const ClusterJoinRequest = z.object({
  mongoHost: z.string(), // this joining node's own LAN-reachable "ip:port" for its mongod
})
export type ClusterJoinRequest = z.infer<typeof ClusterJoinRequest>
