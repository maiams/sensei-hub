import { MongoClient } from 'mongodb'
import { networkInterfaces } from 'node:os'
import { MdnsCluster } from './mdns.js'
import {
  decideBootstrapAction,
  filterPeersForReplicaSet,
  excludeSelf,
  toClusterStatusDTO,
  type RawMemberStatus,
} from './rules.js'
import type { ClusterStatusDTO } from '@arena/shared'

export interface ClusterManagerConfig {
  serverPort: number
  replicaSetName: string
  mongoPort: number
  discoveryTimeoutMs: number
  clusterSecret: string
  advertiseHost?: string | undefined
  roleWatchIntervalMs?: number
}

const BOOTSTRAP_MAX_RETRIES = 3
const DEFAULT_ROLE_WATCH_INTERVAL_MS = 5_000

// Orchestrates Fase 7's dynamic cluster formation. Owns: mDNS announce +
// discover (mdns.ts), the bootstrap decision (rules.ts, pure), and the
// direct-connection MongoDB admin commands needed to act on that decision
// (rs.initiate / rs.add / rs.remove / rs.stepDown — the same direct-
// connection pattern packages/desktop-runtime/src/supervisor.ts already uses for its
// own single-node rs.initiate()).
//
// Division of responsibility with Supervisor (packages/desktop-runtime): Supervisor
// spawns/supervises the mongod and server OS processes and, in cluster
// mode, deliberately does NOT call rs.initiate() itself — it hands that
// decision to ClusterManager (running inside the server process, which has
// the mDNS discovery context Supervisor doesn't need to know about).
// Supervisor keeps the one thing ClusterManager structurally can't do:
// spawning a NEW mongod process for the N=2 arbiter (see needsArbiter()
// exposed through GET /api/cluster/status, which Supervisor polls).
export class ClusterManager {
  #config: ClusterManagerConfig
  #mdns = new MdnsCluster()
  #selfHost: string // "ip:mongoPort" — this node's own mongod address
  #selfIp: string
  #roleWatchTimer: NodeJS.Timeout | null = null
  #currentRole: 'primary' | 'secondary' = 'secondary'

  constructor(config: ClusterManagerConfig) {
    this.#config = config
    this.#selfIp = config.advertiseHost ?? findLanIPv4() ?? '127.0.0.1'
    this.#selfHost = `${this.#selfIp}:${config.mongoPort}`
  }

  get selfHost(): string {
    return this.#selfHost
  }

