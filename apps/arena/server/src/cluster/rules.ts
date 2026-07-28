// Pure decision logic for the master/backup cluster protocol — no
// networking, no MongoDB driver. Same "domain/" purity guarantee as
// domain/bracket and domain/scoreboard/rules.ts: every branch here is
// unit-testable without a real replica set.
//
// The core idea (see apps/arena/shared/src/cluster.ts's module doc comment
// for the full picture): a MongoDB replica set member's ROLE in this app is
// not "whoever won the last election" — it's DECLARED, and the declaration
// lives entirely in the replica set config's `votes` field. `votes: 1` (the
// master, always exactly one) can always elect itself since one vote is a
// majority of one; `votes: 0` (the backup) can never win an election on its
// own, no matter what happens to the master. Promoting the backup means
// rewriting that config — a deliberate act, not something Mongo decides.

import type { ClusterNodeDTO, ClusterRole, MongoNodeState, StationStatusDTO, ClusterStatusDTO } from '@arena/shared'

export function roleFromVotes(votes: number): ClusterRole {
  return votes > 0 ? 'master' : 'backup'
}

const KNOWN_MONGO_STATES: readonly string[] = ['PRIMARY', 'SECONDARY', 'STARTUP', 'STARTUP2', 'RECOVERING', 'ROLLBACK']

export interface RawStatusMember {
  name: string // "host:port", matches replSetGetStatus's `members[].name`
  stateStr: string
  health: number // 1 = up, 0 = down, per the MongoDB wire protocol
  optimeDate?: string // ISO date string; absent when unreachable
}

// `member.health === 0` (server unreachable) always wins over whatever
// stale `stateStr` Mongo last recorded for it.
export function mongoStateOf(member: RawStatusMember): MongoNodeState {
  if (member.health === 0) return 'unreachable'
  return KNOWN_MONGO_STATES.includes(member.stateStr) ? (member.stateStr as MongoNodeState) : 'unknown'
}

export interface RawReplicaSetMember {
  _id: number
  host: string // "ip:port"
  votes: number
  priority: number
}

export interface RawReplicaSetConfig {
  _id: string // replica set name
  version: number
  members: RawReplicaSetMember[]
}

export type DeclareBackupPlan =
  | { action: 'noop'; reason: string } // already a member — declaring twice is a harmless no-op
  | { action: 'reconfig'; config: RawReplicaSetConfig }

// Adds `backupHost` as a non-voting, no-priority member. Never touches any
// existing member — this is additive only. The caller (ClusterManager) is
// responsible for actually reaching the backup's mongod before calling this;
// this function only shapes the resulting config document.
export function planDeclareBackup(config: RawReplicaSetConfig, backupHost: string): DeclareBackupPlan {
  if (config.members.some((m) => m.host === backupHost)) {
    return { action: 'noop', reason: 'This host is already a member of the replica set.' }
  }
  const nextId = Math.max(0, ...config.members.map((m) => m._id)) + 1
  return {
    action: 'reconfig',
    config: {
      ...config,
      version: config.version + 1,
      members: [...config.members, { _id: nextId, host: backupHost, votes: 0, priority: 0 }],
    },
  }
}

export type PromotionPlan =
  | { action: 'error'; reason: string }
  | { action: 'reconfig'; config: RawReplicaSetConfig }

// Makes `selfHost` the sole voting member (votes:1, priority:1) and demotes
// every other member to votes:0/priority:0 — it doesn't remove the former
// master from the config. That's deliberate: if the old master comes back
// later, it rejoins as an ordinary (now non-voting) secondary automatically,
// with no operator action needed — it just becomes the new backup. Removing
// members from the set on your own initiative is exactly the automatic
// `rs.remove` behavior this redesign eliminates; only an explicit, separate
// "remove from cluster" operator action should ever do that.
export function planPromotion(config: RawReplicaSetConfig, selfHost: string): PromotionPlan {
  const self = config.members.find((m) => m.host === selfHost)
  if (!self) {
    return { action: 'error', reason: `${selfHost} is not a member of this replica set.` }
  }
  if (self.votes > 0) {
    return { action: 'error', reason: 'This node is already the voting master — nothing to promote.' }
  }
  return {
    action: 'reconfig',
    config: {
      ...config,
      version: config.version + 1,
      members: config.members.map((m) => (m.host === selfHost ? { ...m, votes: 1, priority: 1 } : { ...m, votes: 0, priority: 0 })),
    },
  }
}

