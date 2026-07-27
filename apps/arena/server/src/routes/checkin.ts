import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { CheckInInput, UndoCheckInInput } from '@arena/shared'
import { CheckInService, CheckInServiceError } from '../services/CheckInService.js'
import { scaleAdapter } from '../adapters/ScaleAdapter.js'
import { authenticate, withIdempotency, type IdempotentResult } from '@sensei-hub/core-server'
import { authorize } from '@sensei-hub/core-server'

export async function checkInRoutes(app: FastifyInstance): Promise<void> {
  const service = new CheckInService()

  function errorResult(err: unknown): IdempotentResult {
    if (err instanceof CheckInServiceError) {
      return { statusCode: err.statusCode, body: { error: err.message, ...(err.details ? { details: err.details } : {}) } }
    }
    throw err
  }

  function handleError(err: unknown, reply: FastifyReply) {
    if (err instanceof CheckInServiceError) {
      return reply.status(err.statusCode).send({ error: err.message, ...(err.details ? { details: err.details } : {}) })
    }
    throw err
  }

  // Client-side headers set only when the request came through the durable
  // offline queue (apps/arena/web/src/lib/offlineQueue.ts) — see AuthCtx's
  // doc comment (packages/core-server/src/context.ts) for why each exists.
  // A request without these headers (the normal online case) just omits
  // them from ctx, unaffected.
  function offlineMeta(request: FastifyRequest) {
    const stationId = request.headers['x-station-id']
    const clientSeqHeader = request.headers['x-client-seq']
    const occurredAt = request.headers['x-occurred-at']
    const clientSeq = typeof clientSeqHeader === 'string' ? Number.parseInt(clientSeqHeader, 10) : NaN
    return {
      ...(typeof stationId === 'string' && stationId.length > 0 ? { stationId } : {}),
      ...(Number.isFinite(clientSeq) ? { clientSeq } : {}),
      ...(typeof occurredAt === 'string' && occurredAt.length > 0 ? { occurredAt } : {}),
    }
  }

  function ctxFrom(request: FastifyRequest) {
    return {
      userId: request.authUser.id,
      academyId: request.authUser.academyId,
      role: request.authUser.role,
      sessionId: request.id,
      ip: request.ip,
      ...offlineMeta(request),
    }
  }

  function idempotencyKeyFrom(request: FastifyRequest): string | undefined {
    const header = request.headers['idempotency-key']
    return typeof header === 'string' && header.length > 0 ? header : undefined
  }

  app.post('/events/:id/checkin', { preHandler: [authenticate, authorize('staff')] }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const parsed = CheckInInput.safeParse(request.body)
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Validation failed', details: parsed.error.flatten() })
    }
    // Check-in is one of the two flows the offline queue replays (the other
    // is weigh-in, apps/arena/server/src/routes/events.ts). A queued
    // check-in resent after a connectivity gap must return the SAME
    // Attendance it already created, not a fresh 409 "already checked in" —
    // withIdempotency makes that replay transparent when the client sends
    // an Idempotency-Key (see offlineQueue.ts).
    return withIdempotency({
      key: idempotencyKeyFrom(request),
      route: 'POST /events/:id/checkin',
      academyId: request.authUser.academyId,
      userId: request.authUser.id,
      reply,
      run: async (): Promise<IdempotentResult> => {
        try {
          const attendance = await service.checkIn(
            id,
            request.authUser.academyId,
            parsed.data.athleteId,
            parsed.data.method,
            ctxFrom(request),
          )
          return { statusCode: 201, body: attendance }
        } catch (err) {
          return errorResult(err)
        }
      },
    })
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
