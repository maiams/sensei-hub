import { buildApp } from './app.js'
import { connectDatabase } from '@sensei-hub/core-server'
import { env } from './config/env.js'
import { ClusterManager } from './cluster/ClusterManager.js'

async function main() {
  let clusterManager: ClusterManager | undefined

  if (env.CLUSTER_ROLE === 'master' || env.CLUSTER_ROLE === 'backup') {
    clusterManager = new ClusterManager({
      role: env.CLUSTER_ROLE,
      serverPort: env.PORT,
      replicaSetName: env.CLUSTER_REPLICA_SET_NAME,
      mongoPort: env.CLUSTER_MONGO_PORT,
      advertiseHost: env.CLUSTER_ADVERTISE_HOST,
    })
    // Master-only in practice (see initializeIfNeeded's doc comment) — must
    // complete before connectDatabase(): a mongod started with --replSet but
    // never initiated isn't a usable replica set member yet for the
    // replicaSet-aware mongoose URI. The backup role's mongod may still be
    // un-added at this point (waiting on the master's declareBackup()) — its
    // own connectDatabase() below will simply keep retrying via mongoose's
    // normal server-selection timeout/backoff until the master adds it.
    console.log(`[server] cluster role: ${env.CLUSTER_ROLE} — self is ${clusterManager.selfHost}`)
    await clusterManager.initializeIfNeeded()
  }

  await connectDatabase(env.MONGODB_URI)

  const app = await buildApp(clusterManager ? { clusterManager } : {})

  await app.listen({ port: env.PORT, host: '0.0.0.0' })
  console.log(`[server] listening on port ${env.PORT}`)

  // No cluster-specific shutdown hook anymore: a stopped master/backup node
  // just stops — it is NOT removed from the replica set config (that was
  // the automatic `rs.remove` behavior this design deliberately eliminates,
  // see ClusterManager's class doc comment). It shows up as unreachable in
  // GET /cluster/status until it comes back, or until an operator promotes
  // the backup. Plain SIGTERM/SIGINT handling is still needed so
  // Supervisor's restart/shutdown sequencing (packages/desktop-runtime) gets
  // a clean exit instead of a hard kill.
  let shuttingDown = false
  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.on(signal, () => {
      if (shuttingDown) return
      shuttingDown = true
      app
        .close()
        .catch((err) => console.error('[server] error during shutdown', err))
        .finally(() => process.exit(0))
    })
  }
}

main().catch((err) => {
  console.error('[server] fatal error', err)
  process.exit(1)
})
