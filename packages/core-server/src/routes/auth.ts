import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { AuthService, AuthError } from '../services/AuthService.js'
import { authenticate } from '../middleware/authenticate.js'

const LoginBody = z.object({
  email: z.string().email(),
  password: z.string().min(1),
})

const RefreshBody = z.object({
  refreshToken: z.string().min(1),
})

const LogoutBody = z.object({
  refreshToken: z.string().min(1),
})

export async function authRoutes(app: FastifyInstance): Promise<void> {
  const authService = new AuthService(app)

  app.post('/auth/login', async (request, reply) => {
    const parsed = LoginBody.safeParse(request.body)
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Validation failed', details: parsed.error.flatten() })
    }

    try {
      const result = await authService.login(parsed.data.email, parsed.data.password)
      return reply.send(result)
    } catch (err) {
      if (err instanceof AuthError) {
        return reply.status(err.statusCode).send({ error: 'Invalid credentials' })
      }
      throw err
    }
  })

  app.post('/auth/refresh', async (request, reply) => {
    const parsed = RefreshBody.safeParse(request.body)
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Validation failed' })
    }

    try {
      const tokens = await authService.refreshAccessToken(parsed.data.refreshToken)
      return reply.send(tokens)
    } catch (err) {
      if (err instanceof AuthError) {
        return reply.status(err.statusCode).send({ error: err.message })
      }
      throw err
    }
  })

  app.post('/auth/logout', { preHandler: [authenticate] }, async (request, reply) => {
    const parsed = LogoutBody.safeParse(request.body)
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Validation failed' })
    }

    await authService.logout(parsed.data.refreshToken)
    return reply.status(204).send()
  })
}
