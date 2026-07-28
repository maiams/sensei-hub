// Route-level proof: authentication/authorization enforcement (server-side —
// CLAUDE.md: "frontend hiding is not authorization") and correct HTTP status
// mapping for the cluster management endpoints. The actual replica-set
// mechanics (declare/promote/data preservation) are proven against real
// mongod processes in cluster.manager.test.ts; this file drives the same
// ClusterManager through the real Fastify app instead, so the app's own
// user/academy/audit-log data lives in the standard test replica set
// (connectTestDb) while a SEPARATE small mongod stands in for the "cluster"
// mongod ClusterManager manages directly — a deliberate simplification for
// route-level testing, not a claim that production runs two databases.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { connectTestDb, closeTestDb, clearTestDb } from '@sensei-hub/core-server/testing'
import { MongoMemoryServer } from 'mongodb-memory-server'
import { buildApp } from '../app.js'
import { ClusterManager } from '../cluster/ClusterManager.js'
import type { FastifyInstance } from 'fastify'

const RS_NAME = 'sensei-rs-route-test'

async function setupAdmin(app: FastifyInstance, email = 'admin@test.com', password = 'senha12345') {
  await app.inject({
    method: 'POST',
    url: '/api/setup',
    payload: { academyName: 'Academia Teste', adminName: 'Admin', adminEmail: email, adminPassword: password },
  })
  const loginRes = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email, password } })
  return loginRes.json<{ accessToken: string }>().accessToken
}

async function createUserAndLogin(app: FastifyInstance, adminToken: string, role: string, email: string) {
  await app.inject({
    method: 'POST',
    url: '/api/users',
    headers: { authorization: `Bearer ${adminToken}` },
    payload: { name: 'User ' + role, email, password: 'senha12345', role },
  })
  const loginRes = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email, password: 'senha12345' } })
  return loginRes.json<{ accessToken: string }>().accessToken
}

