import { buildApp } from './app.js'
import { connectDatabase } from '@sensei-hub/core-server'
import { env } from './config/env.js'

async function main() {
  await connectDatabase(env.MONGODB_URI)

  const app = await buildApp()

  await app.listen({ port: env.PORT, host: '0.0.0.0' })
  console.log(`[server] listening on port ${env.PORT}`)

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
