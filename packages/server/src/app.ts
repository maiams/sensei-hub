import Fastify, { type FastifyInstance } from 'fastify'
import cors from '@fastify/cors'
import websocket from '@fastify/websocket'
import { healthRoutes } from './routes/health.js'
import { env } from './config/env.js'

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: env.NODE_ENV !== 'test',
  })

  await app.register(cors, { origin: true })
  await app.register(websocket)

  await app.register(healthRoutes, { prefix: '/api' })

  return app
}
