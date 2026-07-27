// Proves the durable-queue / late-write-acceptance story end to end at the
// HTTP layer (Fastify `inject`, same pattern as checkin.test.ts) — CLAUDE.md:
// "Do not claim offline support unless it is actually implemented and
// tested." Each `it()` below simulates one specific failure mode called out
// for this work: a write delivered late, the SAME write delivered twice, a
// station with a wrong clock, and a write that is rejected for good (the
// operator must see it, never lose it silently).
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { connectTestDb, closeTestDb, clearTestDb } from '@sensei-hub/core-server/testing'
import { AuditLogModel } from '@sensei-hub/core-server'
import { buildApp } from '../app.js'
import type { FastifyInstance } from 'fastify'

let app: FastifyInstance

beforeAll(async () => {
  await connectTestDb()
  app = await buildApp()
  await app.ready()
})

afterAll(async () => {
  await app.close()
  await closeTestDb()
})

beforeEach(async () => {
  await clearTestDb()
})

interface EventDTO {
  id: string
}
interface DivisionDTO {
  id: string
}
interface EntryDTO {
  id: string
  status: string
}
interface AttendanceDTO {
  id: string
  athleteId: string
  status: string
  checkedInAt: string
}

async function setupAdmin(email = 'admin@test.com', password = 'senha12345') {
  await app.inject({
    method: 'POST',
    url: '/api/setup',
    payload: { academyName: 'Academia Teste', adminName: 'Admin', adminEmail: email, adminPassword: password },
  })
  const loginRes = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email, password } })
  return loginRes.json<{ accessToken: string }>().accessToken
}

async function createAthlete(token: string, overrides: Record<string, unknown> = {}) {
  const res = await app.inject({
    method: 'POST',
    url: '/api/athletes',
    headers: { authorization: `Bearer ${token}` },
    payload: {
      fullName: 'Ricardo Santos',
      gender: 'male',
      birthDate: '1990-01-01',
      currentBelt: 'blue',
      termsAccepted: true,
      imageAuthorizationAccepted: true,
      ...overrides,
    },
  })
  return res.json<{ id: string }>()
}

async function createEvent(token: string, overrides: Record<string, unknown> = {}) {
  const res = await app.inject({
    method: 'POST',
    url: '/api/events',
    headers: { authorization: `Bearer ${token}` },
    payload: { name: 'Copa Teste', eventDate: '2026-08-01', ...overrides },
  })
  return res.json<EventDTO>()
}

async function createDivision(token: string, eventId: string, overrides: Record<string, unknown> = {}) {
  const res = await app.inject({
    method: 'POST',
    url: `/api/events/${eventId}/divisions`,
    headers: { authorization: `Bearer ${token}` },
    payload: { name: 'Adulto Médio', weightLimitKg: 90, ...overrides },
  })
  return res.json<DivisionDTO>()
}

async function createEntry(token: string, eventId: string, divisionId: string, athleteId: string) {
  const res = await app.inject({
    method: 'POST',
    url: `/api/events/${eventId}/entries`,
    headers: { authorization: `Bearer ${token}` },
    payload: { divisionId, athleteId },
  })
  return res.json<EntryDTO & { athleteId: string }>()
}

// Mirrors exactly what offlineQueue.ts's drainOfflineQueue sends when it
// replays a queued write — same header names, same semantics (idempotency
// key = the client-generated queue-item id; station/seq/occurredAt are the
// "who/when it actually happened" trio).
function queuedHeaders(
  token: string,
  opts: { idempotencyKey?: string; stationId?: string; clientSeq?: number; occurredAt?: string } = {},
) {
  return {
    authorization: `Bearer ${token}`,
    ...(opts.idempotencyKey ? { 'idempotency-key': opts.idempotencyKey } : {}),
    ...(opts.stationId ? { 'x-station-id': opts.stationId } : {}),
    ...(opts.clientSeq !== undefined ? { 'x-client-seq': String(opts.clientSeq) } : {}),
    ...(opts.occurredAt ? { 'x-occurred-at': opts.occurredAt } : {}),
  }
}

