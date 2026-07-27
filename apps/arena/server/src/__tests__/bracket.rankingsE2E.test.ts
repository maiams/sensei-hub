import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { connectTestDb, closeTestDb, clearTestDb } from '@sensei-hub/core-server/testing'
import { buildApp } from '../app.js'
import type { FastifyInstance } from 'fastify'

// Full HTTP-level playthroughs of an elimination bracket, from entry
// confirmation to GET .../rankings. Complements bracket.test.ts (which
// exercises generation/result/correction individually) and
// bracket.eliminationByeIntegrity.test.ts (pure-engine bye regression):
// the /rankings endpoint itself had no integration coverage anywhere in the
// suite before this file, and no existing test drove a bracket all the way
// to a champion through the real HTTP routes.

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
  athleteAId: string | null
  athleteBId: string | null
  nextMatchNumber: number | null
  result: { winnerId: string } | null
}
interface RankingDTO {
  place: number
  athleteId: string
  fullName: string
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

async function createEvent(token: string) {
  const res = await app.inject({
    method: 'POST',
    url: '/api/events',
    headers: { authorization: `Bearer ${token}` },
    payload: { name: 'Copa Teste', eventDate: '2026-08-01' },
  })
  return res.json<EventDTO>()
}

async function createDivision(token: string, eventId: string) {
  const res = await app.inject({
    method: 'POST',
    url: `/api/events/${eventId}/divisions`,
    headers: { authorization: `Bearer ${token}` },
    payload: { name: 'Adulto Médio', weightLimitKg: 90 },
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
  return { athleteId, entryId: entry.id as string }
}

async function generate(token: string, eventId: string, divisionId: string, body: Record<string, unknown>) {
  return app.inject({
    method: 'POST',
    url: `/api/events/${eventId}/divisions/${divisionId}/bracket`,
    headers: { authorization: `Bearer ${token}` },
    payload: body,
  })
}

async function recordResult(token: string, eventId: string, divisionId: string, matchNumber: number, winnerId: string) {
  return app.inject({
    method: 'POST',
    url: `/api/events/${eventId}/divisions/${divisionId}/matches/${matchNumber}/result`,
    headers: { authorization: `Bearer ${token}` },
    payload: { winnerId, isWalkover: false },
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

async function getRankings(token: string, eventId: string, divisionId: string) {
  return app.inject({
    method: 'GET',
    url: `/api/events/${eventId}/divisions/${divisionId}/rankings`,
    headers: { authorization: `Bearer ${token}` },
  })
}

describe('GET .../rankings — end-to-end elimination playthrough', () => {
  it('returns 409 while undecided, then a coherent 1st/2nd/3rd once an 8-athlete bracket is fully played', async () => {
    const token = await setupAdmin()
    const event = await createEvent(token)
    const division = await createDivision(token, event.id)
    for (let i = 0; i < 8; i++) await confirmedEntry(token, event.id, division.id)
    await generate(token, event.id, division.id, { format: 'elimination', seed: 2026, repechageType: 'nenhuma' })

    const early = await getRankings(token, event.id, division.id)
    expect(early.statusCode).toBe(409)

    // Play round 1 (matches 1-4), then round 2 (5-6), then the final (7),
    // always picking athleteAId as the winner — deterministic and simple.
    for (const round of [1, 2, 3]) {
      const matches = (await listMatches(token, event.id, division.id)).filter((m) => m.round === round)
      for (const m of matches) {
        expect(m.athleteAId, `match ${m.matchNumber} must have both slots filled once its round is reached`).not.toBeNull()
        expect(m.athleteBId).not.toBeNull()
        const res = await recordResult(token, event.id, division.id, m.matchNumber, m.athleteAId as string)
        expect(res.statusCode).toBe(200)
      }
    }

    const final = await getRankings(token, event.id, division.id)
    expect(final.statusCode).toBe(200)
    const rankings = final.json<RankingDTO[]>()
    expect(rankings.filter((r) => r.place === 1)).toHaveLength(1)
    expect(rankings.filter((r) => r.place === 2)).toHaveLength(1)
    expect(rankings.filter((r) => r.place === 3)).toHaveLength(2) // two bronzes, no repechage
    const champion = rankings.find((r) => r.place === 1)
    const matches = await listMatches(token, event.id, division.id)
    const decidedFinal = matches.find((m) => m.round === 3) as MatchDTO
    expect(champion?.athleteId).toBe(decidedFinal.result?.winnerId)
  })

  it('5 confirmed entries (odd, non-power-of-two) in a Chave-8: the bye recipient must actually fight their real semifinal before rankings are coherent', async () => {
    const token = await setupAdmin()
    const event = await createEvent(token)
    const division = await createDivision(token, event.id)
    for (let i = 0; i < 5; i++) await confirmedEntry(token, event.id, division.id)
    await generate(token, event.id, division.id, { format: 'elimination', seed: 7, repechageType: 'nenhuma' })

    let matches = await listMatches(token, event.id, division.id)
    const final = matches.find((m) => m.round === 3) as MatchDTO
    // Regression guard: the final must NOT be pre-populated at generation time.
    expect(final.athleteAId).toBeNull()
    expect(final.athleteBId).toBeNull()

    // Play every round-1 match that has two real, live athletes (byes have
    // no result to record — they already have an implicit winner).
    const round1 = matches.filter((m) => m.round === 1 && m.athleteAId !== null && m.athleteBId !== null)
    for (const m of round1) {
      const res = await recordResult(token, event.id, division.id, m.matchNumber, m.athleteAId as string)
      expect(res.statusCode).toBe(200)
    }

    // Now round 2 must show REAL, fightable semifinals — not a pre-decided
    // bye chain — for every match whose slots are both filled.
    matches = await listMatches(token, event.id, division.id)
    const round2 = matches.filter((m) => m.round === 2)
    for (const m of round2) {
      if (m.athleteAId !== null && m.athleteBId !== null) {
        const res = await recordResult(token, event.id, division.id, m.matchNumber, m.athleteAId as string)
        expect(res.statusCode).toBe(200)
      }
    }

    // The final must still require an actual decided semifinal on both
    // sides before it's playable/rankable.
    matches = await listMatches(token, event.id, division.id)
    const finalAfterSF = matches.find((m) => m.round === 3) as MatchDTO
    expect(finalAfterSF.athleteAId).not.toBeNull()
    expect(finalAfterSF.athleteBId).not.toBeNull()

    const beforeFinal = await getRankings(token, event.id, division.id)
    expect(beforeFinal.statusCode).toBe(409)

    await recordResult(token, event.id, division.id, 7, finalAfterSF.athleteAId as string)

    const finalRankings = await getRankings(token, event.id, division.id)
    expect(finalRankings.statusCode).toBe(200)
    const rankings = finalRankings.json<RankingDTO[]>()
    expect(rankings.find((r) => r.place === 1)?.athleteId).toBe(finalAfterSF.athleteAId)
  })
})
