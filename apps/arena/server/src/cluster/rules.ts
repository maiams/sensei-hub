// Pure decision logic for the cluster protocol — no networking, no MongoDB
// driver, no mDNS. Same "domain/" purity guarantee as domain/bracket and
// domain/scoreboard/rules.ts: every branch here is unit-testable without a
// real replica set.

import type { ClusterNodeDTO, ClusterNodeHealth, ClusterNodeRole, ClusterStatusDTO } from '@arena/shared'

export interface DiscoveredPeer {
  host: string // this peer's own mongod "ip:port"
  serverPort: number // this peer's own server API port (for POST /api/cluster/join)
  role: ClusterNodeRole
  replicaSetName: string
}

// mDNS discovery deliberately only trusts peers announcing the SAME
// replica set name — defends against two unrelated sensei-hub
// installations (different academies/gyms) on the same LAN accidentally
// merging into one cluster.
export function filterPeersForReplicaSet(peers: DiscoveredPeer[], replicaSetName: string): DiscoveredPeer[] {
  return peers.filter((p) => p.replicaSetName === replicaSetName)
}

// Defense in depth against mDNS loopback (a node receiving its own
// outgoing packets back — see mdns.ts's `loopback: false`, which is the
// primary fix): even if loopback were ever re-enabled or the OS/network
// stack echoes packets some other way, a node must never treat its own
// announcement as a discovered peer.
export function excludeSelf(peers: DiscoveredPeer[], selfHost: string): DiscoveredPeer[] {
  return peers.filter((p) => p.host !== selfHost)
}

export type BootstrapDecision =
  | { action: 'initiate' } // no peers found — become the founding primary
  | { action: 'join'; primary: DiscoveredPeer } // an existing primary was found — ask it to rs.add() us
  | { action: 'retry' } // peers exist but none announced as primary (mid-election) — wait and discover again

// `peers` must already be filtered to the target replica set name.
export function decideBootstrapAction(peers: DiscoveredPeer[]): BootstrapDecision {
  if (peers.length === 0) return { action: 'initiate' }
  const primary = peers.find((p) => p.role === 'primary')
  if (primary) return { action: 'join', primary }
  return { action: 'retry' }
}

// Raw shape of one entry in MongoDB's `replSetGetStatus` `members` array —
// only the fields this module actually reads.
export interface RawMemberStatus {
  _id: number
  name: string // "host:port"
  stateStr: string // 'PRIMARY' | 'SECONDARY' | 'ARBITER' | 'STARTUP2' | 'RECOVERING' | 'DOWN' | ...
  health: number // 1 = up, 0 = down, per the MongoDB wire protocol
  optimeDate?: string // ISO date string; absent for arbiters
}

function roleFromStateStr(stateStr: string): ClusterNodeRole {
  if (stateStr === 'PRIMARY') return 'primary'
  if (stateStr === 'SECONDARY') return 'secondary'
  if (stateStr === 'ARBITER') return 'arbiter'
  return 'unknown'
}

function healthOf(member: RawMemberStatus): ClusterNodeHealth {
  if (member.health === 0) return 'unreachable'
  return 'healthy' // lag-based downgrade to 'lagging' happens in toClusterStatusDTO, which knows the primary's optime
}

// `primaryOptimeMs` is the primary's own optime (ms since epoch) — needed to
// compute each secondary's replication lag. `lagWarnSeconds` is the
// threshold above which a healthy-but-behind secondary is reported as
// 'lagging' instead of 'healthy' (default 10s: CBJ RNC rest-time-scale
// tolerances aren't relevant here, this is just "noticeably behind").
export function toClusterStatusDTO(
  replicaSetName: string,
  selfHost: string,
  members: RawMemberStatus[],
  primaryOptimeMs: number | null,
  lagWarnSeconds = 10,
): ClusterStatusDTO {
  const nodes: ClusterNodeDTO[] = members.map((m) => {
    const role = roleFromStateStr(m.stateStr)
    let health = healthOf(m)
    let replicationLagSeconds: number | null = null

    if (role === 'secondary' && health === 'healthy' && primaryOptimeMs !== null && m.optimeDate) {
      const lagMs = primaryOptimeMs - new Date(m.optimeDate).getTime()
      replicationLagSeconds = Math.max(0, Math.round(lagMs / 1000))
      if (replicationLagSeconds > lagWarnSeconds) health = 'lagging'
    }

    return {
      host: m.name,
      role,
      health,
      isSelf: m.name === selfHost,
      replicationLagSeconds,
    }
  })

  return {
    enabled: true,
    replicaSetName,
    selfHost,
    nodes,
    hasArbiter: nodes.some((n) => n.role === 'arbiter'),
    needsArbiter: computeNeedsArbiter(members),
  }
}

// "N=2 sem arbiter" — exactly two DATA-BEARING voting members (regardless
// of current health; a temporarily unreachable member still counts, since
// the risk computeNeedsArbiter guards against — both secondaries stuck
// unable to elect a primary during a partition — is exactly when a member
// might look unreachable from either side) and no arbiter yet.
export function computeNeedsArbiter(members: RawMemberStatus[]): boolean {
  const dataBearing = members.filter((m) => m.stateStr !== 'ARBITER')
  const hasArbiter = members.some((m) => m.stateStr === 'ARBITER')
  return dataBearing.length === 2 && !hasArbiter
}
