import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { CreateAthleteInput, UpdateAthleteInput, CreateBeltRecordInput, RecordWeightInput, CorrectWeightInput, CreateGuardianInput } from '@sensei-hub/shared'
import { AthleteService, AthleteServiceError } from '../services/AthleteService.js'
import { WeightService, WeightServiceError } from '../services/WeightService.js'
import { authenticate } from '../middleware/authenticate.js'
import { authorize } from '../middleware/authorize.js'

// academyId is NOT accepted from body — it comes from the JWT
const CreateAthleteBody = CreateAthleteInput.omit({ academyId: true })

const DeactivateAthleteBody = z.object({
  reason: z.string().min(3).max(500),
})

const ListAthletesQuery = z.object({
  q: z.string().optional(),
  page: z.coerce.number().int().positive().optional(),
  pageSize: z.coerce.number().int().positive().optional(),
})

export async function athleteRoutes(app: FastifyInstance): Promise<void> {
  const athleteService = new AthleteService()
  const weightService = new WeightService()

  function handleError(err: unknown, reply: import('fastify').FastifyReply) {
    if (err instanceof AthleteServiceError || err instanceof WeightServiceError) {
      return reply.status(err.statusCode).send({ error: err.message })
    }
    throw err
  }

  // ─── Athlete CRUD ──────────────────────────────────────────────────────────

  app.post('/athletes', { preHandler: [authenticate, authorize('staff')] }, async (request, reply) => {
    const parsed = CreateAthleteBody.safeParse(request.body)
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Validation failed', details: parsed.error.flatten() })
    }
    try {
      const athlete = await athleteService.createAthlete(parsed.data, {
        userId: request.authUser.id,
        academyId: request.authUser.academyId,
        role: request.authUser.role,
        sessionId: request.id,
        ip: request.ip,
      })
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
    const result = await athleteService.listAthletes(request.authUser.academyId, parsed.data)
    return reply.send(result)
  })

  app.get('/athletes/:id', { preHandler: [authenticate, authorize('staff')] }, async (request, reply) => {
    const { id } = request.params as { id: string }
    try {
      const athlete = await athleteService.getAthlete(id, {
        academyId: request.authUser.academyId,
        role: request.authUser.role,
      })
      return reply.send(athlete)
    } catch (err) {
      return handleError(err, reply)
    }
  })

  app.patch('/athletes/:id', { preHandler: [authenticate, authorize('staff')] }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const parsed = UpdateAthleteInput.safeParse(request.body)
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Validation failed', details: parsed.error.flatten() })
    }
    try {
      const athlete = await athleteService.updateAthlete(id, parsed.data, {
        userId: request.authUser.id,
        academyId: request.authUser.academyId,
        role: request.authUser.role,
        sessionId: request.id,
        ip: request.ip,
      })
      return reply.send(athlete)
    } catch (err) {
      return handleError(err, reply)
    }
  })

  app.delete('/athletes/:id', { preHandler: [authenticate, authorize('academy_admin')] }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const parsed = DeactivateAthleteBody.safeParse(request.body)
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Validation failed', details: parsed.error.flatten() })
    }
    try {
      await athleteService.deactivateAthlete(id, parsed.data.reason, {
        userId: request.authUser.id,
        academyId: request.authUser.academyId,
        role: request.authUser.role,
        sessionId: request.id,
        ip: request.ip,
      })
      return reply.status(204).send()
    } catch (err) {
      return handleError(err, reply)
    }
  })

  // ─── Belt records ────────────────────────────────────────────────────────

  app.post('/athletes/:id/belts', { preHandler: [authenticate, authorize('coach')] }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const parsed = CreateBeltRecordInput.safeParse(request.body)
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Validation failed', details: parsed.error.flatten() })
    }
    try {
      const record = await athleteService.addBeltRecord(id, parsed.data, {
        userId: request.authUser.id,
        academyId: request.authUser.academyId,
        role: request.authUser.role,
        sessionId: request.id,
        ip: request.ip,
      })
      return reply.status(201).send(record)
    } catch (err) {
      return handleError(err, reply)
    }
  })

  app.get('/athletes/:id/belts', { preHandler: [authenticate, authorize('staff')] }, async (request, reply) => {
    const { id } = request.params as { id: string }
    try {
      const records = await athleteService.listBeltRecords(id, request.authUser.academyId)
      return reply.send(records)
    } catch (err) {
      return handleError(err, reply)
    }
  })

  // ─── Weight records ──────────────────────────────────────────────────────

  app.post('/athletes/:id/weights', { preHandler: [authenticate, authorize('weigh_in_operator')] }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const parsed = RecordWeightInput.safeParse(request.body)
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Validation failed', details: parsed.error.flatten() })
    }
    try {
      const record = await weightService.recordWeight(
        id,
        parsed.data.weightKg,
        'manual',
        {
          userId: request.authUser.id,
          academyId: request.authUser.academyId,
          role: request.authUser.role,
          sessionId: request.id,
          ip: request.ip,
        },
        parsed.data.eventId,
      )
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
      const parsed = CorrectWeightInput.safeParse(request.body)
      if (!parsed.success) {
        return reply.status(400).send({ error: 'Validation failed', details: parsed.error.flatten() })
      }
      try {
        const record = await weightService.correctWeight(wid, parsed.data.weightKg, parsed.data.reason, {
          userId: request.authUser.id,
          academyId: request.authUser.academyId,
          role: request.authUser.role,
          sessionId: request.id,
          ip: request.ip,
        })
        return reply.status(201).send(record)
      } catch (err) {
        return handleError(err, reply)
      }
    },
  )

  // ─── Guardian ──────────────────────────────────────────────────────────────

  app.post('/athletes/:id/guardian', { preHandler: [authenticate, authorize('staff')] }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const parsed = CreateGuardianInput.safeParse(request.body)
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Validation failed', details: parsed.error.flatten() })
    }
    try {
      const guardian = await athleteService.addGuardian(id, parsed.data, {
        userId: request.authUser.id,
        academyId: request.authUser.academyId,
        role: request.authUser.role,
        sessionId: request.id,
        ip: request.ip,
      })
      return reply.status(201).send(guardian)
    } catch (err) {
      return handleError(err, reply)
    }
  })

  app.get('/athletes/:id/guardian', { preHandler: [authenticate, authorize('staff')] }, async (request, reply) => {
    const { id } = request.params as { id: string }
    try {
      const guardian = await athleteService.getGuardian(id, request.authUser.academyId)
      return reply.send(guardian)
    } catch (err) {
      return handleError(err, reply)
    }
  })
}
