import { MongoClient, type Db } from 'mongodb'
import { createHash } from 'node:crypto'
import { networkInterfaces } from 'node:os'
import { Types } from 'mongoose'
import { AuditLogModel, type AuthCtx } from '@sensei-hub/core-server'
import { StationHeartbeatModel } from '../repositories/StationHeartbeatModel.js'
import {
  planDeclareBackup,
  planPromotion,
  decidePromotionSafety,
  buildClusterStatus,
  type RawReplicaSetConfig,
} from './rules.js'
import type { ClusterStatusDTO } from '@arena/shared'

export interface ClusterManagerConfig {
  // This node's DECLARED role — set once at machine setup time (see
  // packages/desktop-runtime/src/machineRole.ts), never inferred or elected.
  role: 'master' | 'backup'
  serverPort: number
  replicaSetName: string
  mongoPort: number
  advertiseHost?: string | undefined
  // How long to wait for a direct connection when checking whether the
  // currently-declared master is still alive and primary, before allowing a
  // promotion. Short on purpose — this is a quick sanity check right before
  // an operator-triggered action, not a health-monitoring subsystem.
  masterReachabilityTimeoutMs?: number
}

// Owns the master/backup replica set protocol described in
// apps/arena/shared/src/cluster.ts's module doc comment. Compared to the
// Fase 7 design this replaces, the responsibilities shrink a lot:
//
//  - No mDNS peer discovery, no "found a set vs. join an existing one"
//    bootstrap decision — the master always self-initiates (it's declared,
//    there's nothing to discover), and the backup never initiates anything
//    at all; it just waits to be added.
//  - No node-to-node HTTP join handshake, no shared CLUSTER_SECRET — adding
//    the backup is a direct `replSetReconfig` the MASTER runs against
//    itself, needing only network reach to the backup's mongod PORT. MongoDB
//    replication is pull-based from the secondary side: once the backup's
//    (already-running) mongod is listed in the primary's config, it
//    discovers that on its own via the ordinary internal replication
//    heartbeat and starts syncing — no cooperation from the backup's own
//    Fastify/application layer is needed for this part.
//  - No arbiter, ever — a 2-member set where only the master votes never
//    needs a tie-breaker, because there's only ever one voter.
//  - No automatic `rs.remove` on shutdown — a stopped node just shows up as
//    unreachable in status until it comes back (or an operator explicitly
//    removes it some other way — not implemented by this class; see the
//    class doc in the PR/report for what's intentionally left out).
//
// Station notebooks (see machineRole.ts) don't get a ClusterManager at all —
// they run no local mongod and connect their own Fastify's mongoose straight
// to a replicaSet-aware MONGODB_URI seeded with [master, backup]. The
// MongoDB driver's own topology monitoring re-routes writes to whichever one
// is currently the (sole) voting primary — including automatically, within
// one heartbeat interval, right after an operator promotes the backup. That
// is the entire answer to "stations need to reapontar rápido": it's the
// driver's normal replica-set behavior, not custom code in this class.
export class ClusterManager {
  #config: ClusterManagerConfig
  #selfHost: string // "ip:mongoPort" — this node's own mongod address

  constructor(config: ClusterManagerConfig) {
    this.#config = config
    const ip = config.advertiseHost ?? findLanIPv4() ?? '127.0.0.1'
    this.#selfHost = `${ip}:${config.mongoPort}`
  }

  get selfHost(): string {
    return this.#selfHost
  }

  get role(): 'master' | 'backup' {
    return this.#config.role
  }

