import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { CheckInInput, UndoCheckInInput } from '@sensei-hub/shared'
import { CheckInService, CheckInServiceError } from '../services/CheckInService.js'
import { scaleAdapter } from '../adapters/ScaleAdapter.js'
import { authenticate } from '../middleware/authenticate.js'
import { authorize } from '../middleware/authorize.js'

export async function checkInRoutes(app: FastifyInstance): Promise<void> {
  const service = new CheckInService()

  function handleError(err: unknown, reply: FastifyReply) {
    if (err instanceof CheckInServiceError) {
      return reply.status(err.statusCode).send({ error: err.message, ...(err.details ? { details: err.details } : {}) })
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

  app.post('/events/:id/checkin', { preHandler: [authenticate, authorize('staff')] }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const parsed = CheckInInput.safeParse(request.body)
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Validation failed', details: parsed.error.flatten() })
    }
    try {
      const attendance = await service.checkIn(
        id,
        request.authUser.academyId,
        parsed.data.athleteId,
        parsed.data.method,
        ctxFrom(request),
      )
      return reply.status(201).send(attendance)
    } catch (err) {
      return handleError(err, reply)
    }
  })

  app.delete(
    '/events/:id/checkin/:aid',
    { preHandler: [authenticate, authorize('event_manager')] },
    async (request, reply) => {
      const { id, aid } = request.params as { id: string; aid: string }
      const parsed = UndoCheckInInput.safeParse(request.body)
      if (!parsed.success) {
        return reply.status(400).send({ error: 'Validation failed', details: parsed.error.flatten() })
      }
      try {
        const attendance = await service.undoCheckIn(id, request.authUser.academyId, aid, parsed.data.reason, ctxFrom(request))
        return reply.send(attendance)
      } catch (err) {
        return handleError(err, reply)
      }
    },
  )

  app.get('/events/:id/checkin', { preHandler: [authenticate, authorize('staff')] }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const { status } = request.query as { status?: 'active' | 'revoked' }
    try {
      const records = await service.listAttendance(id, request.authUser.academyId, status ? { status } : {})
      return reply.send(records)
    } catch (err) {
      return handleError(err, reply)
    }
  })

  // Weigh-in station: reads the shared ScaleAdapter instance (mock today —
  // see adapters/ScaleAdapter.ts). Never blocks weigh-in: a null/disconnected
  // reading just means the UI falls back to manual entry.
  app.get('/scale/reading', { preHandler: [authenticate, authorize('weigh_in_operator')] }, async (_request, reply) => {
    const connected = scaleAdapter.isConnected()
    const reading = connected ? await scaleAdapter.getLatestReading() : null
    return reply.send({
      connected,
      reading: reading ? { weightKg: reading.weightKg, timestamp: reading.timestamp.toISOString() } : null,
    })
  })
}