  // Decides whether this node founds the replica set or joins an existing
  // one, and makes it so. Must complete before the server connects via the
  // replicaSet-aware mongoose URI (apps/arena/server/src/index.ts) — a mongod
  // started with --replSet but never initiated/added to a config isn't a
  // usable replica set member yet.
  async bootstrap(): Promise<void> {
    this.#mdns.setAnnouncement({
      mongoHost: this.#selfHost,
      serverPort: this.#config.serverPort,
      role: 'secondary', // provisional — nobody should join against us until we actually have a role
      replicaSetName: this.#config.replicaSetName,
    })

    for (let attempt = 0; attempt < BOOTSTRAP_MAX_RETRIES; attempt++) {
      const peers = excludeSelf(
        filterPeersForReplicaSet(await this.#mdns.discover(this.#config.discoveryTimeoutMs), this.#config.replicaSetName),
        this.#selfHost,
      )
      const decision = decideBootstrapAction(peers)

      if (decision.action === 'initiate') {
        await this.#initiate()
        this.#startRoleWatcher()
        return
      }

      if (decision.action === 'join') {
        await this.#requestJoin(decision.primary)
        await this.#waitUntilSelfIsMember()
        this.#startRoleWatcher()
        return
      }

      // 'retry': peers exist but none announced as primary yet (mid-election
      // on the existing cluster) — brief pause, try discovery again.
      await sleep(1000)
    }

    throw new Error(
      `Cluster bootstrap failed: found peers for replica set "${this.#config.replicaSetName}" but none announced as primary after ${BOOTSTRAP_MAX_RETRIES} attempts. Restart this node once the existing cluster has a stable primary.`,
    )
  }

  // Handler for POST /api/cluster/join — runs on whichever node receives
  // the request (must be primary; the route layer authenticates via
  // CLUSTER_SECRET and this method re-checks primary status defensively).
  async handleJoinRequest(joiningMongoHost: string): Promise<void> {
    const client = await this.#connectDirect()
    try {
      const admin = client.db('admin')
      const hello = await admin.command({ hello: 1 })
      if (!hello.isWritablePrimary) {
        throw new ClusterManagerError('This node is not primary — cannot accept a join request', 409)
      }

      const conf = await admin.command({ replSetGetConfig: 1 })
      const members = conf.config.members as Array<{ _id: number; host: string }>
      const alreadyMember = members.some((m) => m.host === joiningMongoHost)
      if (alreadyMember) return // idempotent — matches Supervisor.initReplicaSetIfNeeded's precedent

      const nextId = Math.max(0, ...members.map((m) => m._id)) + 1
      const newMembers = [...members, { _id: nextId, host: joiningMongoHost, priority: 1, votes: 1 }]
      await admin.command({
        replSetReconfig: { ...conf.config, members: newMembers, version: conf.config.version + 1 },
      })
    } finally {
      await client.close()
    }
  }

  async getStatus(): Promise<ClusterStatusDTO> {
    const client = await this.#connectDirect()
    try {
      const admin = client.db('admin')
      const status = await admin.command({ replSetGetStatus: 1 })
      const members = status.members as RawMemberStatus[]
      const primary = members.find((m) => m.stateStr === 'PRIMARY')
      const primaryOptimeMs = primary?.optimeDate ? new Date(primary.optimeDate).getTime() : null
      return toClusterStatusDTO(this.#config.replicaSetName, this.#selfHost, members, primaryOptimeMs)
    } finally {
      await client.close()
    }
  }

  // `rs.stepDown()` if primary (gives the remaining nodes a chance to elect
  // a new primary before this process exits), then removes self from the
  // voting config via whichever node is primary afterwards. Best-effort by
  // design: a node that crashes ungracefully (power loss, kill -9) skips
  // this — the remaining nodes just see it as 'unreachable' in
  // replSetGetStatus until an operator removes it manually, which is the
  // correct and expected MongoDB replica set behavior, not a bug here.
  async gracefulLeave(): Promise<void> {
    this.#stopRoleWatcher()
    this.#mdns.setAnnouncement(null)
    this.#mdns.setPrimaryAlias(null)

    try {
      const self = await this.#connectDirect()
      try {
        const admin = self.db('admin')
        const hello = await admin.command({ hello: 1 })
        if (hello.isWritablePrimary) {
          await admin.command({ replSetStepDown: 30, secondaryCatchUpPeriodSecs: 10 }).catch(() => null)
          await sleep(2000) // give the remaining members a moment to elect a new primary
        }
      } finally {
        await self.close()
      }

      // Whoever is primary now (possibly unchanged, if self was never
      // primary) removes self from the voting config.
      const client = await this.#connectDirect()
      try {
        const admin = client.db('admin')
        const hello = await admin.command({ hello: 1 })
        const primaryHost = hello.primary as string | undefined
        if (!primaryHost) return // no reachable primary — nothing more this node can safely do

        const usingSelf = primaryHost === this.#selfHost
        const targetClient = usingSelf ? client : new MongoClient(`mongodb://${primaryHost}`, { directConnection: true })
        if (!usingSelf) await targetClient.connect()
        try {
          const targetAdmin = targetClient.db('admin')
          const conf = await targetAdmin.command({ replSetGetConfig: 1 })
          const members = conf.config.members as Array<{ host: string }>
          const remaining = members.filter((m) => m.host !== this.#selfHost)
          if (remaining.length === members.length) return // already not a member
          await targetAdmin.command({
            replSetReconfig: { ...conf.config, members: remaining, version: conf.config.version + 1 },
          })
        } finally {
          if (!usingSelf) await targetClient.close()
        }
      } finally {
        await client.close()
      }
    } catch (err) {
      // Best-effort — a failed graceful leave just means the remaining
      // members will see this node as unreachable, same as an ungraceful
      // crash. Never throw out of shutdown.
      console.warn('[cluster] graceful leave did not complete cleanly', err)
    }

    this.#mdns.destroy()
  }

  async #initiate(): Promise<void> {
    const client = await this.#connectDirect()
    try {
      const admin = client.db('admin')
      let alreadyInitiated = false
      try {
        await admin.command({ replSetGetStatus: 1 })
        alreadyInitiated = true
      } catch (err: unknown) {
        if ((err as { codeName?: string }).codeName !== 'NotYetInitialized') throw err
      }
      if (!alreadyInitiated) {
        await admin.command({
          replSetInitiate: {
            _id: this.#config.replicaSetName,
            members: [{ _id: 0, host: this.#selfHost, priority: 1 }],
          },
        })
      }
    } finally {
      await client.close()
    }
  }

  async #requestJoin(primary: { host: string; serverPort: number }): Promise<void> {
    const peerIp = primary.host.split(':')[0]
    const joinUrl = `http://${peerIp}:${primary.serverPort}/api/cluster/join`

    const res = await fetch(joinUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Cluster-Secret': this.#config.clusterSecret },
      body: JSON.stringify({ mongoHost: this.#selfHost }),
    })
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      throw new Error(`Join request to ${joinUrl} failed: ${res.status} ${body}`)
    }
  }

  async #waitUntilSelfIsMember(timeoutMs = 30_000): Promise<void> {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      try {
        const client = await this.#connectDirect()
        try {
          const hello = await client.db('admin').command({ hello: 1 })
          if (hello.setName === this.#config.replicaSetName) return
        } finally {
          await client.close()
        }
      } catch {
        // not ready yet
      }
      await sleep(500)
    }
    throw new Error(`Did not become a member of replica set "${this.#config.replicaSetName}" within ${timeoutMs}ms`)
  }

  #startRoleWatcher(): void {
    const interval = this.#config.roleWatchIntervalMs ?? DEFAULT_ROLE_WATCH_INTERVAL_MS
    this.#roleWatchTimer = setInterval(() => void this.#refreshRole(), interval)
    void this.#refreshRole()
  }

  #stopRoleWatcher(): void {
    if (this.#roleWatchTimer) clearInterval(this.#roleWatchTimer)
    this.#roleWatchTimer = null
  }

  async #refreshRole(): Promise<void> {
    try {
      const client = await this.#connectDirect()
      let hello: { isWritablePrimary?: boolean }
      try {
        hello = await client.db('admin').command({ hello: 1 })
      } finally {
        await client.close()
      }
      const role: 'primary' | 'secondary' = hello.isWritablePrimary ? 'primary' : 'secondary'
      if (role !== this.#currentRole) {
        console.log(`[cluster] role changed: ${this.#currentRole} -> ${role}`)
      }
      this.#currentRole = role
      this.#mdns.setAnnouncement({
        mongoHost: this.#selfHost,
        serverPort: this.#config.serverPort,
        role,
        replicaSetName: this.#config.replicaSetName,
      })
      this.#mdns.setPrimaryAlias(role === 'primary' ? this.#selfIp : null)
    } catch (err) {
      console.warn('[cluster] role refresh failed', err)
    }
  }

  async #connectDirect(): Promise<MongoClient> {
    const client = new MongoClient(`mongodb://${this.#selfHost}`, {
      directConnection: true,
      serverSelectionTimeoutMS: 5000,
    })
    await client.connect()
    return client
  }
}

export class ClusterManagerError extends Error {
  constructor(
    message: string,
    public readonly statusCode: 403 | 409,
  ) {
    super(message)
    this.name = 'ClusterManagerError'
  }
}

function findLanIPv4(): string | null {
  const interfaces = networkInterfaces()
  for (const addrs of Object.values(interfaces)) {
    for (const addr of addrs ?? []) {
      if (addr.family === 'IPv4' && !addr.internal) return addr.address
    }
  }
  return null
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
