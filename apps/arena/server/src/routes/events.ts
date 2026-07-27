import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { z } from 'zod'
import { CreateEventInput, UpdateEventInput, CreateDivisionInput, UpdateDivisionInput, ImportDivisionsFromTemplatesInput, CreateEventEntryInput, RecordWeighInInput, ConfirmEntryInput, WithdrawEntryInput, EventEntryStatus, GenerateBracketInput, RecordMatchResultInput, CorrectMatchResultInput } from '@arena/shared'
import { EventService, EventServiceError } from '../services/EventService.js'
import { DivisionService, DivisionServiceError } from '../services/DivisionService.js'
import { EventEntryService, EventEntryServiceError } from '../services/EventEntryService.js'
import { BracketService, BracketServiceError } from '../services/BracketService.js'
import { authenticate } from '@sensei-hub/core-server'
import { authorize } from '@sensei-hub/core-server'

const CreateEventBody = CreateEventInput.omit({ hostAcademyId: true })

const ListEntriesQuery = z.object({
  divisionId: z.string().optional(),
  status: EventEntryStatus.optional(),
})

const MatchNumberParam = z.object({
  id: z.string(),
  did: z.string(),
  mid: z.coerce.number().int().positive(),
})

export async function eventRoutes(app: FastifyInstance): Promise<void> {
  const eventService = new EventService()
  const divisionService = new DivisionService()
  const entryService = new EventEntryService()
  const bracketService = new BracketService()

  function handleError(err: unknown, reply: FastifyReply) {
    if (
      err instanceof EventServiceError ||
      err instanceof DivisionServiceError ||
      err instanceof EventEntryServiceError ||
      err instanceof BracketServiceError
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

  // ─── Events ──────────────────────────────────────────────────────────────

  app.post('/events', { preHandler: [authenticate, authorize('event_manager')] }, async (request, reply) => {
    const parsed = CreateEventBody.safeParse(request.body)
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Validation failed', details: parsed.error.flatten() })
    }
    const event = await eventService.createEvent(request.authUser.academyId, parsed.data, ctxFrom(request))
    return reply.status(201).send(event)
  })

  app.get('/events', { preHandler: [authenticate, authorize('staff')] }, async (request, reply) => {
    const events = await eventService.listEvents(request.authUser.academyId)
    return reply.send(events)
  })

  // Post-login landing for scoreboard_operator/weigh_in_operator: they need
  // to know which event is currently running so the app can take them
  // straight to their screen (table operation / weigh-in), but must not see
  // the full event registry (drafts, cancelled, past events). This filters
  // server-side down to {id, name} of only 'in_progress' events.
  app.get('/events/active', { preHandler: [authenticate, authorize('scoreboard_operator')] }, async (request, reply) => {
    const events = await eventService.listEvents(request.authUser.academyId)
    const active = events.filter((e) => e.status === 'in_progress').map((e) => ({ id: e.id, name: e.name }))
    return reply.send(active)
  })

  // scoreboard_operator can read the event itself (name/status/rules) — it
  // needs this to operate its mat. Nothing entry/athlete-related is exposed
  // by this route, so this doesn't leak registration or personal data.
  app.get('/events/:id', { preHandler: [authenticate, authorize('scoreboard_operator')] }, async (request, reply) => {
    const { id } = request.params as { id: string }
    try {
      const event = await eventService.getEvent(id, request.authUser.academyId)
      return reply.send(event)
    } catch (err) {
      return handleError(err, reply)
    }
  })

  app.patch('/events/:id', { preHandler: [authenticate, authorize('event_manager')] }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const parsed = UpdateEventInput.safeParse(request.body)
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Validation failed', details: parsed.error.flatten() })
    }
    try {
      const event = await eventService.updateEvent(id, request.authUser.academyId, parsed.data, ctxFrom(request))
      return reply.send(event)
    } catch (err) {
      return handleError(err, reply)
    }
  })

  // ─── Divisions ───────────────────────────────────────────────────────────

  app.post(
    '/events/:id/divisions',
    { preHandler: [authenticate, authorize('event_manager')] },
    async (request, reply) => {
      const { id } = request.params as { id: string }
      const parsed = CreateDivisionInput.safeParse(request.body)
      if (!parsed.success) {
        return reply.status(400).send({ error: 'Validation failed', details: parsed.error.flatten() })
      }
      try {
        const division = await divisionService.createDivision(id, request.authUser.academyId, parsed.data, ctxFrom(request))
        return reply.status(201).send(division)
      } catch (err) {
        return handleError(err, reply)
      }
    },
  )

  app.post(
    '/events/:id/divisions/import-from-templates',
    { preHandler: [authenticate, authorize('event_manager')] },
    async (request, reply) => {
      const { id } = request.params as { id: string }
      const parsed = ImportDivisionsFromTemplatesInput.safeParse(request.body ?? {})
      if (!parsed.success) {
        return reply.status(400).send({ error: 'Validation failed', details: parsed.error.flatten() })
      }
      try {
        const divisions = await divisionService.importFromTemplates(id, request.authUser.academyId, parsed.data, ctxFrom(request))
        return reply.status(201).send(divisions)
      } catch (err) {
        return handleError(err, reply)
      }
    },
  )

  // scoreboard_operator needs the division name to label the fight it's
  // running (e.g. "Sub-18 Masculino -73kg"). Divisions carry only
  // category/weight setup, no athlete or entry data, so this is safe to open.
  app.get(
    '/events/:id/divisions',
    { preHandler: [authenticate, authorize('scoreboard_operator')] },
    async (request, reply) => {
      const { id } = request.params as { id: string }
      try {
        const divisions = await divisionService.listDivisions(id, request.authUser.academyId)
        return reply.send(divisions)
      } catch (err) {
        return handleError(err, reply)
      }
    },
  )

  app.patch(
    '/events/:id/divisions/:did',
    { preHandler: [authenticate, authorize('event_manager')] },
    async (request, reply) => {
      const { id, did } = request.params as { id: string; did: string }
      const parsed = UpdateDivisionInput.safeParse(request.body)
      if (!parsed.success) {
        return reply.status(400).send({ error: 'Validation failed', details: parsed.error.flatten() })
      }
      try {
        const division = await divisionService.updateDivision(id, request.authUser.academyId, did, parsed.data, ctxFrom(request))
        return reply.send(division)
      } catch (err) {
        return handleError(err, reply)
      }
    },
  )

  app.delete(
    '/events/:id/divisions/:did',
    { preHandler: [authenticate, authorize('event_manager')] },
    async (request, reply) => {
      const { id, did } = request.params as { id: string; did: string }
      try {
        await divisionService.deleteDivision(id, request.authUser.academyId, did, ctxFrom(request))
        return reply.status(204).send()
      } catch (err) {
        return handleError(err, reply)
      }
    },
  )

  // ─── Entries ─────────────────────────────────────────────────────────────

  // weigh_in_operator needs its event's roster to run the weigh-in queue
  // (name + division + declared/confirmed weight — see EventEntryService
  // #toDTO, which resolves only the athlete's name, never CPF/phone/guardian).
  // staff/event_manager+ keep full access as before.
  app.get(
    '/events/:id/entries',
    { preHandler: [authenticate, authorize('staff', { alsoAllow: ['weigh_in_operator'] })] },
    async (request, reply) => {
      const { id } = request.params as { id: string }
      const parsed = ListEntriesQuery.safeParse(request.query)
      if (!parsed.success) {
        return reply.status(400).send({ error: 'Validation failed', details: parsed.error.flatten() })
      }
      try {
        const entries = await entryService.listEntries(id, request.authUser.academyId, parsed.data)
        return reply.send(entries)
      } catch (err) {
        return handleError(err, reply)
      }
    },
  )

  app.post('/events/:id/entries', { preHandler: [authenticate, authorize('staff')] }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const parsed = CreateEventEntryInput.safeParse(request.body)
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Validation failed', details: parsed.error.flatten() })
    }
    try {
      const entry = await entryService.createManualEntry(id, request.authUser.academyId, parsed.data, ctxFrom(request))
      return reply.status(201).send(entry)
    } catch (err) {
      return handleError(err, reply)
    }
  })

  app.patch(
    '/events/:id/entries/:eid/checkin',
    { preHandler: [authenticate, authorize('staff')] },
    async (request, reply) => {
      const { id, eid } = request.params as { id: string; eid: string }
      try {
        const entry = await entryService.checkIn(id, request.authUser.academyId, eid, ctxFrom(request))
        return reply.send(entry)
      } catch (err) {
        return handleError(err, reply)
      }
    },
  )

  app.patch(
    '/events/:id/entries/:eid/weighin',
    { preHandler: [authenticate, authorize('weigh_in_operator')] },
    async (request, reply) => {
      const { id, eid } = request.params as { id: string; eid: string }
      const parsed = RecordWeighInInput.safeParse(request.body)
      if (!parsed.success) {
        return reply.status(400).send({ error: 'Validation failed', details: parsed.error.flatten() })
      }
      try {
        const entry = await entryService.recordWeighIn(id, request.authUser.academyId, eid, parsed.data.weightKg, ctxFrom(request))
        return reply.send(entry)
      } catch (err) {
        return handleError(err, reply)
      }
    },
  )

  // confirmEntry is the weigh-in operator's own next step right after
  // recordWeighIn (picking/accepting the division post-weigh-in, including
  // after an automatic reallocation) — so weigh_in_operator gets an explicit
  // exception here, on top of the default event_manager+ requirement. staff
  // and coach, despite sitting between the two roles in the hierarchy, stay
  // forbidden.
  app.patch(
    '/events/:id/entries/:eid/confirm',
    { preHandler: [authenticate, authorize('event_manager', { alsoAllow: ['weigh_in_operator'] })] },
    async (request, reply) => {
      const { id, eid } = request.params as { id: string; eid: string }
      const parsed = ConfirmEntryInput.safeParse(request.body ?? {})
      if (!parsed.success) {
        return reply.status(400).send({ error: 'Validation failed', details: parsed.error.flatten() })
      }
      try {
        const entry = await entryService.confirmEntry(id, request.authUser.academyId, eid, parsed.data.confirmedDivisionId, ctxFrom(request))
        return reply.send(entry)
      } catch (err) {
        return handleError(err, reply)
      }
    },
  )

  app.patch(
    '/events/:id/entries/:eid/withdraw',
    { preHandler: [authenticate, authorize('event_manager')] },
    async (request, reply) => {
      const { id, eid } = request.params as { id: string; eid: string }
      const parsed = WithdrawEntryInput.safeParse(request.body)
      if (!parsed.success) {
        return reply.status(400).send({ error: 'Validation failed', details: parsed.error.flatten() })
      }
      try {
        const entry = await entryService.withdrawEntry(id, request.authUser.academyId, eid, parsed.data.reason, ctxFrom(request))
        return reply.send(entry)
      } catch (err) {
        return handleError(err, reply)
      }
    },
  )

  // ─── Bracket ─────────────────────────────────────────────────────────────

  app.post(
    '/events/:id/divisions/:did/bracket',
    { preHandler: [authenticate, authorize('event_manager')] },
    async (request, reply) => {
      const { id, did } = request.params as { id: string; did: string }
      const parsed = GenerateBracketInput.safeParse(request.body)
      if (!parsed.success) {
        return reply.status(400).send({ error: 'Validation failed', details: parsed.error.flatten() })
      }
      try {
        const bracket = await bracketService.generateBracket(id, request.authUser.academyId, did, parsed.data, ctxFrom(request))
        return reply.status(201).send(bracket)
      } catch (err) {
        return handleError(err, reply)
      }
    },
  )

  app.get(
    '/events/:id/divisions/:did/bracket',
    { preHandler: [authenticate, authorize('staff')] },
    async (request, reply) => {
      const { id, did } = request.params as { id: string; did: string }
      try {
        const bracket = await bracketService.getBracket(id, request.authUser.academyId, did)
        return reply.send(bracket)
      } catch (err) {
        return handleError(err, reply)
      }
    },
  )

  app.get(
    '/events/:id/divisions/:did/matches',
    { preHandler: [authenticate, authorize('staff')] },
    async (request, reply) => {
      const { id, did } = request.params as { id: string; did: string }
      try {
        const matches = await bracketService.listMatches(id, request.authUser.academyId, did)
        return reply.send(matches)
      } catch (err) {
        return handleError(err, reply)
      }
    },
  )

  app.get(
    '/events/:id/divisions/:did/rankings',
    { preHandler: [authenticate, authorize('staff')] },
    async (request, reply) => {
      const { id, did } = request.params as { id: string; did: string }
      try {
        const rankings = await bracketService.getRankings(id, request.authUser.academyId, did)
        return reply.send(rankings)
      } catch (err) {
        return handleError(err, reply)
      }
    },
  )

  app.post(
    '/events/:id/divisions/:did/matches/:mid/result',
    { preHandler: [authenticate, authorize('event_manager')] },
    async (request, reply) => {
      const parsedParams = MatchNumberParam.safeParse(request.params)
      if (!parsedParams.success) {
        return reply.status(400).send({ error: 'Validation failed', details: parsedParams.error.flatten() })
      }
      const parsed = RecordMatchResultInput.safeParse(request.body)
      if (!parsed.success) {
        return reply.status(400).send({ error: 'Validation failed', details: parsed.error.flatten() })
      }
      try {
        const { id, did, mid } = parsedParams.data
        const match = await bracketService.recordResult(id, request.authUser.academyId, did, mid, parsed.data, ctxFrom(request))
        return reply.send(match)
      } catch (err) {
        return handleError(err, reply)
      }
    },
  )

  app.post(
    '/events/:id/divisions/:did/matches/:mid/correct',
    { preHandler: [authenticate, authorize('event_manager')] },
    async (request, reply) => {
      const parsedParams = MatchNumberParam.safeParse(request.params)
      if (!parsedParams.success) {
        return reply.status(400).send({ error: 'Validation failed', details: parsedParams.error.flatten() })
      }
      const parsed = CorrectMatchResultInput.safeParse(request.body)
      if (!parsed.success) {
        return reply.status(400).send({ error: 'Validation failed', details: parsed.error.flatten() })
      }
      try {
        const { id, did, mid } = parsedParams.data
        const match = await bracketService.correctResult(id, request.authUser.academyId, did, mid, parsed.data, ctxFrom(request))
        return reply.send(match)
      } catch (err) {
        return handleError(err, reply)
      }
    },
  )
}
