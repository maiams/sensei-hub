import { buildApp } from './app.js'
import { connectDatabase } from './config/database.js'
import { env } from './config/env.js'
import { ClusterManager } from './cluster/ClusterManager.js'

async function main() {
  let clusterManager: ClusterManager | undefined

  if (env.CLUSTER_ENABLED) {
    clusterManager = new ClusterManager({
      serverPort: env.PORT,
      replicaSetName: env.CLUSTER_REPLICA_SET_NAME,
      mongoPort: env.CLUSTER_MONGO_PORT,
      discoveryTimeoutMs: env.CLUSTER_DISCOVERY_TIMEOUT_MS,
      clusterSecret: env.CLUSTER_SECRET,
      advertiseHost: env.CLUSTER_ADVERTISE_HOST,
    })
    // Must complete before connectDatabase(): a mongod started with
    // --replSet but never initiated/added to an existing config isn't a
    // usable replica set member yet for the replicaSet-aware mongoose URI.
    console.log('[server] cluster mode enabled — bootstrapping via mDNS...')
    await clusterManager.bootstrap()
    console.log(`[server] cluster bootstrap complete — self is ${clusterManager.selfHost}`)
  }

  await connectDatabase()

  const app = await buildApp(clusterManager ? { clusterManager } : {})

  app.addHook('onClose', async () => {
    if (clusterManager) await clusterManager.gracefulLeave()
  })

  await app.listen({ port: env.PORT, host: '0.0.0.0' })
  console.log(`[server] listening on port ${env.PORT}`)

  // Without this, SIGTERM (what Supervisor sends on shutdown/restart) kills
  // the process immediately and the onClose hook above never runs — a
  // clustered node would leave without stepping down or removing itself
  // from the voting config, which is fine as a rare/emergency case but not
  // as the normal shutdown path.
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
