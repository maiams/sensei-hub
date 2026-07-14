import Fastify, { type FastifyInstance } from 'fastify'
import cors from '@fastify/cors'
import websocket from '@fastify/websocket'
import jwt from '@fastify/jwt'
import { healthRoutes } from './routes/health.js'
import { setupRoutes } from './routes/setup.js'
import { authRoutes } from './routes/auth.js'
import { userRoutes } from './routes/users.js'
import { athleteRoutes } from './routes/athletes.js'
import { divisionTemplateRoutes } from './routes/divisionTemplates.js'
import { env } from './config/env.js'

export async function buildApp(): Promise<FastifyInstance> {
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

  return app
}
