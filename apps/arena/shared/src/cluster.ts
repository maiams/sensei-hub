import { z } from 'zod'

// Fase 8 — Master/Backup declarado. Replaces the old Fase 7 "cluster
// dinâmico" (mDNS peer discovery + automatic bootstrap election + N=2
// arbiter) with the model the product owner asked for explicitly:
//
//   "eu coloco outro computador em algum lugar, e declaro ele em uma tela
//   de gerenciamento como o backup do master. fim."
//
// Three machine roles (see packages/desktop-runtime/src/machineRole.ts):
//   - master: runs its own mongod, is the ONLY voting member (votes:1,
//     priority:1) — it always has a majority of 1 and never stops accepting
//     writes just because the backup is unreachable.
//   - backup: runs its own mongod, added to the SAME replica set as a
//     non-voting member (votes:0, priority:0) — it keeps a live full copy
//     but can never win an election on its own. Promoting it to master is a
//     deliberate, audited, human action (POST /cluster/promote), never
//     automatic.
//   - station (area notebook): no local mongod at all — see
//     apps/arena/server/src/cluster/ClusterManager.ts's module doc comment
//     for why a station's own Fastify server needs no cluster awareness
//     here (it just uses a replicaSet-aware MONGODB_URI seeded with both
//     master and backup; the MongoDB driver's own topology monitoring
//     re-routes writes to whichever one is currently primary — no custom
//     "find the master" protocol needed).
//
// See apps/arena/server/src/cluster/rules.ts for the pure decision logic
// this DTO shape supports.

export const ClusterRole = z.enum(['master', 'backup'])
export type ClusterRole = z.infer<typeof ClusterRole>

// Mirrors MongoDB's own replSetGetStatus stateStr, narrowed to what the UI
// needs to react to. 'unreachable' is this app's own label (health===0 in
// the raw wire protocol), not a native stateStr value.
export const MongoNodeState = z.enum([
  'PRIMARY',
  'SECONDARY',
  'STARTUP',
  'STARTUP2',
  'RECOVERING',
  'ROLLBACK',
  'unreachable',
  'unknown',
])
export type MongoNodeState = z.infer<typeof MongoNodeState>

export const ClusterNodeDTO = z.object({
  host: z.string(), // "ip:port" of this member's mongod
  role: ClusterRole, // DECLARED role — derived from the replica set config's votes, not from who's currently primary
  mongoState: MongoNodeState, // current, informational — what Mongo itself reports right now
  isSelf: z.boolean(),
  // null for the master while it's healthy (nothing to lag behind), and for
  // any member reported unreachable (no optime to compare).
  replicationLagSeconds: z.number().nonnegative().nullable(),
})
export type ClusterNodeDTO = z.infer<typeof ClusterNodeDTO>

export const StationStatusDTO = z.object({
  stationId: z.string(),
  lastSeenAt: z.string().datetime(),
  online: z.boolean(), // lastSeenAt within the last STATION_ONLINE_THRESHOLD_MS
})
export type StationStatusDTO = z.infer<typeof StationStatusDTO>

// GET /api/cluster/status (event_manager+)
export const ClusterStatusDTO = z.object({
  enabled: z.boolean(), // false on a plain standalone install/station — everything below is empty
  replicaSetName: z.string().nullable(),
  selfHost: z.string().nullable(),
  selfRole: ClusterRole.nullable(), // this node's OWN declared role, when this node is master or backup
  master: ClusterNodeDTO.nullable(),
  backup: ClusterNodeDTO.nullable(), // null until a backup has been declared
  stations: z.array(StationStatusDTO),
})
export type ClusterStatusDTO = z.infer<typeof ClusterStatusDTO>

// POST /api/cluster/backup — master-only action: adds a reachable mongod as
// the (non-voting) backup. `mongoHost` is the backup machine's own
// "ip:port" for ITS mongod, LAN-reachable from the master.
export const DeclareBackupInput = z.object({
  mongoHost: z.string().min(1),
})
export type DeclareBackupInput = z.infer<typeof DeclareBackupInput>

// POST /api/cluster/promote — run FROM THE BACKUP NODE (the master may well
// be the machine that just died — this is the disaster-recovery action).
// `confirm: true` is required so this can never fire from a stray click;
// `acknowledgeSplitBrainRisk` is the explicit override for the rare case
// where the safety check (old master still answering as primary) is itself
// wrong — see ClusterManager.promote()'s doc comment.
export const PromoteBackupInput = z.object({
  confirm: z.literal(true),
  acknowledgeSplitBrainRisk: z.boolean().optional(),
})
export type PromoteBackupInput = z.infer<typeof PromoteBackupInput>

// POST /api/cluster/stations/heartbeat — any station's own local server
// writes this directly (it already holds a normal, authenticated Mongo
// connection to the shared master/backup replica set — no proxy needed).
// Works even on a single-machine standalone install (harmless, just never
// surfaced anywhere since ClusterStatusDTO.enabled is false there).
export const StationHeartbeatInput = z.object({
  stationId: z.string().min(1),
})
export type StationHeartbeatInput = z.infer<typeof StationHeartbeatInput>