export interface PromotionSafetyCheck {
  // Result of the caller actually trying to reach the currently-declared
  // master and asking whether IT still thinks it's primary — see
  // ClusterManager.promote()'s doc comment for how this is obtained.
  oldMasterReachableAndPrimary: boolean
  acknowledgeSplitBrainRisk: boolean
}

// Refuses promotion when the old master is still up and still thinks it's
// primary — going ahead anyway would create two simultaneous masters
// (split-brain), each accepting writes the other never sees. This is the
// server-side guard behind the "confirmação clara do que acontece"
// requirement: promoting is only safe once the old master is actually gone.
// `acknowledgeSplitBrainRisk` is a deliberate, named escape hatch for the
// rare legitimate case (e.g. a network partition where the backup can't
// reach the master, but the master is otherwise fine and still serving
// stations on its own side of the partition) — using it is a conscious
// choice to accept the risk, not a default.
export function decidePromotionSafety(check: PromotionSafetyCheck): { allowed: boolean; reason?: string } {
  if (!check.oldMasterReachableAndPrimary) return { allowed: true }
  if (check.acknowledgeSplitBrainRisk) return { allowed: true }
  return {
    allowed: false,
    reason:
      'O master declarado ainda está acessível e respondendo como primário. Promover o backup agora criaria dois masters ao mesmo tempo (split-brain), com risco real de perda de dados. Confirme que o master está de fato fora do ar antes de tentar novamente.',
  }
}

const STATION_ONLINE_THRESHOLD_MS = 30_000

export function isStationOnline(lastSeenAtIso: string, nowMs: number, thresholdMs = STATION_ONLINE_THRESHOLD_MS): boolean {
  return nowMs - new Date(lastSeenAtIso).getTime() <= thresholdMs
}

export interface StationHeartbeatRow {
  stationId: string
  lastSeenAt: string // ISO
}

// Assembles the human-facing GET /cluster/status DTO from raw MongoDB
// admin-command output plus the station heartbeat rows. Pure — all the
// actual `replSetGetConfig`/`replSetGetStatus`/heartbeat-collection reads
// happen in ClusterManager; this only shapes what they returned.
export function buildClusterStatus(params: {
  replicaSetName: string
  selfHost: string
  configMembers: RawReplicaSetMember[]
  statusMembers: RawStatusMember[]
  stations: StationHeartbeatRow[]
  nowMs: number
}): ClusterStatusDTO {
  const { replicaSetName, selfHost, configMembers, statusMembers, stations, nowMs } = params
  const statusByHost = new Map(statusMembers.map((m) => [m.name, m]))
  const primary = statusMembers.find((m) => m.stateStr === 'PRIMARY')
  const primaryOptimeMs = primary?.optimeDate ? new Date(primary.optimeDate).getTime() : null

  const nodes: ClusterNodeDTO[] = configMembers.map((cm) => {
    const status = statusByHost.get(cm.host)
    const mongoState = status ? mongoStateOf(status) : 'unknown'
    let replicationLagSeconds: number | null = null
    if (mongoState === 'SECONDARY' && primaryOptimeMs !== null && status?.optimeDate) {
      replicationLagSeconds = Math.max(0, Math.round((primaryOptimeMs - new Date(status.optimeDate).getTime()) / 1000))
    }
    return {
      host: cm.host,
      role: roleFromVotes(cm.votes),
      mongoState,
      isSelf: cm.host === selfHost,
      replicationLagSeconds,
    }
  })

  const master = nodes.find((n) => n.role === 'master') ?? null
  const backup = nodes.find((n) => n.role === 'backup') ?? null
  const self = nodes.find((n) => n.isSelf) ?? null

  const stationDTOs: StationStatusDTO[] = stations
    .map((s) => ({ stationId: s.stationId, lastSeenAt: s.lastSeenAt, online: isStationOnline(s.lastSeenAt, nowMs) }))
    .sort((a, b) => b.lastSeenAt.localeCompare(a.lastSeenAt))

  return {
    enabled: true,
    replicaSetName,
    selfHost,
    selfRole: self?.role ?? null,
    master,
    backup,
    stations: stationDTOs,
  }
}
