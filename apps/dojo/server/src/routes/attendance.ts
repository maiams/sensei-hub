import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { z } from 'zod'
import {
  CreateAttendanceRequestInput,
  CreateEnrollmentInput,
  CreateLessonInput,
  CreateTrainingClassInput,
  UpdateTrainingClassInput,
  EndEnrollmentInput,
  RejectAttendanceRequestInput,
  DirectAttendanceInput,
  CorrectAttendanceInput,
} from '@dojo/shared'
import { authenticate, withIdempotency, type AuthCtx } from '@sensei-hub/core-server'
import { AttendanceService, AttendanceServiceError } from '../services/AttendanceService.js'

const ListLessonsQuery = z.object({
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  classId: z.string().optional(),
})

const ListAttendanceQuery = z.object({
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
})

const OPERATOR_ROLES = ['coach', 'academy_admin', 'super_admin'] as const

async function attendanceOperator(request: FastifyRequest, reply: FastifyReply) {
  if (!OPERATOR_ROLES.includes(request.authUser.role as typeof OPERATOR_ROLES[number])) {
    await reply.status(403).send({ error: 'Forbidden' })
  }
}

async function athleteOnly(request: FastifyRequest, reply: FastifyReply) {
  if (request.authUser.role !== 'athlete') await reply.status(403).send({ error: 'Forbidden' })
}

function ctx(request: FastifyRequest): AuthCtx {
  return {
    userId: request.authUser.id,
    academyId: request.authUser.academyId,
    role: request.authUser.role,
    sessionId: request.id,
    ip: request.ip,
  }
}

function idempotencyKey(request: FastifyRequest): string | undefined {
  const value = request.headers['idempotency-key']
  return Array.isArray(value) ? value[0] : value
}

function parseOr400<T>(schema: z.ZodType<T>, value: unknown, reply: FastifyReply): T | undefined {
  const parsed = schema.safeParse(value)
  if (!parsed.success) {
    void reply.status(400).send({ error: 'Validation failed', details: parsed.error.flatten() })
    return undefined
  }
  return parsed.data
}

function handleError(err: unknown, reply: FastifyReply) {
  if (err instanceof AttendanceServiceError) return reply.status(err.statusCode).send({ error: err.message })
  throw err
}

