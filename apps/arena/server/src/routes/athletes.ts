import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { CreateCompetitorInput, UpdateCompetitorInput } from '@arena/shared'
import { CompetitorService, CompetitorServiceError } from '../services/CompetitorService.js'
import { WeightService, WeightServiceError } from '../services/WeightService.js'
import { authenticate, authorize } from '@sensei-hub/core-server'

const ListAthletesQuery = z.object({
  q: z.string().optional(),
  page: z.coerce.number().int().positive().optional(),
  pageSize: z.coerce.number().int().positive().optional(),
})

// Official event weigh-in outside the entry flow always belongs to an event
const RecordWeightBody = z.object({
  weightKg: z.number().positive().max(300),
  eventId: z.string(),
})

const CorrectWeightBody = z.object({
  weightKg: z.number().positive().max(300),
  reason: z.string().min(3).max(500),
})

export async function athleteRoutes(app: FastifyInstance): Promise<void> {
  const competitorService = new CompetitorService()
  const weightService = new WeightService()

  function handleError(err: unknown, reply: import('fastify').FastifyReply) {
    if (err instanceof CompetitorServiceError || err instanceof WeightServiceError) {
      return reply.status(err.statusCode).send({ error: err.message })
    }
    throw err
  }

  function ctxOf(request: import('fastify').FastifyRequest) {
    return {
      userId: request.authUser.id,
      academyId: request.authUser.academyId,
      role: request.authUser.role,
      sessionId: request.id,
      ip: request.ip,
    }
  }

  // ─── Competitor CRUD ──────────────────────────────────────────────────────

  app.post('/athletes', { preHandler: [authenticate, authorize('staff')] }, async (request, reply) => {
    const parsed = CreateCompetitorInput.safeParse(request.body)
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Validation failed', details: parsed.error.flatten() })
    }
    try {
      const athlete = await competitorService.createCompetitor(parsed.data, ctxOf(request))
      return reply.status(201).send(athlete)
    } catch (err) {
      return handleError(err, reply)
    }
  })

  app.get('/athletes', { preHandler: [authenticate, authorize('staff')] }, async (request, reply) => {
    const parsed = ListAthletesQuery.safeParse(request.query)
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Validation failed', details: parsed.error.flatten() })
    }
    const result = await competitorService.listCompetitors(request.authUser.academyId, parsed.data)
    return reply.send(result)
  })

  app.get('/athletes/:id', { preHandler: [authenticate, authorize('staff')] }, async (request, reply) => {
    const { id } = request.params as { id: string }
    try {
      const athlete = await competitorService.getCompetitor(id, request.authUser.academyId)
      return reply.send(athlete)
    } catch (err) {
      return handleError(err, reply)
    }
  })

  app.patch('/athletes/:id', { preHandler: [authenticate, authorize('staff')] }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const parsed = UpdateCompetitorInput.safeParse(request.body)
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Validation failed', details: parsed.error.flatten() })
    }
    try {
      const athlete = await competitorService.updateCompetitor(id, parsed.data, ctxOf(request))
      return reply.send(athlete)
    } catch (err) {
      return handleError(err, reply)
    }
  })

  // ─── Weigh-in records ─────────────────────────────────────────────────────

  app.post('/athletes/:id/weights', { preHandler: [authenticate, authorize('weigh_in_operator')] }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const parsed = RecordWeightBody.safeParse(request.body)
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Validation failed', details: parsed.error.flatten() })
    }
    try {
      const record = await weightService.recordWeight(id, parsed.data.weightKg, 'manual', ctxOf(request), parsed.data.eventId)
      return reply.status(201).send(record)
    } catch (err) {
      return handleError(err, reply)
    }
  })

  app.get('/athletes/:id/weights', { preHandler: [authenticate, authorize('staff')] }, async (request, reply) => {
    const { id } = request.params as { id: string }
    try {
      const records = await weightService.listWeightRecords(id, request.authUser.academyId)
      return reply.send(records)
    } catch (err) {
      return handleError(err, reply)
    }
  })

  app.post(
    '/athletes/:id/weights/:wid/correct',
    { preHandler: [authenticate, authorize('event_manager')] },
    async (request, reply) => {
      const { wid } = request.params as { id: string; wid: string }
      const parsed = CorrectWeightBody.safeParse(request.body)
      if (!parsed.success) {
        return reply.status(400).send({ error: 'Validation failed', details: parsed.error.flatten() })
      }
      try {
        const record = await weightService.correctWeight(wid, parsed.data.weightKg, parsed.data.reason, ctxOf(request))
        return reply.status(201).send(record)
      } catch (err) {
        return handleError(err, reply)
      }
    },
  )
}
