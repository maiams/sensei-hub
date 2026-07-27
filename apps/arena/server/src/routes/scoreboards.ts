import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { StartScoreboardInput, AddScoreInput, RemoveScoreInput, SetClockInput, StartOsaekomiInput, DeclareWinnerInput, AbortScoreboardInput } from '@arena/shared'
import { ScoreboardService, ScoreboardServiceError, scoreboardEvents } from '../services/ScoreboardService.js'
import { PublicDisplayService, PublicDisplayServiceError } from '../services/PublicDisplayService.js'
import { BracketServiceError } from '../services/BracketService.js'
import { authenticate } from '@sensei-hub/core-server'
import { authorize } from '@sensei-hub/core-server'

export async function scoreboardRoutes(app: FastifyInstance): Promise<void> {
  const service = new ScoreboardService()
  const displayService = new PublicDisplayService()

  function handleError(err: unknown, reply: FastifyReply) {
    if (
      err instanceof ScoreboardServiceError ||
      err instanceof BracketServiceError ||
      err instanceof PublicDisplayServiceError
    ) {
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

  const operator = { preHandler: [authenticate, authorize('scoreboard_operator')] }
  // Abort is not a mesário action anymore: once a fight starts, the only way
  // out is a declared result (ippon/hansoku-make/wo/desistência/decisão). A
  // wrong-athletes start still needs an escape hatch, so it stays available
  // one tier up (event_manager+), reason-required and audited — see
  // ScoreboardService#abortScoreboard.
  const abortRole = { preHandler: [authenticate, authorize('event_manager')] }

  app.post('/events/:id/areas/:aid/scoreboard', operator, async (request, reply) => {
    const { id, aid } = request.params as { id: string; aid: string }
    const parsed = StartScoreboardInput.safeParse(request.body)
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Validation failed', details: parsed.error.flatten() })
    }
    try {
      const dto = await service.startScoreboard(id, request.authUser.academyId, aid, parsed.data.matchId, ctxFrom(request))
      return reply.status(201).send(dto)
    } catch (err) {
      return handleError(err, reply)
    }
  })

  app.get('/scoreboards/:sid', operator, async (request, reply) => {
    const { sid } = request.params as { sid: string }
    try {
      return reply.send(await service.getScoreboard(sid, request.authUser.academyId))
    } catch (err) {
      return handleError(err, reply)
    }
  })

  app.post('/scoreboards/:sid/clock/start', operator, async (request, reply) => {
    const { sid } = request.params as { sid: string }
    try {
      return reply.send(await service.startClock(sid, request.authUser.academyId, ctxFrom(request)))
    } catch (err) {
      return handleError(err, reply)
    }
  })

  app.post('/scoreboards/:sid/clock/pause', operator, async (request, reply) => {
    const { sid } = request.params as { sid: string }
    try {
      return reply.send(await service.pauseClock(sid, request.authUser.academyId, ctxFrom(request)))
    } catch (err) {
      return handleError(err, reply)
    }
  })

  app.post('/scoreboards/:sid/clock/set', operator, async (request, reply) => {
    const { sid } = request.params as { sid: string }
    const parsed = SetClockInput.safeParse(request.body)
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Validation failed', details: parsed.error.flatten() })
    }
    try {
      return reply.send(
        await service.setClock(sid, request.authUser.academyId, parsed.data.clockMs, parsed.data.reason, ctxFrom(request)),
      )
    } catch (err) {
      return handleError(err, reply)
    }
  })

  app.post('/scoreboards/:sid/score', operator, async (request, reply) => {
    const { sid } = request.params as { sid: string }
    const parsed = AddScoreInput.safeParse(request.body)
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Validation failed', details: parsed.error.flatten() })
    }
    try {
      return reply.send(
        await service.addScore(sid, request.authUser.academyId, parsed.data.side, parsed.data.type, ctxFrom(request)),
      )
    } catch (err) {
      return handleError(err, reply)
    }
  })

  app.post('/scoreboards/:sid/score/remove', operator, async (request, reply) => {
    const { sid } = request.params as { sid: string }
    const parsed = RemoveScoreInput.safeParse(request.body)
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Validation failed', details: parsed.error.flatten() })
    }
    try {
      return reply.send(
        await service.removeScoreCorrection(
          sid,
          request.authUser.academyId,
          parsed.data.side,
          parsed.data.type,
          parsed.data.reason,
          ctxFrom(request),
        ),
      )
    } catch (err) {
      return handleError(err, reply)
    }
  })

  app.post('/scoreboards/:sid/osaekomi/start', operator, async (request, reply) => {
    const { sid } = request.params as { sid: string }
    const parsed = StartOsaekomiInput.safeParse(request.body)
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Validation failed', details: parsed.error.flatten() })
    }
    try {
      return reply.send(
        await service.startOsaekomi(sid, request.authUser.academyId, parsed.data.holder, ctxFrom(request)),
      )
    } catch (err) {
      return handleError(err, reply)
    }
  })

  app.post('/scoreboards/:sid/osaekomi/stop', operator, async (request, reply) => {
    const { sid } = request.params as { sid: string }
    try {
      return reply.send(await service.stopOsaekomi(sid, request.authUser.academyId, ctxFrom(request)))
    } catch (err) {
      return handleError(err, reply)
    }
  })

  app.post('/scoreboards/:sid/golden-score', operator, async (request, reply) => {
    const { sid } = request.params as { sid: string }
    try {
      return reply.send(await service.enterGoldenScore(sid, request.authUser.academyId, ctxFrom(request)))
    } catch (err) {
      return handleError(err, reply)
    }
  })

  app.post('/scoreboards/:sid/winner', operator, async (request, reply) => {
    const { sid } = request.params as { sid: string }
    const parsed = DeclareWinnerInput.safeParse(request.body)
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Validation failed', details: parsed.error.flatten() })
    }
    try {
      return reply.send(
        await service.declareWinner(
          sid,
          request.authUser.academyId,
          parsed.data.winnerId,
          parsed.data.method,
          ctxFrom(request),
        ),
      )
    } catch (err) {
      return handleError(err, reply)
    }
  })

  app.post('/scoreboards/:sid/abort', abortRole, async (request, reply) => {
    const { sid } = request.params as { sid: string }
    const parsed = AbortScoreboardInput.safeParse(request.body)
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Validation failed', details: parsed.error.flatten() })
    }
    try {
      return reply.send(
        await service.abortScoreboard(sid, request.authUser.academyId, parsed.data.reason, ctxFrom(request)),
      )
    } catch (err) {
      return handleError(err, reply)
    }
  })

  // ─── Public (no auth): payloads are privacy-filtered (publicName only) ──

  app.get('/public/areas/:areaId/scoreboard', async (request, reply) => {
    const { areaId } = request.params as { areaId: string }
    const dto = await service.getPublicScoreboardForArea(areaId)
    return reply.send({ scoreboard: dto })
  })

  // Venue board (judoinfo-equivalent): each mat's current fight + the
  // upcoming queue with rest countdowns. Polled by the display page.
  app.get('/public/events/:id/display', async (request, reply) => {
    const { id } = request.params as { id: string }
    try {
      return reply.send(await displayService.getEventDisplay(id))
    } catch (err) {
      return handleError(err, reply)
    }
  })

  // Live feed for the public display: sends the area's current scoreboard on
  // connect, then every committed mutation. Read-only — inbound messages are
  // ignored. No auth by design (it's the gym's TV), and the payload is the
  // same privacy-filtered public DTO as the GET above.
  app.get('/public/areas/:areaId/ws', { websocket: true }, (socket, request) => {
    const { areaId } = request.params as { areaId: string }
    const channel = `area:${areaId}`

    const send = (payload: unknown) => {
      if (socket.readyState === socket.OPEN) {
        socket.send(JSON.stringify({ type: 'scoreboard', scoreboard: payload }))
      }
    }

    scoreboardEvents.on(channel, send)
    void service.getPublicScoreboardForArea(areaId).then((dto) => {
      if (dto) send(dto)
    })

    socket.on('close', () => {
      scoreboardEvents.off(channel, send)
    })
  })
}
