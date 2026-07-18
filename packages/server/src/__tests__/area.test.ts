import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { connectTestDb, closeTestDb, clearTestDb } from '@sensei-hub/core-server/testing'
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
}
interface AreaDTO {
  id: string
  name: string
  allowedDivisionIds: string[] | null
  status: 'open' | 'closed'
  closedReason?: string
}
interface MatchDTO {
  id: string
  matchNumber: number
  athleteAId: string | null
  athleteBId: string | null
  areaId: string | null
  result: { winnerId: string; isWalkover: boolean; decidedAt?: string } | null
}
interface NextMatchDTO {
  match: { id: string; matchNumber: number; divisionId: string; athleteAId: string; athleteBId: string } | null
}
interface UnroutableMatchDTO {
  id: string
  matchNumber: number
  divisionId: string
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

async function createUserAndLogin(adminToken: string, role: string, email: string) {
  await app.inject({
    method: 'POST',
    url: '/api/users',
    headers: { authorization: `Bearer ${adminToken}` },
    payload: { name: 'User ' + role, email, password: 'senha12345', role },
  })
  const loginRes = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email, password: 'senha12345' } })
  return loginRes.json<{ accessToken: string }>().accessToken
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

async function updateEvent(token: string, eventId: string, body: Record<string, unknown>) {
  return app.inject({
    method: 'PATCH',
    url: `/api/events/${eventId}`,
    headers: { authorization: `Bearer ${token}` },
    payload: body,
  })
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

let athleteCounter = 0
async function confirmedEntry(token: string, eventId: string, divisionId: string) {
  athleteCounter++
  const athlete = await app.inject({
    method: 'POST',
    url: '/api/athletes',
    headers: { authorization: `Bearer ${token}` },
    payload: {
      fullName: `Atleta ${athleteCounter}`,
      gender: 'male',
      birthDate: '1990-01-01',
      currentBelt: 'blue',
      termsAccepted: true,
      imageAuthorizationAccepted: true,
    },
  })
  const athleteId = athlete.json<{ id: string }>().id

  const created = await app.inject({
    method: 'POST',
    url: `/api/events/${eventId}/entries`,
    headers: { authorization: `Bearer ${token}` },
    payload: { divisionId, athleteId },
  })
  const entry = created.json<EntryDTO>()

  await app.inject({
    method: 'PATCH',
    url: `/api/events/${eventId}/entries/${entry.id}/checkin`,
    headers: { authorization: `Bearer ${token}` },
  })
  await app.inject({
    method: 'PATCH',
    url: `/api/events/${eventId}/entries/${entry.id}/weighin`,
    headers: { authorization: `Bearer ${token}` },
    payload: { weightKg: 80 },
  })
  await app.inject({
    method: 'PATCH',
    url: `/api/events/${eventId}/entries/${entry.id}/confirm`,
    headers: { authorization: `Bearer ${token}` },
    payload: {},
  })
  return athleteId
}

async function generateBracket(token: string, eventId: string, divisionId: string, body: Record<string, unknown>) {
  return app.inject({
    method: 'POST',
    url: `/api/events/${eventId}/divisions/${divisionId}/bracket`,
    headers: { authorization: `Bearer ${token}` },
    payload: body,
  })
}

async function listMatches(token: string, eventId: string, divisionId: string) {
  const res = await app.inject({
    method: 'GET',
    url: `/api/events/${eventId}/divisions/${divisionId}/matches`,
    headers: { authorization: `Bearer ${token}` },
  })
  return res.json<MatchDTO[]>()
}

async function recordResult(token: string, eventId: string, divisionId: string, matchNumber: number, body: Record<string, unknown>) {
  return app.inject({
    method: 'POST',
    url: `/api/events/${eventId}/divisions/${divisionId}/matches/${matchNumber}/result`,
    headers: { authorization: `Bearer ${token}` },
    payload: body,
  })
}

async function createArea(token: string, eventId: string, body: Record<string, unknown> = {}) {
  const res = await app.inject({
    method: 'POST',
    url: `/api/events/${eventId}/areas`,
    headers: { authorization: `Bearer ${token}` },
    payload: { name: 'Mesa 1', ...body },
  })
  return res.json<AreaDTO>()
}

async function listAreas(token: string, eventId: string) {
  const res = await app.inject({
    method: 'GET',
    url: `/api/events/${eventId}/areas`,
    headers: { authorization: `Bearer ${token}` },
  })
  return res.json<AreaDTO[]>()
}

async function nextMatch(token: string, eventId: string, areaId: string) {
  return app.inject({
    method: 'POST',
    url: `/api/events/${eventId}/areas/${areaId}/next-match`,
    headers: { authorization: `Bearer ${token}` },
  })
}

async function closeArea(token: string, eventId: string, areaId: string, reason = 'Almoço') {
  return app.inject({
    method: 'PATCH',
    url: `/api/events/${eventId}/areas/${areaId}/close`,
    headers: { authorization: `Bearer ${token}` },
    payload: { reason },
  })
}

async function reopenArea(token: string, eventId: string, areaId: string) {
  return app.inject({
    method: 'PATCH',
    url: `/api/events/${eventId}/areas/${areaId}/reopen`,
    headers: { authorization: `Bearer ${token}` },
  })
}

async function unroutableMatches(token: string, eventId: string) {
  const res = await app.inject({
    method: 'GET',
    url: `/api/events/${eventId}/areas/unroutable-matches`,
    headers: { authorization: `Bearer ${token}` },
  })
  return res.json<UnroutableMatchDTO[]>()
}

describe('Areas — CRUD and RBAC', () => {
  it('creates an area with no allowedDivisionIds as null (not an empty array), lists and updates it', async () => {
    const token = await setupAdmin()
    const event = await createEvent(token)

    const area = await createArea(token, event.id, { name: 'Mesa Geral' })
    expect(area.allowedDivisionIds).toBeNull()

    const listed = await listAreas(token, event.id)
    expect(listed).toHaveLength(1)
    expect(listed[0]?.allowedDivisionIds).toBeNull()

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/events/${event.id}/areas/${area.id}`,
      headers: { authorization: `Bearer ${token}` },
      payload: { name: 'Mesa 1 Renomeada' },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json<AreaDTO>().name).toBe('Mesa 1 Renomeada')
  })

  it('returns 403 creating an area as staff, 401 without a token', async () => {
    const token = await setupAdmin()
    const event = await createEvent(token)
    const staffToken = await createUserAndLogin(token, 'staff', 'staff@test.com')

    const forbidden = await app.inject({
      method: 'POST',
      url: `/api/events/${event.id}/areas`,
      headers: { authorization: `Bearer ${staffToken}` },
      payload: { name: 'Mesa X' },
    })
    expect(forbidden.statusCode).toBe(403)

    const noToken = await app.inject({ method: 'GET', url: `/api/events/${event.id}/areas` })
    expect(noToken.statusCode).toBe(401)
  })

  it('returns 409 deleting an area that has already dispatched a match', async () => {
    const token = await setupAdmin()
    const event = await createEvent(token)
    const division = await createDivision(token, event.id)
    for (let i = 0; i < 8; i++) await confirmedEntry(token, event.id, division.id)
    await generateBracket(token, event.id, division.id, { format: 'elimination', seed: 1 })

    const area = await createArea(token, event.id)
    await nextMatch(token, event.id, area.id)

    const res = await app.inject({
      method: 'DELETE',
      url: `/api/events/${event.id}/areas/${area.id}`,
      headers: { authorization: `Bearer ${token}` },
    })
    expect(res.statusCode).toBe(409)
  })
})

describe('Close / reopen', () => {
  it('scoreboard_operator can close an area; only event_manager+ can reopen it', async () => {
    const token = await setupAdmin()
    const event = await createEvent(token)
    const area = await createArea(token, event.id)

    const scoreboardToken = await createUserAndLogin(token, 'scoreboard_operator', 'placar@test.com')
    const closed = await closeArea(scoreboardToken, event.id, area.id, 'Almoço')
    expect(closed.statusCode).toBe(200)
    expect(closed.json<{ area: AreaDTO }>().area.status).toBe('closed')

    const forbiddenReopen = await reopenArea(scoreboardToken, event.id, area.id)
    expect(forbiddenReopen.statusCode).toBe(403)

    const reopened = await reopenArea(token, event.id, area.id)
    expect(reopened.statusCode).toBe(200)
    expect(reopened.json<AreaDTO>().status).toBe('open')
  })

  it('returns 409 closing an already-closed area and reopening an already-open one', async () => {
    const token = await setupAdmin()
    const event = await createEvent(token)
    const area = await createArea(token, event.id)

    expect((await reopenArea(token, event.id, area.id)).statusCode).toBe(409)
    await closeArea(token, event.id, area.id)
    expect((await closeArea(token, event.id, area.id)).statusCode).toBe(409)
  })

  it('closing an area frees any claimed-but-undecided match back to the pool', async () => {
    const token = await setupAdmin()
    const event = await createEvent(token)
    const division = await createDivision(token, event.id)
    for (let i = 0; i < 8; i++) await confirmedEntry(token, event.id, division.id)
    await generateBracket(token, event.id, division.id, { format: 'elimination', seed: 2 })

    const area = await createArea(token, event.id)
    const claimed = await nextMatch(token, event.id, area.id)
    const matchId = claimed.json<NextMatchDTO>().match?.id
    expect(matchId).toBeDefined()

    let matches = await listMatches(token, event.id, division.id)
    expect(matches.find((m) => m.id === matchId)?.areaId).toBe(area.id)

    await closeArea(token, event.id, area.id)

    matches = await listMatches(token, event.id, division.id)
    expect(matches.find((m) => m.id === matchId)?.areaId).toBeNull()
  })
})

describe('Unroutable matches', () => {
  it('reports a ready match whose division no open area accepts', async () => {
    const token = await setupAdmin()
    const event = await createEvent(token)
    const divisionA = await createDivision(token, event.id, { name: 'PCD' })
    const divisionB = await createDivision(token, event.id, { name: 'Outra', weightLimitKg: 100 })
    for (let i = 0; i < 8; i++) await confirmedEntry(token, event.id, divisionA.id)
    await generateBracket(token, event.id, divisionA.id, { format: 'elimination', seed: 3 })

    // Only area open accepts divisionB, not divisionA (PCD) — divisionA's
    // ready matches have nowhere to go.
    await createArea(token, event.id, { name: 'Mesa Outra', allowedDivisionIds: [divisionB.id] })

    const stuck = await unroutableMatches(token, event.id)
    expect(stuck.length).toBeGreaterThan(0)
    expect(stuck.every((m) => m.divisionId === divisionA.id)).toBe(true)

    // Now open a general area (accepts anything) — nothing should be stuck anymore.
    await createArea(token, event.id, { name: 'Mesa Geral' })
    expect(await unroutableMatches(token, event.id)).toHaveLength(0)
  })
})

describe('POST /api/events/:id/areas/:aid/next-match', () => {
  it('only dispatches matches whose division is in allowedDivisionIds', async () => {
    const token = await setupAdmin()
    const event = await createEvent(token)
    const divisionA = await createDivision(token, event.id, { name: 'A' })
    const divisionB = await createDivision(token, event.id, { name: 'B', weightLimitKg: 100 })
    for (let i = 0; i < 8; i++) await confirmedEntry(token, event.id, divisionA.id)
    for (let i = 0; i < 8; i++) await confirmedEntry(token, event.id, divisionB.id)
    await generateBracket(token, event.id, divisionA.id, { format: 'elimination', seed: 4 })
    await generateBracket(token, event.id, divisionB.id, { format: 'elimination', seed: 5 })

    const restrictedToB = await createArea(token, event.id, { name: 'Só B', allowedDivisionIds: [divisionB.id] })

    const res = await nextMatch(token, event.id, restrictedToB.id)
    expect(res.statusCode).toBe(200)
    const match = res.json<NextMatchDTO>().match
    expect(match).not.toBeNull()
    expect(match?.divisionId).toBe(divisionB.id)
  })

  it('returns { match: null } when the area is idle with nothing eligible, not an error', async () => {
    const token = await setupAdmin()
    const event = await createEvent(token)
    const area = await createArea(token, event.id)
    const res = await nextMatch(token, event.id, area.id)
    expect(res.statusCode).toBe(200)
    expect(res.json<NextMatchDTO>().match).toBeNull()
  })

  it('returns 409 requesting a match for a closed area', async () => {
    const token = await setupAdmin()
    const event = await createEvent(token)
    const area = await createArea(token, event.id)
    await closeArea(token, event.id, area.id)
    const res = await nextMatch(token, event.id, area.id)
    expect(res.statusCode).toBe(409)
  })

  it("respects the minimum rest time between an athlete's fights", async () => {
    const token = await setupAdmin()
    const event = await createEvent(token)
    const division = await createDivision(token, event.id)
    for (let i = 0; i < 4; i++) await confirmedEntry(token, event.id, division.id)
    await generateBracket(token, event.id, division.id, { format: 'rodizio', seed: 6 })

    // Long rest window so a just-decided athlete is unmistakably still resting.
    await updateEvent(token, event.id, { restMinutesBetweenMatches: 999 })

    const area = await createArea(token, event.id)
    const first = await nextMatch(token, event.id, area.id)
    const firstMatch = first.json<NextMatchDTO>().match
    expect(firstMatch).not.toBeNull()

    await recordResult(token, event.id, division.id, firstMatch!.matchNumber, {
      winnerId: firstMatch!.athleteAId,
      isWalkover: false,
    })
    const rested = [firstMatch!.athleteAId, firstMatch!.athleteBId]

    // Rodízio-4: with the two just-decided athletes excluded, exactly one
    // ready match remains — the pairing of the other two athletes, who
    // haven't fought yet and need no rest.
    const second = await nextMatch(token, event.id, area.id)
    const secondMatch = second.json<NextMatchDTO>().match
    expect(secondMatch).not.toBeNull()
    expect(rested).not.toContain(secondMatch!.athleteAId)
    expect(rested).not.toContain(secondMatch!.athleteBId)
  })

  it('two areas requesting next-match at the same time never get the same match', async () => {
    const token = await setupAdmin()
    const event = await createEvent(token)
    const division = await createDivision(token, event.id)
    for (let i = 0; i < 8; i++) await confirmedEntry(token, event.id, division.id)
    await generateBracket(token, event.id, division.id, { format: 'elimination', seed: 7 })

    const areaA = await createArea(token, event.id, { name: 'A' })
    const areaB = await createArea(token, event.id, { name: 'B' })

    const [resA, resB] = await Promise.all([
      nextMatch(token, event.id, areaA.id),
      nextMatch(token, event.id, areaB.id),
    ])
    const matchA = resA.json<NextMatchDTO>().match
    const matchB = resB.json<NextMatchDTO>().match
    expect(matchA).not.toBeNull()
    expect(matchB).not.toBeNull()
    expect(matchA?.id).not.toBe(matchB?.id)
  })
})