  // Master role only, called once at server startup. Idempotent — safe on
  // every boot (a restarted master finds its set already initiated and does
  // nothing). The backup role deliberately has no equivalent method here:
  // its mongod just sits, started with --replSet but uninitiated, until the
  // master's declareBackup() adds it.
  async initializeIfNeeded(): Promise<void> {
    if (this.#config.role !== 'master') return
    const client = await this.#connectDirect(this.#selfHost)
    try {
      const admin = client.db('admin')
      if (!(await this.#isInitiated(admin))) {
        await admin.command({
          replSetInitiate: {
            _id: this.#config.replicaSetName,
            members: [{ _id: 0, host: this.#selfHost, votes: 1, priority: 1 }],
          },
        })
        await this.#waitForPrimary(this.#selfHost, 15_000)
      }
    } finally {
      await client.close()
    }
  }

  // Master-only, human-triggered from the cluster management screen (POST
  // /api/cluster/backup, event_manager+ — see routes/cluster.ts).
  async declareBackup(backupMongoHost: string, ctx: AuthCtx): Promise<ClusterStatusDTO> {
    if (this.#config.role !== 'master') {
      throw new ClusterManagerError('Only the master can declare a backup.', 409)
    }
    if (backupMongoHost === this.#selfHost) {
      throw new ClusterManagerError('The backup cannot be the same machine as the master.', 400)
    }

    await this.#assertMongodReachable(
      backupMongoHost,
      'Não foi possível alcançar o mongod do backup nesse endereço — confirme que ele está rodando e que o endereço está correto.',
    )

    const client = await this.#connectDirect(this.#selfHost)
    try {
      const admin = client.db('admin')
      const rawConfig = await this.#getRawConfig(admin)
      const plan = planDeclareBackup(rawConfig, backupMongoHost)
      if (plan.action === 'reconfig') {
        await admin.command({ replSetReconfig: plan.config })
        await AuditLogModel.create({
          userId: ctx.userId,
          entityType: 'Cluster',
          entityId: clusterEntityId(this.#config.replicaSetName),
          action: 'update',
          fieldName: 'backup',
          oldValue: null,
          newValue: backupMongoHost,
          sessionId: ctx.sessionId,
          ip: ctx.ip,
        })
      }
    } finally {
      await client.close()
    }

    return this.getStatus()
  }

  // Disaster-recovery action, meant to be triggered FROM THE BACKUP NODE's
  // own management screen — the master may well be the machine that just
  // died, so nothing on this path ever depends on reaching it. Connects
  // directly to SELF only, and, once the split-brain safety check clears,
  // force-reconfigures the replica set to make self the sole voting member.
  //
  // `force: true` is the documented MongoDB escape hatch for this exact
  // situation: a normal `replSetReconfig` must be run against the current
  // primary, but by definition there is no reachable primary here (that's
  // why the operator is promoting). `force` lets a secondary install a new
  // config unilaterally when the primary is believed gone. Once installed,
  // self is the only voter, so it can win an uncontested election
  // immediately — a majority of one.
  async promote(input: { acknowledgeSplitBrainRisk: boolean }, ctx: AuthCtx): Promise<ClusterStatusDTO> {
    if (this.#config.role !== 'backup') {
      throw new ClusterManagerError('Only a declared backup can be promoted.', 409)
    }

    const client = await this.#connectDirect(this.#selfHost)
    try {
      const admin = client.db('admin')
      const rawConfig = await this.#getRawConfig(admin)
      const formerMaster = rawConfig.members.find((m) => m.host !== this.#selfHost && m.votes > 0)

      const oldMasterReachableAndPrimary = formerMaster ? await this.#isReachablePrimary(formerMaster.host) : false
      const safety = decidePromotionSafety({
        oldMasterReachableAndPrimary,
        acknowledgeSplitBrainRisk: input.acknowledgeSplitBrainRisk,
      })
      if (!safety.allowed) {
        throw new ClusterManagerError(safety.reason ?? 'Promoção recusada.', 409)
      }

      const plan = planPromotion(rawConfig, this.#selfHost)
      if (plan.action === 'error') {
        throw new ClusterManagerError(plan.reason, 409)
      }

      await admin.command({ replSetReconfig: plan.config, force: true })
      await this.#waitForPrimary(this.#selfHost, 30_000)

      this.#config = { ...this.#config, role: 'master' }

      await AuditLogModel.create({
        userId: ctx.userId,
        entityType: 'Cluster',
        entityId: clusterEntityId(this.#config.replicaSetName),
        action: 'update',
        fieldName: 'master',
        oldValue: formerMaster?.host ?? null,
        newValue: this.#selfHost,
        reason: input.acknowledgeSplitBrainRisk
          ? 'Promoção manual do backup a master (risco de split-brain reconhecido pelo operador)'
          : 'Promoção manual do backup a master',
        sessionId: ctx.sessionId,
        ip: ctx.ip,
      })
    } finally {
      await client.close()
    }

    return this.getStatus()
  }

  async getStatus(): Promise<ClusterStatusDTO> {
    const client = await this.#connectDirect(this.#selfHost)
    try {
      const admin = client.db('admin')

      if (!(await this.#isInitiated(admin))) {
        // Backup declared locally but not yet added by the master (or a
        // master that hasn't run initializeIfNeeded() yet) — there's no
        // replica set config to read yet. Still surface self so the
        // management screen has something to show while waiting.
        return {
          enabled: true,
          replicaSetName: this.#config.replicaSetName,
          selfHost: this.#selfHost,
          selfRole: this.#config.role,
          master: this.#config.role === 'master' ? { host: this.#selfHost, role: 'master', mongoState: 'unknown', isSelf: true, replicationLagSeconds: null } : null,
          backup: this.#config.role === 'backup' ? { host: this.#selfHost, role: 'backup', mongoState: 'unknown', isSelf: true, replicationLagSeconds: null } : null,
          stations: [],
        }
      }

      const rawConfig = await this.#getRawConfig(admin)
      const rawStatus = (await admin.command({ replSetGetStatus: 1 })) as {
        members: Array<{ name: string; stateStr: string; health: number; optimeDate?: Date }>
      }
      const statusMembers = rawStatus.members.map((m) => ({
        name: m.name,
        stateStr: m.stateStr,
        health: m.health,
        ...(m.optimeDate ? { optimeDate: new Date(m.optimeDate).toISOString() } : {}),
      }))
      // .read('nearest') matters specifically when THIS node is the backup:
      // its own mongoose connection would otherwise use the default
      // primary-only read preference and fail outright whenever this node
      // is (as expected, most of the time) a secondary — status must stay
      // readable from a backup that was never promoted, not just the master.
      // Still wrapped in try/catch: right after being declared, a backup is
      // briefly in an intermediate replication state (initial sync, before
      // it settles into SECONDARY) where even a 'nearest' read is refused —
      // that shouldn't take down the whole status response, just omit the
      // stations list for that one narrow window.
      const stations = await StationHeartbeatModel.find()
        .read('nearest')
        .sort({ lastSeenAt: -1 })
        .limit(200)
        .catch(() => [])

      return buildClusterStatus({
        replicaSetName: this.#config.replicaSetName,
        selfHost: this.#selfHost,
        configMembers: rawConfig.members,
        statusMembers,
        stations: stations.map((s) => ({ stationId: s.stationId, lastSeenAt: s.lastSeenAt.toISOString() })),
        nowMs: Date.now(),
      })
    } finally {
      await client.close()
    }
  }

  async #getRawConfig(admin: Db): Promise<RawReplicaSetConfig> {
    const conf = await admin.command({ replSetGetConfig: 1 })
    const raw = conf.config as {
      _id: string
      version: number
      members: Array<{ _id: number; host: string; votes?: number; priority?: number }>
    }
    return {
      _id: raw._id,
      version: raw.version,
      members: raw.members.map((m) => ({ _id: m._id, host: m.host, votes: m.votes ?? 1, priority: m.priority ?? 1 })),
    }
  }

  async #isInitiated(admin: Db): Promise<boolean> {
    try {
      await admin.command({ replSetGetStatus: 1 })
      return true
    } catch (err: unknown) {
      if ((err as { codeName?: string }).codeName === 'NotYetInitialized') return false
      throw err
    }
  }

  async #waitForPrimary(host: string, timeoutMs: number): Promise<void> {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      try {
        const client = await this.#connectDirect(host)
        try {
          const hello = await client.db('admin').command({ hello: 1 })
          if (hello.isWritablePrimary) return
        } finally {
          await client.close()
        }
      } catch {
        // not ready yet
      }
      await sleep(300)
    }
    throw new Error(`Timed out waiting for ${host} to become primary`)
  }

  async #isReachablePrimary(host: string): Promise<boolean> {
    try {
      const client = new MongoClient(`mongodb://${host}`, {
        directConnection: true,
        serverSelectionTimeoutMS: this.#config.masterReachabilityTimeoutMs ?? 2000,
      })
      await client.connect()
      try {
        const hello = await client.db('admin').command({ hello: 1 })
        return hello.isWritablePrimary === true
      } finally {
        await client.close()
      }
    } catch {
      return false
    }
  }

  async #assertMongodReachable(host: string, message: string): Promise<void> {
    try {
      const client = new MongoClient(`mongodb://${host}`, {
        directConnection: true,
        serverSelectionTimeoutMS: this.#config.masterReachabilityTimeoutMs ?? 3000,
      })
      await client.connect()
      await client.close()
    } catch {
      throw new ClusterManagerError(message, 422)
    }
  }

  async #connectDirect(host: string): Promise<MongoClient> {
    const client = new MongoClient(`mongodb://${host}`, {
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
    public readonly statusCode: 400 | 404 | 409 | 422,
  ) {
    super(message)
    this.name = 'ClusterManagerError'
  }
}

// Cluster-level audit entries (declare backup / promote) aren't tied to any
// single Mongoose document, but AuditLogModel requires an ObjectId
// `entityId` — deriving a stable one from the replica set name (rather than
// a fresh random id per entry) means every audit entry for the same cluster
// groups under one entity for history lookups.
function clusterEntityId(replicaSetName: string): Types.ObjectId {
  const hash = createHash('md5').update(replicaSetName).digest()
  return new Types.ObjectId(hash.subarray(0, 12))
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
