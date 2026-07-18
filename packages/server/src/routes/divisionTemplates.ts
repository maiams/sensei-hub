import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { CreateDivisionTemplateInput, UpdateDivisionTemplateInput, CreateDivisionGroupInput, UpdateDivisionGroupInput } from '@sensei-hub/shared'
import { DivisionTemplateService, DivisionTemplateServiceError } from '../services/DivisionTemplateService.js'
import { DivisionGroupService, DivisionGroupServiceError } from '../services/DivisionGroupService.js'
import { authenticate } from '@sensei-hub/core-server'
import { authorize } from '@sensei-hub/core-server'

export async function divisionTemplateRoutes(app: FastifyInstance): Promise<void> {
  const templateService = new DivisionTemplateService()
  const groupService = new DivisionGroupService()

  function handleError(err: unknown, reply: FastifyReply) {
    if (err instanceof DivisionTemplateServiceError || err instanceof DivisionGroupServiceError) {
      return reply.status(err.statusCode).send({ error: err.message })
    }
    throw err
  }

  function ctxFrom(request: FastifyRequest) {
    return {
      userId: request.authUser.id,
      academyId: request.authUser.academyId,
      sessionId: request.id,
      ip: request.ip,
    }
  }

  // ─── Divisions ───────────────────────────────────────────────────────────

  app.get('/division-templates', { preHandler: [authenticate, authorize('staff')] }, async (request, reply) => {
    const templates = await templateService.listTemplates(request.authUser.academyId)
    return reply.send(templates)
  })

  app.post('/division-templates', { preHandler: [authenticate, authorize('academy_admin')] }, async (request, reply) => {
    const parsed = CreateDivisionTemplateInput.safeParse(request.body)
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Validation failed', details: parsed.error.flatten() })
    }
    const template = await templateService.createTemplate(request.authUser.academyId, parsed.data, ctxFrom(request))
    return reply.status(201).send(template)
  })

  app.post(
    '/division-templates/load-preset',
    { preHandler: [authenticate, authorize('academy_admin')] },
    async (request, reply) => {
      const created = await templateService.loadFpjPreset(request.authUser.academyId, ctxFrom(request))
      return reply.status(201).send(created)
    },
  )

  app.patch(
    '/division-templates/:key',
    { preHandler: [authenticate, authorize('academy_admin')] },
    async (request, reply) => {
      const { key } = request.params as { key: string }
      const parsed = UpdateDivisionTemplateInput.safeParse(request.body)
      if (!parsed.success) {
        return reply.status(400).send({ error: 'Validation failed', details: parsed.error.flatten() })
      }
      try {
        const template = await templateService.updateTemplate(request.authUser.academyId, key, parsed.data, ctxFrom(request))
        return reply.send(template)
      } catch (err) {
        return handleError(err, reply)
      }
    },
  )

  app.delete(
    '/division-templates/:key',
    { preHandler: [authenticate, authorize('academy_admin')] },
    async (request, reply) => {
      const { key } = request.params as { key: string }
      try {
        await templateService.deleteTemplate(request.authUser.academyId, key, ctxFrom(request))
        return reply.status(204).send()
      } catch (err) {
        return handleError(err, reply)
      }
    },
  )

  // ─── Groups ──────────────────────────────────────────────────────────────

  app.get(
    '/division-templates/:key/groups',
    { preHandler: [authenticate, authorize('staff')] },
    async (request, reply) => {
      const { key } = request.params as { key: string }
      try {
        const groups = await groupService.listGroups(request.authUser.academyId, key)
        return reply.send(groups)
      } catch (err) {
        return handleError(err, reply)
      }
    },
  )

  app.post(
    '/division-templates/:key/groups',
    { preHandler: [authenticate, authorize('academy_admin')] },
    async (request, reply) => {
      const { key } = request.params as { key: string }
      const parsed = CreateDivisionGroupInput.safeParse(request.body)
      if (!parsed.success) {
        return reply.status(400).send({ error: 'Validation failed', details: parsed.error.flatten() })
      }
      try {
        const group = await groupService.createGroup(request.authUser.academyId, key, parsed.data, ctxFrom(request))
        return reply.status(201).send(group)
      } catch (err) {
        return handleError(err, reply)
      }
    },
  )

  app.patch(
    '/division-templates/:key/groups/:groupId',
    { preHandler: [authenticate, authorize('academy_admin')] },
    async (request, reply) => {
      const { key, groupId } = request.params as { key: string; groupId: string }
      const parsed = UpdateDivisionGroupInput.safeParse(request.body)
      if (!parsed.success) {
        return reply.status(400).send({ error: 'Validation failed', details: parsed.error.flatten() })
      }
      try {
        const group = await groupService.updateGroup(request.authUser.academyId, key, groupId, parsed.data, ctxFrom(request))
        return reply.send(group)
      } catch (err) {
        return handleError(err, reply)
      }
    },
  )

  app.delete(
    '/division-templates/:key/groups/:groupId',
    { preHandler: [authenticate, authorize('academy_admin')] },
    async (request, reply) => {
      const { key, groupId } = request.params as { key: string; groupId: string }
      try {
        await groupService.deleteGroup(request.authUser.academyId, key, groupId, ctxFrom(request))
        return reply.status(204).send()
      } catch (err) {
        return handleError(err, reply)
      }
    },
  )

  app.post(
    '/division-templates/:key/groups/:groupId/restore',
    { preHandler: [authenticate, authorize('academy_admin')] },
    async (request, reply) => {
      const { key, groupId } = request.params as { key: string; groupId: string }
      try {
        const group = await groupService.restoreFromPreset(request.authUser.academyId, key, groupId, ctxFrom(request))
        return reply.send(group)
      } catch (err) {
        return handleError(err, reply)
      }
    },
  )
}
