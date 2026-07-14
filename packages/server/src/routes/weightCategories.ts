import type { FastifyInstance } from 'fastify'
import { UpdateWeightCategoriesInput } from '@sensei-hub/shared'
import { WeightCategoryService, WeightCategoryServiceError } from '../services/WeightCategoryService.js'
import { authenticate } from '../middleware/authenticate.js'
import { authorize } from '../middleware/authorize.js'

export async function weightCategoryRoutes(app: FastifyInstance): Promise<void> {
  const service = new WeightCategoryService()

  app.get(
    '/weight-categories',
    { preHandler: [authenticate, authorize('staff')] },
    async (request, reply) => {
      const groups = await service.listGroups(request.authUser.academyId)
      return reply.send(groups)
    },
  )

  app.put(
    '/weight-categories/:groupKey/:gender',
    { preHandler: [authenticate, authorize('academy_admin')] },
    async (request, reply) => {
      const { groupKey, gender } = request.params as { groupKey: string; gender: string }
      if (gender !== 'male' && gender !== 'female') {
        return reply.status(400).send({ error: 'gender must be male or female' })
      }

      const parsed = UpdateWeightCategoriesInput.safeParse(request.body)
      if (!parsed.success) {
        return reply.status(400).send({ error: 'Validation failed', details: parsed.error.flatten() })
      }

      try {
        const group = await service.updateGroup(request.authUser.academyId, groupKey, gender, parsed.data.categories, {
          userId: request.authUser.id,
          sessionId: request.id,
          ip: request.ip,
        })
        return reply.send(group)
      } catch (err) {
        if (err instanceof WeightCategoryServiceError) {
          return reply.status(err.statusCode).send({ error: err.message })
        }
        throw err
      }
    },
  )

  app.delete(
    '/weight-categories/:groupKey/:gender',
    { preHandler: [authenticate, authorize('academy_admin')] },
    async (request, reply) => {
      const { groupKey, gender } = request.params as { groupKey: string; gender: string }
      if (gender !== 'male' && gender !== 'female') {
        return reply.status(400).send({ error: 'gender must be male or female' })
      }

      try {
        const group = await service.resetGroup(request.authUser.academyId, groupKey, gender, {
          userId: request.authUser.id,
          sessionId: request.id,
          ip: request.ip,
        })
        return reply.send(group)
      } catch (err) {
        if (err instanceof WeightCategoryServiceError) {
          return reply.status(err.statusCode).send({ error: err.message })
        }
        throw err
      }
    },
  )
}
