import { buildApp } from './app.js'
import { connectDatabase } from './config/database.js'
import { env } from './config/env.js'

async function main() {
  await connectDatabase()

  const app = await buildApp()

  await app.listen({ port: env.PORT, host: '0.0.0.0' })
  console.log(`[server] listening on port ${env.PORT}`)
}

main().catch((err) => {
  console.error('[server] fatal error', err)
  process.exit(1)
})
