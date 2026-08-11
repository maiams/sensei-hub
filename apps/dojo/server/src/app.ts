import Fastify, { type FastifyInstance } from 'fastify'
import cors from '@fastify/cors'
import jwt from '@fastify/jwt'
import { healthRoutes, setupRoutes, authRoutes, userRoutes } from '@sensei-hub/core-server'
import { athleteRoutes } from './routes/athletes.js'
import { attendanceRoutes } from './routes/attendance.js'
import { env } from './config/env.js'

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: env.NODE_ENV !== 'test',
  })

  await app.register(cors, { origin: true })
  await app.register(jwt, {
    secret: env.JWT_SECRET,
    sign: { expiresIn: env.JWT_EXPIRES_IN },
  })

  await app.register(healthRoutes, { prefix: '/api' })
  await app.register(setupRoutes, { prefix: '/api' })
  await app.register(authRoutes, { prefix: '/api' })
  await app.register(userRoutes, { prefix: '/api' })
  await app.register(athleteRoutes, { prefix: '/api' })
  await app.register(attendanceRoutes, { prefix: '/api' })

  return app
}