describe('cluster routes — enabled (this node is the declared master)', () => {
  let app: FastifyInstance
  let clusterMongo: MongoMemoryServer
  let adminToken: string
  let staffToken: string

  beforeAll(async () => {
    await connectTestDb()
    clusterMongo = await MongoMemoryServer.create({ instance: { replSet: RS_NAME, ip: '127.0.0.1', storageEngine: 'wiredTiger' } })
    const clusterManager = new ClusterManager({
      role: 'master',
      serverPort: 3001,
      replicaSetName: RS_NAME,
      mongoPort: clusterMongo.instanceInfo!.port,
      advertiseHost: '127.0.0.1',
      masterReachabilityTimeoutMs: 500,
    })
    await clusterManager.initializeIfNeeded()
    app = await buildApp({ clusterManager })
    await app.ready()
  })

  afterAll(async () => {
    await app.close()
    await clusterMongo.stop()
    await closeTestDb()
  })

  beforeEach(async () => {
    await clearTestDb()
    adminToken = await setupAdmin(app)
    staffToken = await createUserAndLogin(app, adminToken, 'staff', 'staff@test.com')
  })

  it('rejects an unauthenticated status request', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/cluster/status' })
    expect(res.statusCode).toBe(401)
  })

  it('rejects status/backup/promote for a role below event_manager', async () => {
    const statusRes = await app.inject({ method: 'GET', url: '/api/cluster/status', headers: { authorization: `Bearer ${staffToken}` } })
    expect(statusRes.statusCode).toBe(403)

    const backupRes = await app.inject({
      method: 'POST',
      url: '/api/cluster/backup',
      headers: { authorization: `Bearer ${staffToken}` },
      payload: { mongoHost: '127.0.0.1:1' },
    })
    expect(backupRes.statusCode).toBe(403)

    const promoteRes = await app.inject({
      method: 'POST',
      url: '/api/cluster/promote',
      headers: { authorization: `Bearer ${staffToken}` },
      payload: { confirm: true },
    })
    expect(promoteRes.statusCode).toBe(403)
  })

  it('returns live status for event_manager+, showing self as the only member so far', async () => {
    const managerToken = await createUserAndLogin(app, adminToken, 'event_manager', 'manager@test.com')
    const res = await app.inject({ method: 'GET', url: '/api/cluster/status', headers: { authorization: `Bearer ${managerToken}` } })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.enabled).toBe(true)
    expect(body.selfRole).toBe('master')
    expect(body.backup).toBeNull()
  })

  it('maps an unreachable backup address to 422 with a clear error, not a 500', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/cluster/backup',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { mongoHost: '127.0.0.1:1' }, // nothing listens here
    })
    expect(res.statusCode).toBe(422)
    expect(res.json().error).toBeTruthy()
  })

  it('refuses to promote this node (already the master) with 409', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/cluster/promote',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { confirm: true },
    })
    expect(res.statusCode).toBe(409)
  })

  it('validates the promote body requires confirm: true', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/cluster/promote',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {},
    })
    expect(res.statusCode).toBe(400)
  })

  it('accepts a station heartbeat from scoreboard_operator+ and rejects a lower role', async () => {
    const scoreboardToken = await createUserAndLogin(app, adminToken, 'scoreboard_operator', 'sb@test.com')
    const ok = await app.inject({
      method: 'POST',
      url: '/api/cluster/stations/heartbeat',
      headers: { authorization: `Bearer ${scoreboardToken}` },
      payload: { stationId: 'station-1' },
    })
    expect(ok.statusCode).toBe(204)

    const guardianToken = await createUserAndLogin(app, adminToken, 'guardian', 'guardian@test.com')
    const forbidden = await app.inject({
      method: 'POST',
      url: '/api/cluster/stations/heartbeat',
      headers: { authorization: `Bearer ${guardianToken}` },
      payload: { stationId: 'station-1' },
    })
    expect(forbidden.statusCode).toBe(403)

    const managerToken = await createUserAndLogin(app, adminToken, 'event_manager', 'manager2@test.com')
    const statusRes = await app.inject({ method: 'GET', url: '/api/cluster/status', headers: { authorization: `Bearer ${managerToken}` } })
    expect(statusRes.json().stations.some((s: { stationId: string }) => s.stationId === 'station-1')).toBe(true)
  })
})

describe('cluster routes — disabled (standalone/station node)', () => {
  let app: FastifyInstance

  beforeAll(async () => {
    await connectTestDb()
    app = await buildApp() // no clusterManager
    await app.ready()
  })

  afterAll(async () => {
    await app.close()
    await closeTestDb()
  })

  beforeEach(async () => {
    await clearTestDb()
  })

  it('reports a disabled status instead of 500ing', async () => {
    const adminToken = await setupAdmin(app)
    const managerToken = await createUserAndLogin(app, adminToken, 'event_manager', 'manager@test.com')
    const res = await app.inject({ method: 'GET', url: '/api/cluster/status', headers: { authorization: `Bearer ${managerToken}` } })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ enabled: false, master: null, backup: null })
  })

  it('404s declare-backup and promote when cluster mode is off', async () => {
    const adminToken = await setupAdmin(app)
    const backupRes = await app.inject({
      method: 'POST',
      url: '/api/cluster/backup',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { mongoHost: '127.0.0.1:1' },
    })
    expect(backupRes.statusCode).toBe(404)

    const promoteRes = await app.inject({
      method: 'POST',
      url: '/api/cluster/promote',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { confirm: true },
    })
    expect(promoteRes.statusCode).toBe(404)
  })

  it('still accepts station heartbeats (harmless no-op) even with cluster mode off', async () => {
    const adminToken = await setupAdmin(app)
    const scoreboardToken = await createUserAndLogin(app, adminToken, 'scoreboard_operator', 'sb@test.com')
    const res = await app.inject({
      method: 'POST',
      url: '/api/cluster/stations/heartbeat',
      headers: { authorization: `Bearer ${scoreboardToken}` },
      payload: { stationId: 'station-1' },
    })
    expect(res.statusCode).toBe(204)
  })
})
