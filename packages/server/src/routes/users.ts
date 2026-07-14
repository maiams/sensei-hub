import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { UserRole } from '@sensei-hub/shared'
import { UserService, UserServiceError } from '../services/UserService.js'
import { authenticate } from '../middleware/authenticate.js'
import { authorize } from '../middleware/authorize.js'

// academyId is NOT accepted from body — it comes from the JWT
const CreateUserBody = z.object({
  email: z.string().email(),
  name: z.string().min(2).max(120),
  password: z.string().min(8),
  role: UserRole,
})

const ChangePasswordBody = z.object({
  oldPassword: z.string().min(1),
  newPassword: z.string().min(8),
})

export async function userRoutes(app: FastifyInstance): Promise<void> {
  const userService = new UserService()

  app.post(
    '/users',
    { preHandler: [authenticate, authorize('academy_admin')] },
    async (request, reply) => {
      const parsed = CreateUserBody.safeParse(request.body)
      if (!parsed.success) {
        return reply.status(400).send({ error: 'Validation failed', details: parsed.error.flatten() })
      }

      const { email, name, password, role } = parsed.data

      try {
        const user = await userService.createUser({
          academyId: request.authUser.academyId,
          email,
          name,
          password,
          role,
          createdById: request.authUser.id,
          createdByRole: request.authUser.role,
          sessionId: request.id,
          ip: request.ip,
        })
        return reply.status(201).send(user)
      } catch (err) {
        if (err instanceof UserServiceError) {
          return reply.status(err.statusCode).send({ error: err.message })
        }
        throw err
      }
    },
  )

  app.get(
    '/users',
    { preHandler: [authenticate, authorize('coach')] },
    async (request, reply) => {
      const users = await userService.listUsers(request.authUser.academyId)
      return reply.send(users)
    },
  )

  app.patch(
    '/users/me/password',
    { preHandler: [authenticate] },
    async (request, reply) => {
      const parsed = ChangePasswordBody.safeParse(request.body)
      if (!parsed.success) {
        return reply.status(400).send({ error: 'Validation failed', details: parsed.error.flatten() })
      }

      const { oldPassword, newPassword } = parsed.data

      try {
        await userService.changePassword({
          userId: request.authUser.id,
          oldPassword,
          newPassword,
          sessionId: request.id,
          ip: request.ip,
        })
        return reply.status(204).send()
      } catch (err) {
        if (err instanceof UserServiceError) {
          return reply.status(err.statusCode).send({ error: err.message })
        }
        throw err
      }
    },
  )
}
