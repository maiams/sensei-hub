import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { connectTestDb, closeTestDb, clearTestDb } from './helpers/db.js'
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
interface MatchDTO {
  id: string
  matchNumber: number
  round: number
  stage: string
  athleteAId: string | null
  athleteBId: string | null
  byeAthleteId: string | null
  nextMatchNumber: number | null
  nextMatchSlot: 'A' | 'B' | null
  groupMatchNumber: number | null
  result: { winnerId: string; isWalkover: boolean; decidedAt?: string } | null
}
interface BracketDTO {
  id: string
  format: string
  size?: number
  repechageType?: string
  status: string
  version: number
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

async function generate(token: string, eventId: string, divisionId: string, body: Record<string, unknown>) {
  return app.inject({
    method: 'POST',
    url: `/api/events/${eventId}/divisions/${divisionId}/bracket`,
    headers: { authorization: `Bearer ${token}` },
    payload: body,
  })
}

async function recordResult(token: string, eventId: string, divisionId: string, matchNumber: number, body: Record<string, unknown>) {
  return app.inject({
    method: 'POST',
    url: `/api/events/${eventId}/divisions/${divisionId}/matches/${matchNumber}/result`,
    headers: { authorization: `Bearer ${token}` },
    payload: body,
  })
}

async function correctResult(token: string, eventId: string, divisionId: string, matchNumber: number, body: Record<string, unknown>) {
  return app.inject({
    method: 'POST',
    url: `/api/events/${eventId}/divisions/${divisionId}/matches/${matchNumber}/correct`,
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

describe('POST /api/events/:id/divisions/:did/bracket', () => {
  it('returns 400 with no confirmed entries', async () => {
    const token = await setupAdmin()
    const event = await createEvent(token)
    const division = await createDivision(token, event.id)
    const res = await generate(token, event.id, division.id, { format: 'elimination' })
    expect(res.statusCode).toBe(400)
  })

  it('generates a Chave-8 from 8 confirmed entries and persists 7 matches', async () => {
    const token = await setupAdmin()
    const event = await createEvent(token)
    const division = await createDivision(token, event.id)
    for (let i = 0; i < 8; i++) await confirmedEntry(token, event.id, division.id)

    const res = await generate(token, event.id, division.id, { format: 'elimination', seed: 42 })
    expect(res.statusCode).toBe(201)
    const bracket = res.json<BracketDTO>()
    expect(bracket.format).toBe('elimination')
    expect(bracket.size).toBe(8)
    expect(bracket.status).toBe('active')
    expect(bracket.version).toBe(1)

    const matches = await listMatches(token, event.id, division.id)
    expect(matches).toHaveLength(7)
    expect(matches.filter((m) => m.round === 1)).toHaveLength(4)
    const final = matches.find((m) => m.matchNumber === 7)
    expect(final?.round).toBe(3)
    expect(final?.nextMatchNumber).toBeNull()
  })

  it('only counts entries confirmed into this specific division', async () => {
    const token = await setupAdmin()
    const event = await createEvent(token)
    const divisionA = await createDivision(token, event.id, { name: 'A' })
    const divisionB = await createDivision(token, event.id, { name: 'B', weightLimitKg: 100 })
    for (let i = 0; i < 2; i++) await confirmedEntry(token, event.id, divisionA.id)
    await confirmedEntry(token, event.id, divisionB.id)

    const res = await generate(token, event.id, divisionA.id, { format: 'elimination' })
    const bracket = res.json<BracketDTO>()
    expect(bracket.size).toBe(8) // smallest size fitting 2 athletes (min bracket size is 8)
    const matches = await listMatches(token, event.id, divisionA.id)
    const round1 = matches.filter((m) => m.round === 1)
    const realAthletes = round1.flatMap((m) => [m.athleteAId, m.athleteBId]).filter((id) => id !== null)
    expect(realAthletes).toHaveLength(2)
  })

  it('returns 409 regenerating without force, and archives + versions up with force', async () => {
    const token = await setupAdmin()
    const event = await createEvent(token)
    const division = await createDivision(token, event.id)
    for (let i = 0; i < 8; i++) await confirmedEntry(token, event.id, division.id)
    await generate(token, event.id, division.id, { format: 'elimination' })

    const conflict = await generate(token, event.id, division.id, { format: 'elimination' })
    expect(conflict.statusCode).toBe(409)

    const forced = await generate(token, event.id, division.id, { format: 'elimination', force: true })
    expect(forced.statusCode).toBe(201)
    expect(forced.json<BracketDTO>().version).toBe(2)
  })

  it('RBAC: generate requires event_manager+, GET requires staff+', async () => {
    const adminToken = await setupAdmin()
    const event = await createEvent(adminToken)
    const division = await createDivision(adminToken, event.id)
    const staffToken = await createUserAndLogin(adminToken, 'staff', 'staff@test.com')

    const forbiddenGenerate = await generate(staffToken, event.id, division.id, { format: 'elimination' })
    expect(forbiddenGenerate.statusCode).toBe(403)

    const noToken = await app.inject({ method: 'GET', url: `/api/events/${event.id}/divisions/${division.id}/bracket` })
    expect(noToken.statusCode).toBe(401)
  })

  it('returns 404 getting a bracket that was never generated', async () => {
    const token = await setupAdmin()
    const event = await createEvent(token)
    const division = await createDivision(token, event.id)
    const res = await app.inject({
      method: 'GET',
      url: `/api/events/${event.id}/divisions/${division.id}/bracket`,
      headers: { authorization: `Bearer ${token}` },
    })
    expect(res.statusCode).toBe(404)
  })
})

describe('POST .../matches/:mid/result', () => {
  it('records a result and propagates the winner into the next match', async () => {
    const token = await setupAdmin()
    const event = await createEvent(token)
    const division = await createDivision(token, event.id)
    for (let i = 0; i < 8; i++) await confirmedEntry(token, event.id, division.id)
    await generate(token, event.id, division.id, { format: 'elimination', seed: 1 })

    const matches = await listMatches(token, event.id, division.id)
    const m1 = matches.find((m) => m.matchNumber === 1) as MatchDTO
    const winnerId = m1.athleteAId as string

    const res = await recordResult(token, event.id, division.id, 1, { winnerId, isWalkover: false })
    expect(res.statusCode).toBe(200)
    expect(res.json<MatchDTO>().result?.winnerId).toBe(winnerId)

    const after = await listMatches(token, event.id, division.id)
    const next = after.find((m) => m.matchNumber === m1.nextMatchNumber) as MatchDTO
    const slotValue = m1.nextMatchSlot === 'A' ? next.athleteAId : next.athleteBId
    expect(slotValue).toBe(winnerId)
  })

  it('stamps result.decidedAt on record, and re-stamps it on correction — used by MatchDispatchService for the rest-time rule', async () => {
    const token = await setupAdmin()
    const event = await createEvent(token)
    const division = await createDivision(token, event.id)
    for (let i = 0; i < 8; i++) await confirmedEntry(token, event.id, division.id)
    await generate(token, event.id, division.id, { format: 'elimination', seed: 11 })

    const matches = await listMatches(token, event.id, division.id)
    const m1 = matches.find((m) => m.matchNumber === 1) as MatchDTO
    const [a, b] = [m1.athleteAId as string, m1.athleteBId as string]

    const res = await recordResult(token, event.id, division.id, 1, { winnerId: a, isWalkover: false })
    const firstDecidedAt = res.json<MatchDTO>().result?.decidedAt
    expect(firstDecidedAt).toBeDefined()
    expect(new Date(firstDecidedAt as string).getTime()).not.toBeNaN()

    const corrected = await correctResult(token, event.id, division.id, 1, { winnerId: b, isWalkover: false, reason: 'placar trocado' })
    const secondDecidedAt = corrected.json<MatchDTO>().result?.decidedAt
    expect(secondDecidedAt).toBeDefined()
    expect(new Date(secondDecidedAt as string).getTime()).toBeGreaterThanOrEqual(new Date(firstDecidedAt as string).getTime())
  })

  it('returns 409 recording a result twice (must use /correct)', async () => {
    const token = await setupAdmin()
    const event = await createEvent(token)
    const division = await createDivision(token, event.id)
    for (let i = 0; i < 8; i++) await confirmedEntry(token, event.id, division.id)
    await generate(token, event.id, division.id, { format: 'elimination' })
    const matches = await listMatches(token, event.id, division.id)
    const m1 = matches.find((m) => m.matchNumber === 1) as MatchDTO
    const winnerId = m1.athleteAId as string

    await recordResult(token, event.id, division.id, 1, { winnerId, isWalkover: false })
    const again = await recordResult(token, event.id, division.id, 1, { winnerId, isWalkover: false })
    expect(again.statusCode).toBe(409)
  })

  it('rejects a winnerId that is not a participant', async () => {
    const token = await setupAdmin()
    const event = await createEvent(token)
    const division = await createDivision(token, event.id)
    for (let i = 0; i < 8; i++) await confirmedEntry(token, event.id, division.id)
    await generate(token, event.id, division.id, { format: 'elimination' })

    const res = await recordResult(token, event.id, division.id, 1, { winnerId: '000000000000000000000000', isWalkover: false })
    expect(res.statusCode).toBe(400)
  })

  it('auto-generates repechage matches once both feeder quarterfinals of a semifinal are decided', async () => {
    const token = await setupAdmin()
    const event = await createEvent(token)
    const division = await createDivision(token, event.id)
    for (let i = 0; i < 8; i++) await confirmedEntry(token, event.id, division.id)
    await generate(token, event.id, division.id, { format: 'elimination', repechageType: 'normal', seed: 7 })

    let matches = await listMatches(token, event.id, division.id)
    expect(matches).toHaveLength(7) // no repechage matches yet

    const round1 = matches.filter((m) => m.round === 1).sort((a, b) => a.matchNumber - b.matchNumber)
    // Play the two round-1 matches that feed the same semifinal.
    const sfTarget = round1[0]!.nextMatchNumber
    const feeders = round1.filter((m) => m.nextMatchNumber === sfTarget)
    expect(feeders).toHaveLength(2)
    for (const m of feeders) {
      await recordResult(token, event.id, division.id, m.matchNumber, { winnerId: m.athleteAId, isWalkover: false })
    }

    matches = await listMatches(token, event.id, division.id)
    const repechage = matches.filter((m) => m.stage === 'repechage')
    expect(repechage).toHaveLength(1)
    expect(repechage[0]?.groupMatchNumber).toBe(sfTarget)

    // Calling result on the other pair must not duplicate the repechage match.
    const otherFeeders = round1.filter((m) => m.nextMatchNumber !== sfTarget)
    for (const m of otherFeeders) {
      await recordResult(token, event.id, division.id, m.matchNumber, { winnerId: m.athleteAId, isWalkover: false })
    }
    matches = await listMatches(token, event.id, division.id)
    expect(matches.filter((m) => m.stage === 'repechage')).toHaveLength(2)
  })

  it('RBAC: recording a result requires event_manager+', async () => {
    const adminToken = await setupAdmin()
    const event = await createEvent(adminToken)
    const division = await createDivision(adminToken, event.id)
    for (let i = 0; i < 8; i++) await confirmedEntry(adminToken, event.id, division.id)
    await generate(adminToken, event.id, division.id, { format: 'elimination' })
    const matches = await listMatches(adminToken, event.id, division.id)
    const m1 = matches.find((m) => m.matchNumber === 1) as MatchDTO

    const staffToken = await createUserAndLogin(adminToken, 'staff', 'staff@test.com')
    const res = await recordResult(staffToken, event.id, division.id, 1, { winnerId: m1.athleteAId, isWalkover: false })
    expect(res.statusCode).toBe(403)
  })
})

describe('POST .../matches/:mid/correct', () => {
  it('requires a reason and only allows correcting a match whose result has not yet propagated', async () => {
    const token = await setupAdmin()
    const event = await createEvent(token)
    const division = await createDivision(token, event.id)
    for (let i = 0; i < 8; i++) await confirmedEntry(token, event.id, division.id)
    await generate(token, event.id, division.id, { format: 'elimination', seed: 3 })

    const matches = await listMatches(token, event.id, division.id)
    const m1 = matches.find((m) => m.matchNumber === 1) as MatchDTO
    const [a, b] = [m1.athleteAId as string, m1.athleteBId as string]
    await recordResult(token, event.id, division.id, 1, { winnerId: a, isWalkover: false })

    const noReason = await correctResult(token, event.id, division.id, 1, { winnerId: b, isWalkover: false, reason: '' })
    expect(noReason.statusCode).toBe(400)

    const corrected = await correctResult(token, event.id, division.id, 1, { winnerId: b, isWalkover: false, reason: 'placar trocado' })
    expect(corrected.statusCode).toBe(200)
    expect(corrected.json<MatchDTO>().result?.winnerId).toBe(b)

    // propagation follows the corrected winner
    const after = await listMatches(token, event.id, division.id)
    const next = after.find((m) => m.matchNumber === m1.nextMatchNumber) as MatchDTO
    const slotValue = m1.nextMatchSlot === 'A' ? next.athleteAId : next.athleteBId
    expect(slotValue).toBe(b)

    // correcting again is still fine while the next match hasn't been fought yet
    const secondCorrection = await correctResult(token, event.id, division.id, 1, { winnerId: a, isWalkover: false, reason: 'de novo' })
    expect(secondCorrection.statusCode).toBe(200)
    await correctResult(token, event.id, division.id, 1, { winnerId: b, isWalkover: false, reason: 'placar trocado outra vez' })

    // play the other round-1 match feeding the same next match, then decide
    // the next match itself — now b's participation there is a real result
    const otherFeeder = matches.find((m) => m.round === 1 && m.matchNumber !== 1 && m.nextMatchNumber === m1.nextMatchNumber) as MatchDTO
    await recordResult(token, event.id, division.id, otherFeeder.matchNumber, { winnerId: otherFeeder.athleteAId, isWalkover: false })
    const nextMatch = (await listMatches(token, event.id, division.id)).find((m) => m.matchNumber === m1.nextMatchNumber) as MatchDTO
    await recordResult(token, event.id, division.id, nextMatch.matchNumber, { winnerId: b, isWalkover: false })

    // ...now that a downstream match has an actual recorded result, correcting match 1 is blocked
    const blocked = await correctResult(token, event.id, division.id, 1, { winnerId: a, isWalkover: false, reason: 'de novo' })
    expect(blocked.statusCode).toBe(409)
  })

  it('returns 409 correcting a match that has no result yet', async () => {
    const token = await setupAdmin()
    const event = await createEvent(token)
    const division = await createDivision(token, event.id)
    for (let i = 0; i < 8; i++) await confirmedEntry(token, event.id, division.id)
    await generate(token, event.id, division.id, { format: 'elimination' })
    const matches = await listMatches(token, event.id, division.id)
    const m1 = matches.find((m) => m.matchNumber === 1) as MatchDTO

    const res = await correctResult(token, event.id, division.id, 1, { winnerId: m1.athleteAId, isWalkover: false, reason: 'x' })
    expect(res.statusCode).toBe(409)
  })

  it('RBAC: correcting a result requires event_manager+', async () => {
    const adminToken = await setupAdmin()
    const event = await createEvent(adminToken)
    const division = await createDivision(adminToken, event.id)
    for (let i = 0; i < 8; i++) await confirmedEntry(adminToken, event.id, division.id)
    await generate(adminToken, event.id, division.id, { format: 'elimination' })
    const matches = await listMatches(adminToken, event.id, division.id)
    const m1 = matches.find((m) => m.matchNumber === 1) as MatchDTO
    await recordResult(adminToken, event.id, division.id, 1, { winnerId: m1.athleteAId, isWalkover: false })

    const staffToken = await createUserAndLogin(adminToken, 'staff', 'staff@test.com')
    const res = await correctResult(staffToken, event.id, division.id, 1, { winnerId: m1.athleteBId, isWalkover: false, reason: 'x' })
    expect(res.statusCode).toBe(403)
  })
})

describe('Rodízio bracket', () => {
  it('generates the fixed schedule and records results independently', async () => {
    const token = await setupAdmin()
    const event = await createEvent(token)
    const division = await createDivision(token, event.id)
    for (let i = 0; i < 4; i++) await confirmedEntry(token, event.id, division.id)

    const res = await generate(token, event.id, division.id, { format: 'rodizio', seed: 9 })
    expect(res.statusCode).toBe(201)
    const bracket = res.json<BracketDTO>()
    expect(bracket.format).toBe('rodizio')
    expect(bracket.size).toBeUndefined()

    const matches = await listMatches(token, event.id, division.id)
    expect(matches).toHaveLength(6) // Rodízio-4

    const m1 = matches.find((m) => m.matchNumber === 1) as MatchDTO
    const res2 = await recordResult(token, event.id, division.id, 1, { winnerId: m1.athleteAId, isWalkover: false, points: 10 })
    expect(res2.statusCode).toBe(200)

    // Rodízio matches have no bracket propagation.
    const others = (await listMatches(token, event.id, division.id)).filter((m) => m.matchNumber !== 1)
    expect(others.every((m) => m.result === null)).toBe(true)
  })
})
