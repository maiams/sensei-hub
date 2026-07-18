import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import multipart from '@fastify/multipart'
import { ImportService, ImportServiceError } from '../services/ImportService.js'
import { authenticate } from '../middleware/authenticate.js'
import { authorize } from '../middleware/authorize.js'

export async function importRoutes(app: FastifyInstance): Promise<void> {
  // Registered inside this plugin's own encapsulation context, so the
  // multipart parser only applies to these routes.
  await app.register(multipart, {
    limits: { fileSize: 5 * 1024 * 1024 }, // 5MB is plenty for a roster spreadsheet
  })

  const importService = new ImportService()

  function handleError(err: unknown, reply: FastifyReply) {
    if (err instanceof ImportServiceError) {
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

  app.get(
    '/events/:id/import/template',
    { preHandler: [authenticate, authorize('event_manager')] },
    async (_request, reply) => {
      const buffer = importService.getTemplate()
      return reply
        .header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
        .header('Content-Disposition', 'attachment; filename="modelo-importacao-atletas.xlsx"')
        .send(buffer)
    },
  )

  app.post(
    '/events/:id/import',
    { preHandler: [authenticate, authorize('event_manager')] },
    async (request, reply) => {
      const { id } = request.params as { id: string }
      const file = await request.file()
      if (!file) {
        return reply.status(400).send({ error: 'No file uploaded' })
      }
      const buffer = await file.toBuffer()
      try {
        const job = await importService.runImport(buffer, file.filename, id, request.authUser.academyId, ctxFrom(request))
        return reply.status(201).send(job)
      } catch (err) {
        return handleError(err, reply)
      }
    },
  )

  app.get(
    '/events/:id/import/jobs',
    { preHandler: [authenticate, authorize('event_manager')] },
    async (request, reply) => {
      const { id } = request.params as { id: string }
      try {
        const jobs = await importService.listImportJobs(id, request.authUser.academyId)
        return reply.send(jobs)
      } catch (err) {
        return handleError(err, reply)
      }
    },
  )

  app.get(
    '/events/:id/import/jobs/:jid',
    { preHandler: [authenticate, authorize('event_manager')] },
    async (request, reply) => {
      const { id, jid } = request.params as { id: string; jid: string }
      try {
        const job = await importService.getImportJob(id, request.authUser.academyId, jid)
        return reply.send(job)
      } catch (err) {
        return handleError(err, reply)
      }
    },
  )
}
