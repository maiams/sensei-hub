import type { FastifyPluginAsync } from 'fastify'
import mongoose from 'mongoose'
import { isDatabaseConnected } from '../config/database.js'

export const healthRoutes: FastifyPluginAsync = async (app) => {
  app.get('/health', async (_req, reply) => {
    if (!isDatabaseConnected()) {
      return reply.status(503).send({
        status: 'degraded',
        db: 'disconnected',
        timestamp: new Date().toISOString(),
      })
    }

    // Verify the connected node can accept writes (isWritablePrimary).
    // A secondary in a replica set has readyState 1 but cannot write.
    let writable = false
    try {
      const hello = await mongoose.connection.db!.command({ hello: 1 })
      writable = Boolean(hello.isWritablePrimary)
    } catch {
      // If the command fails, treat as not writable
    }

    if (!writable) {
      return reply.status(503).send({
        status: 'degraded',
        db: 'no_primary',
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
    return reply.send({ ok: true })
  })
}
