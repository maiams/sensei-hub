import Fastify, { type FastifyInstance } from 'fastify'
import cors from '@fastify/cors'
import websocket from '@fastify/websocket'
import jwt from '@fastify/jwt'
import { healthRoutes, setupRoutes, authRoutes, userRoutes } from '@sensei-hub/core-server'
import { athleteRoutes } from './routes/athletes.js'
import { divisionTemplateRoutes } from './routes/divisionTemplates.js'
import { eventRoutes } from './routes/events.js'
import { importRoutes } from './routes/import.js'
import { areaRoutes } from './routes/areas.js'
import { scoreboardRoutes } from './routes/scoreboards.js'
import { checkInRoutes } from './routes/checkin.js'
import { clusterRoutes } from './routes/cluster.js'
import type { ClusterManager } from './cluster/ClusterManager.js'
import { env } from './config/env.js'

export interface BuildAppOptions {
  clusterManager?: ClusterManager
}

export async function buildApp(options: BuildAppOptions = {}): Promise<FastifyInstance> {
  const app = Fastify({
    logger: env.NODE_ENV !== 'test',
  })

  await app.register(cors, { origin: true })
  await app.register(websocket)
  await app.register(jwt, {
    secret: env.JWT_SECRET,
    sign: { expiresIn: env.JWT_EXPIRES_IN },
  })

  await app.register(healthRoutes, { prefix: '/api' })
  await app.register(setupRoutes, { prefix: '/api' })
  await app.register(authRoutes, { prefix: '/api' })
  await app.register(userRoutes, { prefix: '/api' })
  await app.register(athleteRoutes, { prefix: '/api' })
  await app.register(divisionTemplateRoutes, { prefix: '/api' })
  await app.register(eventRoutes, { prefix: '/api' })
  await app.register(importRoutes, { prefix: '/api' })
  await app.register(areaRoutes, { prefix: '/api' })
  await app.register(scoreboardRoutes, { prefix: '/api' })
  await app.register(checkInRoutes, { prefix: '/api' })
  await app.register(clusterRoutes, { prefix: '/api', ...(options.clusterManager ? { clusterManager: options.clusterManager } : {}) })

  return app
}