export async function attendanceRoutes(app: FastifyInstance): Promise<void> {
  const service = new AttendanceService()

  app.get('/classes', { preHandler: [authenticate] }, async (request) => service.listClasses(request.authUser.academyId))

  app.post('/classes', { preHandler: [authenticate, attendanceOperator] }, async (request, reply) => {
    const data = parseOr400(CreateTrainingClassInput, request.body, reply); if (!data) return
    try { return reply.status(201).send(await service.createClass(data, ctx(request))) } catch (err) { return handleError(err, reply) }
  })

  app.patch('/classes/:id', { preHandler: [authenticate, attendanceOperator] }, async (request, reply) => {
    const data = parseOr400(UpdateTrainingClassInput, request.body, reply); if (!data) return
    try { return reply.send(await service.updateClass((request.params as { id: string }).id, data, ctx(request))) } catch (err) { return handleError(err, reply) }
  })

  app.get('/classes/:id/enrollments', { preHandler: [authenticate, attendanceOperator] }, async (request, reply) => {
    try { return reply.send(await service.listEnrollments((request.params as { id: string }).id, request.authUser.academyId)) } catch (err) { return handleError(err, reply) }
  })

  app.post('/classes/:id/enrollments', { preHandler: [authenticate, attendanceOperator] }, async (request, reply) => {
    const data = parseOr400(CreateEnrollmentInput, request.body, reply); if (!data) return
    try { return reply.status(201).send(await service.addEnrollment((request.params as { id: string }).id, data.athleteId, ctx(request))) } catch (err) { return handleError(err, reply) }
  })

  app.delete('/enrollments/:id', { preHandler: [authenticate, attendanceOperator] }, async (request, reply) => {
    const data = parseOr400(EndEnrollmentInput, request.body, reply); if (!data) return
    try { await service.endEnrollment((request.params as { id: string }).id, data.reason, ctx(request)); return reply.status(204).send() } catch (err) { return handleError(err, reply) }
  })

  app.get('/lessons', { preHandler: [authenticate] }, async (request, reply) => {
    const data = parseOr400(ListLessonsQuery, request.query, reply); if (!data) return
    try {
      return reply.send(await service.listLessons(request.authUser.academyId, {
        ...(data.from ? { from: new Date(data.from) } : {}), ...(data.to ? { to: new Date(data.to) } : {}),
        ...(data.classId ? { classId: data.classId } : {}), ...(request.authUser.role === 'athlete' ? { athleteUserId: request.authUser.id } : {}),
      }))
    } catch (err) { return handleError(err, reply) }
  })

  app.post('/lessons', { preHandler: [authenticate, attendanceOperator] }, async (request, reply) => {
    const data = parseOr400(CreateLessonInput, request.body, reply); if (!data) return
    try { return reply.status(201).send(await service.createLesson(data, ctx(request))) } catch (err) { return handleError(err, reply) }
  })

  app.get('/student/dashboard', { preHandler: [authenticate, athleteOnly] }, async (request, reply) => {
    try { return reply.send(await service.studentDashboard(ctx(request))) } catch (err) { return handleError(err, reply) }
  })

  app.get('/student/attendance', { preHandler: [authenticate, athleteOnly] }, async (request, reply) => {
    const data = parseOr400(ListAttendanceQuery, request.query, reply); if (!data) return
    try { return reply.send(await service.studentAttendance(ctx(request), data.from ? new Date(data.from) : undefined, data.to ? new Date(data.to) : undefined)) } catch (err) { return handleError(err, reply) }
  })

  app.get('/lessons/:id/roll-call', { preHandler: [authenticate, attendanceOperator] }, async (request, reply) => {
    try { return reply.send(await service.rollCall((request.params as { id: string }).id, ctx(request))) } catch (err) { return handleError(err, reply) }
  })

  app.post('/lessons/:id/attendance-requests', { preHandler: [authenticate, athleteOnly] }, async (request, reply) => {
    const data = parseOr400(CreateAttendanceRequestInput, request.body ?? {}, reply); if (!data) return
    try {
      return await withIdempotency({ key: idempotencyKey(request), route: 'POST /lessons/:id/attendance-requests', academyId: request.authUser.academyId, userId: request.authUser.id, reply,
        run: async () => ({ statusCode: 201, body: await service.requestAttendance((request.params as { id: string }).id, data, ctx(request)) }) })
    } catch (err) { return handleError(err, reply) }
  })

  app.post('/attendance-requests/:id/confirm', { preHandler: [authenticate, attendanceOperator] }, async (request, reply) => {
    try {
      return await withIdempotency({ key: idempotencyKey(request), route: 'POST /attendance-requests/:id/confirm', academyId: request.authUser.academyId, userId: request.authUser.id, reply,
        run: async () => ({ statusCode: 200, body: await service.confirmRequest((request.params as { id: string }).id, ctx(request)) }) })
    } catch (err) { return handleError(err, reply) }
  })

  app.post('/attendance-requests/:id/reject', { preHandler: [authenticate, attendanceOperator] }, async (request, reply) => {
    const data = parseOr400(RejectAttendanceRequestInput, request.body, reply); if (!data) return
    try {
      return await withIdempotency({ key: idempotencyKey(request), route: 'POST /attendance-requests/:id/reject', academyId: request.authUser.academyId, userId: request.authUser.id, reply,
        run: async () => ({ statusCode: 200, body: await service.rejectRequest((request.params as { id: string }).id, data.reason, ctx(request)) }) })
    } catch (err) { return handleError(err, reply) }
  })

  app.post('/lessons/:id/attendance', { preHandler: [authenticate, attendanceOperator] }, async (request, reply) => {
    const data = parseOr400(DirectAttendanceInput, request.body, reply); if (!data) return
    try {
      return await withIdempotency({ key: idempotencyKey(request), route: 'POST /lessons/:id/attendance', academyId: request.authUser.academyId, userId: request.authUser.id, reply,
        run: async () => ({ statusCode: 200, body: await service.directPresence((request.params as { id: string }).id, data.athleteId, data.reason, ctx(request)) }) })
    } catch (err) { return handleError(err, reply) }
  })

  app.post('/attendance/:id/correct', { preHandler: [authenticate, attendanceOperator] }, async (request, reply) => {
    const data = parseOr400(CorrectAttendanceInput, request.body, reply); if (!data) return
    try {
      return await withIdempotency({ key: idempotencyKey(request), route: 'POST /attendance/:id/correct', academyId: request.authUser.academyId, userId: request.authUser.id, reply,
        run: async () => ({ statusCode: 200, body: await service.correctAttendance((request.params as { id: string }).id, data.result, data.reason, ctx(request)) }) })
    } catch (err) { return handleError(err, reply) }
  })
}
