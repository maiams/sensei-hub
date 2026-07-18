import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { CreateAreaInput, UpdateAreaInput, CloseAreaInput, ForceMatchInput } from '@sensei-hub/shared'
import { AreaService, AreaServiceError } from '../services/AreaService.js'
import { MatchDispatchService, MatchDispatchServiceError } from '../services/MatchDispatchService.js'
import { authenticate } from '../middleware/authenticate.js'
import { authorize } from '../middleware/authorize.js'

export async function areaRoutes(app: FastifyInstance): Promise<void> {
  const areaService = new AreaService()
  const dispatchService = new MatchDispatchService()

  function handleError(err: unknown, reply: FastifyReply) {
    if (err instanceof AreaServiceError || err instanceof MatchDispatchServiceError) {
      return reply.status(err.statusCode).send({ error: err.message })
    }
    throw err
  }

  function ctxFrom(request: FastifyRequest) {
    return {
      userId: request.authUser.id,
      academyId: request.authUser.academyId,
      role: request.authUser.role,
      sessionId: request.id,
      ip: request.ip,
    }
  }

  app.post('/events/:id/areas', { preHandler: [authenticate, authorize('event_manager')] }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const parsed = CreateAreaInput.safeParse(request.body)
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Validation failed', details: parsed.error.flatten() })
    }
    try {
      const area = await areaService.createArea(id, request.authUser.academyId, parsed.data, ctxFrom(request))
      return reply.status(201).send(area)
    } catch (err) {
      return handleError(err, reply)
    }
  })

  app.get(
    '/events/:id/areas',
    { preHandler: [authenticate, authorize('scoreboard_operator')] },
    async (request, reply) => {
      const { id } = request.params as { id: string }
      try {
        const areas = await areaService.listAreas(id, request.authUser.academyId)
        return reply.send(areas)
      } catch (err) {
        return handleError(err, reply)
      }
    },
  )

  app.get(
    '/events/:id/areas/unroutable-matches',
    { preHandler: [authenticate, authorize('scoreboard_operator')] },
    async (request, reply) => {
      const { id } = request.params as { id: string }
      try {
        const matches = await areaService.listUnroutableMatches(id, request.authUser.academyId)
        return reply.send(matches)
      } catch (err) {
        return handleError(err, reply)
      }
    },
  )

  app.patch(
    '/events/:id/areas/:aid',
    { preHandler: [authenticate, authorize('event_manager')] },
    async (request, reply) => {
      const { id, aid } = request.params as { id: string; aid: string }
      const parsed = UpdateAreaInput.safeParse(request.body)
      if (!parsed.success) {
        return reply.status(400).send({ error: 'Validation failed', details: parsed.error.flatten() })
      }
      try {
        const area = await areaService.updateArea(id, request.authUser.academyId, aid, parsed.data, ctxFrom(request))
        return reply.send(area)
      } catch (err) {
        return handleError(err, reply)
      }
    },
  )

  app.delete(
    '/events/:id/areas/:aid',
    { preHandler: [authenticate, authorize('event_manager')] },
    async (request, reply) => {
      const { id, aid } = request.params as { id: string; aid: string }
      try {
        await areaService.deleteArea(id, request.authUser.academyId, aid, ctxFrom(request))
        return reply.status(204).send()
      } catch (err) {
        return handleError(err, reply)
      }
    },
  )

  // The operator closing their own mat (shared login, no per-person account —
  // see docs/status-e-plano.md Fase 4A) needs only scoreboard_operator+;
  // reopening/reconfiguring is an organizer action (event_manager+).
  app.patch(
    '/events/:id/areas/:aid/close',
    { preHandler: [authenticate, authorize('scoreboard_operator')] },
    async (request, reply) => {
      const { id, aid } = request.params as { id: string; aid: string }
      const parsed = CloseAreaInput.safeParse(request.body)
      if (!parsed.success) {
        return reply.status(400).send({ error: 'Validation failed', details: parsed.error.flatten() })
      }
      try {
        const result = await areaService.closeArea(id, request.authUser.academyId, aid, parsed.data.reason, ctxFrom(request))
        return reply.send(result)
      } catch (err) {
        return handleError(err, reply)
      }
    },
  )

  app.patch(
    '/events/:id/areas/:aid/reopen',
    { preHandler: [authenticate, authorize('event_manager')] },
    async (request, reply) => {
      const { id, aid } = request.params as { id: string; aid: string }
      try {
        const area = await areaService.reopenArea(id, request.authUser.academyId, aid, ctxFrom(request))
        return reply.send(area)
      } catch (err) {
        return handleError(err, reply)
      }
    },
  )

  app.post(
    '/events/:id/areas/:aid/next-match',
    { preHandler: [authenticate, authorize('scoreboard_operator')] },
    async (request, reply) => {
      const { id, aid } = request.params as { id: string; aid: string }
      try {
        const result = await dispatchService.getNextMatchForArea(id, request.authUser.academyId, aid, ctxFrom(request))
        return reply.send(result)
      } catch (err) {
        return handleError(err, reply)
      }
    },
  )

  // Manual dispatch override — see MatchDispatchService.forceMatchToArea.
  app.post(
    '/events/:id/areas/:aid/force-match',
    { preHandler: [authenticate, authorize('event_manager')] },
    async (request, reply) => {
      const { id, aid } = request.params as { id: string; aid: string }
      const parsed = ForceMatchInput.safeParse(request.body)
      if (!parsed.success) {
        return reply.status(400).send({ error: 'Validation failed', details: parsed.error.flatten() })
      }
      try {
        const result = await dispatchService.forceMatchToArea(
          id,
          request.authUser.academyId,
          aid,
          parsed.data.matchId,
          parsed.data.ignoreRest ?? false,
          ctxFrom(request),
        )
        return reply.send(result)
      } catch (err) {
        return handleError(err, reply)
      }
    },
  )
}
