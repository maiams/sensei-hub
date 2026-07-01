import type { FastifyPluginAsync } from 'fastify'
import { isDatabaseConnected } from '../config/database.js'

export const healthRoutes: FastifyPluginAsync = async (app) => {
  app.get('/health', async (_req, reply) => {
    const dbOk = isDatabaseConnected()

    if (!dbOk) {
      return reply.status(503).send({
        status: 'degraded',
        db: 'disconnected',
        timestamp: new Date().toISOString(),
      })
    }

    return reply.send({
      status: 'ok',
      db: 'connected',
      timestamp: new Date().toISOString(),
    })
  })

  // Called by Electron supervisor before restarting — flush in-flight operations
  app.post('/shutdown-prep', async (_req, reply) => {
    // Future: drain write queues, flush pending changes
    return reply.send({ ok: true })
  })
}
