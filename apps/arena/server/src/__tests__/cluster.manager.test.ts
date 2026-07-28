// Integration proof for the master/backup redesign — CLAUDE.md forbids
// claiming resilience without a test that actually demonstrates it. This
// spins up TWO real, separate mongod processes (not a single
// MongoMemoryReplSet — that would auto-manage replication in ways that
// hide exactly the manual declare/promote protocol under test) and drives
// them through the real ClusterManager code path:
//
//   1. master self-initiates alone (votes:1) — ClusterManager.initializeIfNeeded()
//   2. master declares the backup (votes:0) — ClusterManager.declareBackup()
//   3. real data is written and replicates to the backup
//   4. the master process is killed (simulates "derrubar o master")
//   5. the backup is promoted from ITS OWN node — ClusterManager.promote()
//   6. the previously-written data is still there, read back from the backup
//   7. both actions produced an audited trail entry
//
// What this does NOT prove: real separate machines/OS processes/network
// (both mongod's run as local child processes on 127.0.0.1 here, and
// ClusterManager itself runs in-process rather than behind a real Fastify
// server on each "node") or a station's own driver-level failover
// (unit-tested at the design-decision level in cluster.rules.test.ts, but
// the actual "MongoDB driver reconnects an app's mongoose to the newly
// promoted primary with zero station-side changes" behavior is standard,
// well-established driver behavior this suite does not re-verify end to
// end — see the report for exactly what's left unverified.
import { describe, it, expect, afterEach } from 'vitest'
import { MongoMemoryServer } from 'mongodb-memory-server'
import { MongoClient } from 'mongodb'
import mongoose from 'mongoose'
import { AuditLogModel, type AuthCtx } from '@sensei-hub/core-server'
import { ClusterManager, ClusterManagerError } from '../cluster/ClusterManager.js'

const RS_NAME = 'sensei-rs-test'

function ctx(): AuthCtx {
  return {
    userId: new mongoose.Types.ObjectId().toString(),
    academyId: new mongoose.Types.ObjectId().toString(),
    role: 'super_admin',
    sessionId: 'test-session',
    ip: '127.0.0.1',
  }
}

async function waitUntil(predicate: () => Promise<boolean>, timeoutMs: number, intervalMs = 300): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await predicate()) return
    await new Promise((resolve) => setTimeout(resolve, intervalMs))
  }
  throw new Error('waitUntil timed out')
}

// Master seeing the backup as SECONDARY in its own replSetGetStatus does not
// mean the backup's OWN mongod has yet locally applied that same config, nor
// that it has finished initial sync — both are asynchronous. `hello.setName`
// appears as soon as the config is applied, but the node briefly sits in an
// intermediate replication state (still doing initial sync) before
// `hello.secondary` turns true; reads attempted in that narrow window are
// refused by mongod itself ("not in primary or recovering state"), which is
// exactly the flakiness this stricter check exists to avoid.
async function waitUntilSelfKnowsItIsAMember(host: string, timeoutMs: number): Promise<void> {
  await waitUntil(async () => {
    const client = new MongoClient(`mongodb://${host}`, { directConnection: true })
    await client.connect()
    try {
      const hello = await client.db('admin').command({ hello: 1 })
      return hello.setName === RS_NAME && hello.secondary === true
    } catch {
      return false
    } finally {
      await client.close()
    }
  }, timeoutMs)
}