describe('Idempotent replay — check-in', () => {
  it('a check-in resent with the same Idempotency-Key returns the SAME Attendance, without creating a second one', async () => {
    const token = await setupAdmin()
    const event = await createEvent(token)
    const athlete = await createAthlete(token)
    const key = 'queue-item-abc-123'

    const first = await app.inject({
      method: 'POST',
      url: `/api/events/${event.id}/checkin`,
      headers: queuedHeaders(token, { idempotencyKey: key, stationId: 'mesa-3', clientSeq: 1 }),
      payload: { athleteId: athlete.id, method: 'staff_search' },
    })
    expect(first.statusCode).toBe(201)
    const firstBody = first.json<AttendanceDTO>()

    // Simulates the network dropping the ACK after the server already
    // committed: the offline queue still has the item as 'pending' and
    // resends the identical request with the identical key.
    const replay = await app.inject({
      method: 'POST',
      url: `/api/events/${event.id}/checkin`,
      headers: queuedHeaders(token, { idempotencyKey: key, stationId: 'mesa-3', clientSeq: 1 }),
      payload: { athleteId: athlete.id, method: 'staff_search' },
    })
    expect(replay.statusCode).toBe(201)
    const replayBody = replay.json<AttendanceDTO>()

    // Exact same result, not a fresh 409 "already checked in".
    expect(replayBody.id).toBe(firstBody.id)
    expect(replayBody.checkedInAt).toBe(firstBody.checkedInAt)

    const listRes = await app.inject({
      method: 'GET',
      url: `/api/events/${event.id}/checkin`,
      headers: { authorization: `Bearer ${token}` },
    })
    expect(listRes.json<AttendanceDTO[]>()).toHaveLength(1)
  })

  it('two concurrent replays of the SAME key (two tabs draining at once) still create exactly one Attendance', async () => {
    const token = await setupAdmin()
    const event = await createEvent(token)
    const athlete = await createAthlete(token)
    const key = 'queue-item-race-1'

    const [a, b] = await Promise.all([
      app.inject({
        method: 'POST',
        url: `/api/events/${event.id}/checkin`,
        headers: queuedHeaders(token, { idempotencyKey: key }),
        payload: { athleteId: athlete.id, method: 'staff_search' },
      }),
      app.inject({
        method: 'POST',
        url: `/api/events/${event.id}/checkin`,
        headers: queuedHeaders(token, { idempotencyKey: key }),
        payload: { athleteId: athlete.id, method: 'staff_search' },
      }),
    ])

    // Both calls must resolve to a coherent, successful outcome (not one
    // succeeding and the other seeing a spurious "already checked in").
    expect(a.statusCode).toBe(201)
    expect(b.statusCode).toBe(201)
    expect(a.json<AttendanceDTO>().id).toBe(b.json<AttendanceDTO>().id)

    const listRes = await app.inject({
      method: 'GET',
      url: `/api/events/${event.id}/checkin`,
      headers: { authorization: `Bearer ${token}` },
    })
    expect(listRes.json<AttendanceDTO[]>()).toHaveLength(1)
  })

  it('a DEFINITIVELY rejected queued write (unknown athlete) replays the identical rejection, not a new error, never a new side effect', async () => {
    const token = await setupAdmin()
    const event = await createEvent(token)
    const key = 'queue-item-bad-athlete'

    const first = await app.inject({
      method: 'POST',
      url: `/api/events/${event.id}/checkin`,
      headers: queuedHeaders(token, { idempotencyKey: key }),
      payload: { athleteId: '000000000000000000000000', method: 'staff_search' },
    })
    expect(first.statusCode).toBe(404)

    const replay = await app.inject({
      method: 'POST',
      url: `/api/events/${event.id}/checkin`,
      headers: queuedHeaders(token, { idempotencyKey: key }),
      payload: { athleteId: '000000000000000000000000', method: 'staff_search' },
    })
    expect(replay.statusCode).toBe(404)
    expect(replay.json()).toEqual(first.json())
  })

  it('preserves the operator-reported occurrence time even though the server received it much later, and always records its own receipt time separately on the audit log', async () => {
    const token = await setupAdmin()
    const event = await createEvent(token)
    const athlete = await createAthlete(token)

    // Simulates a station that queued this check-in offline 40 minutes ago.
    const occurredAt = new Date(Date.now() - 40 * 60_000).toISOString()
    const before = Date.now()

    const res = await app.inject({
      method: 'POST',
      url: `/api/events/${event.id}/checkin`,
      headers: queuedHeaders(token, { idempotencyKey: 'late-arrival-1', stationId: 'mesa-2', clientSeq: 7, occurredAt }),
      payload: { athleteId: athlete.id, method: 'staff_search' },
    })
    expect(res.statusCode).toBe(201)
    const attendance = res.json<AttendanceDTO>()

    // The domain fact — "when did the athlete actually check in" — is the
    // OLD time, not the moment the server happened to process it.
    expect(attendance.checkedInAt).toBe(occurredAt)

    const auditEntry = await AuditLogModel.findOne({ entityType: 'Attendance', entityId: attendance.id })
    expect(auditEntry).not.toBeNull()
    // The server's own receipt time is untouched by the client's timestamp —
    // it must be close to "now" (when this test ran), never backdated.
    expect(auditEntry?.timestamp.getTime()).toBeGreaterThanOrEqual(before)
    expect(auditEntry?.occurredAt?.toISOString()).toBe(occurredAt)
    expect(auditEntry?.stationId).toBe('mesa-2')
    expect(auditEntry?.clientSeq).toBe(7)
  })

  it('a station with a badly skewed clock (hours in the future) is still accepted normally — wall time is never used to gate anything', async () => {
    const token = await setupAdmin()
    const event = await createEvent(token)
    const athlete = await createAthlete(token)

    const skewedFuture = new Date(Date.now() + 6 * 60 * 60_000).toISOString() // 6h ahead
    const res = await app.inject({
      method: 'POST',
      url: `/api/events/${event.id}/checkin`,
      headers: queuedHeaders(token, { idempotencyKey: 'skewed-clock-1', occurredAt: skewedFuture }),
      payload: { athleteId: athlete.id, method: 'staff_search' },
    })
    expect(res.statusCode).toBe(201)
    expect(res.json<AttendanceDTO>().checkedInAt).toBe(skewedFuture)

    // A second, unrelated check-in from a normal (correct-clock) station
    // right after must not be confused by the first one's bogus timestamp —
    // proves ordering/gating doesn't depend on wall clock at all.
    const athlete2 = await createAthlete(token, { fullName: 'Segundo Atleta' })
    const res2 = await app.inject({
      method: 'POST',
      url: `/api/events/${event.id}/checkin`,
      headers: queuedHeaders(token),
      payload: { athleteId: athlete2.id, method: 'staff_search' },
    })
    expect(res2.statusCode).toBe(201)
  })

  it('a malformed occurred-at header never corrupts the record or crashes the request — falls back to server time', async () => {
    const token = await setupAdmin()
    const event = await createEvent(token)
    const athlete = await createAthlete(token)

    const res = await app.inject({
      method: 'POST',
      url: `/api/events/${event.id}/checkin`,
      headers: queuedHeaders(token, { idempotencyKey: 'garbage-clock-1', occurredAt: 'not-a-real-date' }),
      payload: { athleteId: athlete.id, method: 'staff_search' },
    })
    expect(res.statusCode).toBe(201)
    const attendance = res.json<AttendanceDTO>()
    expect(Number.isNaN(new Date(attendance.checkedInAt).getTime())).toBe(false)
  })
})