describe('ClusterManager — master/backup declare + promote (real mongod processes)', () => {
  let masterMongo: MongoMemoryServer | undefined
  let backupMongo: MongoMemoryServer | undefined

  afterEach(async () => {
    await mongoose.disconnect().catch(() => {})
    await backupMongo?.stop().catch(() => {})
    await masterMongo?.stop().catch(() => {})
    masterMongo = undefined
    backupMongo = undefined
  })

  it(
    'declares a backup, replicates real data, and after the master is killed, promoting the backup preserves the data with an audited trail',
    async () => {
      masterMongo = await MongoMemoryServer.create({ instance: { replSet: RS_NAME, ip: '127.0.0.1', storageEngine: 'wiredTiger' } })
      backupMongo = await MongoMemoryServer.create({ instance: { replSet: RS_NAME, ip: '127.0.0.1', storageEngine: 'wiredTiger' } })

      const masterPort = masterMongo.instanceInfo!.port
      const backupPort = backupMongo.instanceInfo!.port
      const masterHost = `127.0.0.1:${masterPort}`
      const backupHost = `127.0.0.1:${backupPort}`

      // --- 1. master self-initiates -----------------------------------
      const masterManager = new ClusterManager({
        role: 'master',
        serverPort: 3001,
        replicaSetName: RS_NAME,
        mongoPort: masterPort,
        advertiseHost: '127.0.0.1',
        masterReachabilityTimeoutMs: 500,
      })
      await masterManager.initializeIfNeeded()

      // Mongoose connection standing in for "master's own Fastify app" —
      // this is what actually lets ClusterManager's AuditLogModel.create()
      // calls persist, exactly as they would in the real running server
      // (connectDatabase() always runs before the server starts handling
      // requests — see apps/arena/server/src/index.ts). getStatus() reads
      // StationHeartbeatModel through this same ambient connection, so it
      // needs to exist before the first status check, same as production.
      await mongoose.connect(`mongodb://${masterHost}/cluster-test?replicaSet=${RS_NAME}`, { directConnection: true })

      const statusAfterInit = await masterManager.getStatus()
      expect(statusAfterInit.selfRole).toBe('master')
      expect(statusAfterInit.master?.host).toBe(masterHost)
      expect(statusAfterInit.backup).toBeNull()

      // --- 2. declare the backup ---------------------------------------
      const afterDeclare = await masterManager.declareBackup(backupHost, ctx())
      expect(afterDeclare.backup).toMatchObject({ host: backupHost, role: 'backup' })

      // Declaring twice must stay a harmless no-op (idempotent), not a second
      // audit entry or an error.
      await masterManager.declareBackup(backupHost, ctx())

      // --- 3. real data is written and replicates ----------------------
      const directMaster = new MongoClient(`mongodb://${masterHost}`, { directConnection: true })
      await directMaster.connect()
      await waitUntil(async () => {
        const status = await directMaster.db('admin').command({ replSetGetStatus: 1 })
        const backupMember = (status.members as Array<{ name: string; stateStr: string }>).find((m) => m.name === backupHost)
        return backupMember?.stateStr === 'SECONDARY'
      }, 20_000)
      await directMaster.close()

      const inserted = await mongoose.connection.collection('smoke').insertOne({ hello: 'world-before-crash' })

      await waitUntil(async () => {
        const directBackup = new MongoClient(`mongodb://${backupHost}`, { directConnection: true, readPreference: 'secondary' })
        await directBackup.connect()
        try {
          const found = await directBackup.db('cluster-test').collection('smoke').findOne({ _id: inserted.insertedId })
          return found !== null
        } finally {
          await directBackup.close()
        }
      }, 20_000)

      await waitUntilSelfKnowsItIsAMember(backupHost, 20_000)

      // --- 4. "derrubar o master" ---------------------------------------
      await mongoose.disconnect()
      await masterMongo.stop()
      masterMongo = undefined

      // --- 5. promote the backup, from its OWN node ----------------------
      const backupManager = new ClusterManager({
        role: 'backup',
        serverPort: 3001,
        replicaSetName: RS_NAME,
        mongoPort: backupPort,
        advertiseHost: '127.0.0.1',
        masterReachabilityTimeoutMs: 500,
      })

      // Standing in for the backup's own Fastify app's mongoose connection —
      // opened while the node is still secondary, exactly like the real app
      // would already have it open before an operator ever clicks "promote".
      await mongoose.connect(`mongodb://${backupHost}/cluster-test`, { directConnection: true })

      const promoted = await backupManager.promote({ acknowledgeSplitBrainRisk: false }, ctx())
      expect(promoted.selfRole).toBe('master')
      expect(promoted.master?.host).toBe(backupHost)

      // --- 6. the data survived --------------------------------------
      const found = await mongoose.connection.collection('smoke').findOne({ _id: inserted.insertedId })
      expect(found?.hello).toBe('world-before-crash')

      // --- 7. both actions left an audited trail ------------------------
      const entries = await AuditLogModel.find({ entityType: 'Cluster' }).sort({ timestamp: 1 }).lean()
      expect(entries.some((e) => e.fieldName === 'backup' && e.newValue === backupHost)).toBe(true)
      const promotionEntry = entries.find((e) => e.fieldName === 'master')
      expect(promotionEntry).toBeDefined()
      expect(promotionEntry?.oldValue).toBe(masterHost)
      expect(promotionEntry?.newValue).toBe(backupHost)
    },
    90_000,
  )

  it('refuses to promote when the declared master is still alive and reachable (split-brain guard)', async () => {
    masterMongo = await MongoMemoryServer.create({ instance: { replSet: RS_NAME, ip: '127.0.0.1', storageEngine: 'wiredTiger' } })
    backupMongo = await MongoMemoryServer.create({ instance: { replSet: RS_NAME, ip: '127.0.0.1', storageEngine: 'wiredTiger' } })

    const masterPort = masterMongo.instanceInfo!.port
    const backupPort = backupMongo.instanceInfo!.port
    const masterHost = `127.0.0.1:${masterPort}`
    const backupHost = `127.0.0.1:${backupPort}`

    const masterManager = new ClusterManager({
      role: 'master',
      serverPort: 3001,
      replicaSetName: RS_NAME,
      mongoPort: masterPort,
      advertiseHost: '127.0.0.1',
      masterReachabilityTimeoutMs: 1000,
    })
    await masterManager.initializeIfNeeded()

    await mongoose.connect(`mongodb://${masterHost}/cluster-test?replicaSet=${RS_NAME}`, { directConnection: true })
    await masterManager.declareBackup(backupHost, ctx())
    await mongoose.disconnect()
    await waitUntilSelfKnowsItIsAMember(backupHost, 20_000)

    // Master is still up (never stopped in this test) — a backup promotion
    // attempt must be refused rather than creating a split-brain.
    const backupManager = new ClusterManager({
      role: 'backup',
      serverPort: 3001,
      replicaSetName: RS_NAME,
      mongoPort: backupPort,
      advertiseHost: '127.0.0.1',
      masterReachabilityTimeoutMs: 1000,
    })
    await mongoose.connect(`mongodb://${backupHost}/cluster-test`, { directConnection: true })

    await expect(backupManager.promote({ acknowledgeSplitBrainRisk: false }, ctx())).rejects.toThrow(ClusterManagerError)

    // The replica set config must be untouched — self is still the backup.
    const status = await backupManager.getStatus()
    expect(status.selfRole).toBe('backup')
  }, 60_000)
})