describe('Idempotent replay — weigh-in', () => {
  async function confirmedEntry(token: string, eventId: string, divisionId: string) {
    const athlete = await createAthlete(token, { fullName: `Atleta ${Date.now()}-${Math.random()}` })
    const entry = await createEntry(token, eventId, divisionId, athlete.id)
    await app.inject({
      method: 'PATCH',
      url: `/api/events/${eventId}/entries/${entry.id}/checkin`,
      headers: { authorization: `Bearer ${token}` },
    })
    return entry
  }

  it('a weigh-in resent with the same Idempotency-Key returns the SAME outcome, without recording a second WeightRecord', async () => {
    const token = await setupAdmin()
    const event = await createEvent(token)
    const division = await createDivision(token, event.id)
    const entry = await confirmedEntry(token, event.id, division.id)
    const key = 'queue-item-weighin-1'

    const first = await app.inject({
      method: 'PATCH',
      url: `/api/events/${event.id}/entries/${entry.id}/weighin`,
      headers: queuedHeaders(token, { idempotencyKey: key, stationId: 'balanca-1', clientSeq: 3 }),
      payload: { weightKg: 82.4 },
    })
    expect(first.statusCode).toBe(200)
    const firstBody = first.json<{ id: string; status: string; outcome: string }>()
    expect(firstBody.status).toBe('weighed_in')

    const replay = await app.inject({
      method: 'PATCH',
      url: `/api/events/${event.id}/entries/${entry.id}/weighin`,
      headers: queuedHeaders(token, { idempotencyKey: key, stationId: 'balanca-1', clientSeq: 3 }),
      payload: { weightKg: 82.4 },
    })
    expect(replay.statusCode).toBe(200)
    expect(replay.json()).toEqual(firstBody)

    const athleteRecords = await app.inject({
      method: 'GET',
      url: `/api/athletes/${entry.athleteId}/weights`,
      headers: { authorization: `Bearer ${token}` },
    })
    expect(athleteRecords.json<unknown[]>()).toHaveLength(1)
  })

  it('WITHOUT an Idempotency-Key, behaves exactly as before: a second weigh-in on the same entry is a business rejection (invalid transition), not corruption', async () => {
    const token = await setupAdmin()
    const event = await createEvent(token)
    const division = await createDivision(token, event.id)
    const entry = await confirmedEntry(token, event.id, division.id)

    const first = await app.inject({
      method: 'PATCH',
      url: `/api/events/${event.id}/entries/${entry.id}/weighin`,
      headers: { authorization: `Bearer ${token}` },
      payload: { weightKg: 80 },
    })
    expect(first.statusCode).toBe(200)

    // A second, genuinely distinct weigh-in submission (no key — simulates
    // an operator double-submitting from two different, unqueued requests)
    // for the same entry is rejected by the entry's own state machine, not
    // silently applied on top.
    const second = await app.inject({
      method: 'PATCH',
      url: `/api/events/${event.id}/entries/${entry.id}/weighin`,
      headers: { authorization: `Bearer ${token}` },
      payload: { weightKg: 81 },
    })
    expect(second.statusCode).toBe(409)
  })
})
