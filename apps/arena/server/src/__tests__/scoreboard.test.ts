import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { connectTestDb, closeTestDb, clearTestDb } from '@sensei-hub/core-server/testing'
import { buildApp } from '../app.js'
import { ScoreboardModel } from '../repositories/ScoreboardModel.js'
import { MatchModel } from '../repositories/MatchModel.js'
import { AuditLogModel } from '@sensei-hub/core-server'
import { scoreboardEvents } from '../services/ScoreboardService.js'
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

interface ScoreboardDTO {
  id: string
  matchId: string
  matchNumber: number
  phase: 'regular' | 'golden_score'
  status: 'active' | 'completed' | 'aborted'
  matchRules: { matchDurationSeconds: number; goldenScoreEnabled: boolean }
  clock: { clockMs: number; running: boolean; lastStartedAt: string | null; countsUp: boolean }
  osaekomi: { holder: 'A' | 'B'; startedAt: string } | null
  sides: {
    A: { athleteId: string; displayName: string; identity: string | null; ippon: number; wazaari: number; yuko: number; shido: number; hansokuMake: boolean }
    B: { athleteId: string; displayName: string; identity: string | null; ippon: number; wazaari: number; yuko: number; shido: number; hansokuMake: boolean }
  }
  winner: { athleteId: string; method: string } | null
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

let athleteCounter = 0
async function confirmedEntry(
  token: string,
  eventId: string,
  divisionId: string,
  overrides: Record<string, unknown> = {},
) {
  athleteCounter++
  const athlete = await app.inject({
    method: 'POST',
    url: '/api/athletes',
    headers: { authorization: `Bearer ${token}` },
    payload: {
      fullName: `Atleta Sobrenome${athleteCounter}`,
      gender: 'male',
      birthDate: '1990-01-01',
      currentBelt: 'blue',
      termsAccepted: true,
      imageAuthorizationAccepted: true,
      ...overrides,
    },
  })
  const athleteId = athlete.json<{ id: string }>().id

  const created = await app.inject({
    method: 'POST',
    url: `/api/events/${eventId}/entries`,
    headers: { authorization: `Bearer ${token}` },
    payload: { divisionId, athleteId },
  })
  const entry = created.json<{ id: string }>()

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

// Full pipeline: event → division (custom rules) → 3 confirmed athletes →
// rodizio bracket → area → dispatch → the returned { token, eventId, ... }
// is everything a scoreboard test needs.
async function setupFight(options: {
  divisionRules?: Record<string, unknown>
  eventOverrides?: Record<string, unknown>
  athleteOverrides?: Record<string, unknown>[]
  athleteCount?: number
} = {}) {
  const token = await setupAdmin()
  const eventRes = await app.inject({
    method: 'POST',
    url: '/api/events',
    headers: { authorization: `Bearer ${token}` },
    payload: { name: 'Copa Placar', eventDate: '2026-08-01', ...(options.eventOverrides ?? {}) },
  })
  const eventId = eventRes.json<{ id: string }>().id

  const divisionRes = await app.inject({
    method: 'POST',
    url: `/api/events/${eventId}/divisions`,
    headers: { authorization: `Bearer ${token}` },
    payload: { name: 'Adulto Médio', weightLimitKg: 90, ...(options.divisionRules ?? {}) },
  })
  const divisionId = divisionRes.json<{ id: string }>().id

  const athleteIds: string[] = []
  for (let i = 0; i < (options.athleteCount ?? 3); i++) {
    athleteIds.push(await confirmedEntry(token, eventId, divisionId, options.athleteOverrides?.[i] ?? {}))
  }

  await app.inject({
    method: 'POST',
    url: `/api/events/${eventId}/divisions/${divisionId}/bracket`,
    headers: { authorization: `Bearer ${token}` },
    payload: { format: 'rodizio', seed: 42 },
  })

  const areaRes = await app.inject({
    method: 'POST',
    url: `/api/events/${eventId}/areas`,
    headers: { authorization: `Bearer ${token}` },
    payload: { name: 'Mesa 1' },
  })
  const areaId = areaRes.json<{ id: string }>().id

  const nextRes = await app.inject({
    method: 'POST',
    url: `/api/events/${eventId}/areas/${areaId}/next-match`,
    headers: { authorization: `Bearer ${token}` },
  })
  const match = nextRes.json<{ match: { id: string; matchNumber: number } }>().match

  return { token, eventId, divisionId, areaId, match, athleteIds }
}

async function startScoreboard(token: string, eventId: string, areaId: string, matchId: string) {
  const res = await app.inject({
    method: 'POST',
    url: `/api/events/${eventId}/areas/${areaId}/scoreboard`,
    headers: { authorization: `Bearer ${token}` },
    payload: { matchId },
  })
  return res
}

async function act(token: string, scoreboardId: string, action: string, payload?: Record<string, unknown>) {
  return app.inject({
    method: 'POST',
    url: `/api/scoreboards/${scoreboardId}/${action}`,
    headers: { authorization: `Bearer ${token}` },
    ...(payload !== undefined ? { payload } : {}),
  })
}

describe('Scoreboard lifecycle', () => {
  it('starts from a dispatched match with the division matchRules snapshot, and is idempotent', async () => {
    const { token, eventId, areaId, match } = await setupFight({
      divisionRules: {
        matchRules: {
          matchDurationSeconds: 180,
          goldenScoreEnabled: true,
          goldenScoreDurationSeconds: null,
          osaekomiYukoSeconds: 5,
          osaekomiWazaariSeconds: 10,
          osaekomiIpponSeconds: 20,
        },
      },
    })

    const res = await startScoreboard(token, eventId, areaId, match.id)
    expect(res.statusCode).toBe(201)
    const dto = res.json<ScoreboardDTO>()
    expect(dto.status).toBe('active')
    expect(dto.phase).toBe('regular')
    expect(dto.matchRules.matchDurationSeconds).toBe(180)
    expect(dto.clock).toMatchObject({ clockMs: 180_000, running: false, countsUp: false })
    expect(dto.sides.A.displayName).toMatch(/^Atleta Sobrenome\d+$/)

    const again = await startScoreboard(token, eventId, areaId, match.id)
    expect(again.statusCode).toBe(201)
    expect(again.json<ScoreboardDTO>().id).toBe(dto.id)
  })

  it('refuses to start a match that was not dispatched to the area', async () => {
    const { token, eventId, match } = await setupFight()
    const otherAreaRes = await app.inject({
      method: 'POST',
      url: `/api/events/${eventId}/areas`,
      headers: { authorization: `Bearer ${token}` },
      payload: { name: 'Mesa 2' },
    })
    const otherAreaId = otherAreaRes.json<{ id: string }>().id

    const res = await startScoreboard(token, eventId, otherAreaId, match.id)
    expect(res.statusCode).toBe(409)
  })

  it('runs the clock, scores waza-ari to awasete-ippon (freezing the clock), and declares the winner into the bracket', async () => {
    const { token, eventId, divisionId, areaId, match } = await setupFight()
    const sb = (await startScoreboard(token, eventId, areaId, match.id)).json<ScoreboardDTO>()

    const started = (await act(token, sb.id, 'clock/start')).json<ScoreboardDTO>()
    expect(started.clock.running).toBe(true)
    expect(started.clock.lastStartedAt).not.toBeNull()

    await act(token, sb.id, 'score', { side: 'A', type: 'wazaari' })
    const after = (await act(token, sb.id, 'score', { side: 'A', type: 'wazaari' })).json<ScoreboardDTO>()
    expect(after.sides.A).toMatchObject({ wazaari: 2, ippon: 1 })
    // decisive score freezes the clock
    expect(after.clock.running).toBe(false)

    const winnerRes = await act(token, sb.id, 'winner', { winnerId: after.sides.A.athleteId, method: 'ippon' })
    expect(winnerRes.statusCode).toBe(200)
    const done = winnerRes.json<ScoreboardDTO>()
    expect(done.status).toBe('completed')
    expect(done.winner).toMatchObject({ athleteId: after.sides.A.athleteId, method: 'ippon' })

    // the bracket match got the result (Fase 3C flow), with decidedAt stamped
    const matches = await app.inject({
      method: 'GET',
      url: `/api/events/${eventId}/divisions/${divisionId}/matches`,
      headers: { authorization: `Bearer ${token}` },
    })
    const recorded = matches
      .json<Array<{ matchNumber: number; result: { winnerId: string; method?: string; decidedAt?: string } | null }>>()
      .find((m) => m.matchNumber === sb.matchNumber)
    expect(recorded?.result?.winnerId).toBe(after.sides.A.athleteId)
    expect(recorded?.result?.method).toBe('ippon')
    expect(recorded?.result?.decidedAt).toBeDefined()

    // no further mutations on a completed scoreboard
    expect((await act(token, sb.id, 'score', { side: 'B', type: 'yuko' })).statusCode).toBe(409)
  })

  it('converts osaekomi held time into the score (20s = ippon with CBJ defaults)', async () => {
    const { token, eventId, areaId, match } = await setupFight()
    const sb = (await startScoreboard(token, eventId, areaId, match.id)).json<ScoreboardDTO>()

    await act(token, sb.id, 'clock/start')
    const started = (await act(token, sb.id, 'osaekomi/start', { holder: 'A' })).json<ScoreboardDTO>()
    expect(started.osaekomi?.holder).toBe('A')
    expect((await act(token, sb.id, 'osaekomi/start', { holder: 'B' })).statusCode).toBe(409)

    // backdate the osaekomi start so the elapsed time is deterministic
    await ScoreboardModel.updateOne(
      { _id: sb.id },
      { $set: { 'osaekomi.startedAt': new Date(Date.now() - 21_000) } },
    )

    const stopRes = await act(token, sb.id, 'osaekomi/stop')
    expect(stopRes.statusCode).toBe(200)
    const { scoreboard, award } = stopRes.json<{ scoreboard: ScoreboardDTO; award: string }>()
    expect(award).toBe('ippon')
    expect(scoreboard.sides.A.ippon).toBe(1)
    expect(scoreboard.osaekomi).toBeNull()
    expect(scoreboard.clock.running).toBe(false) // ippon freezes the clock
  })

  it('golden score requires a tied board (the leader simply wins at time end)', async () => {
    const { token, eventId, areaId, match } = await setupFight()
    const sb = (await startScoreboard(token, eventId, areaId, match.id)).json<ScoreboardDTO>()

    await act(token, sb.id, 'score', { side: 'A', type: 'yuko' })
    expect((await act(token, sb.id, 'golden-score')).statusCode).toBe(409) // A leads by yuko

    await act(token, sb.id, 'score', { side: 'B', type: 'yuko' })
    expect((await act(token, sb.id, 'golden-score')).statusCode).toBe(200) // tied again

    expect((await act(token, sb.id, 'golden-score')).statusCode).toBe(409) // already in GS
  })

  it('golden score respects goldenScoreEnabled=false', async () => {
    const { token, eventId, areaId, match } = await setupFight({
      divisionRules: {
        matchRules: {
          matchDurationSeconds: 120,
          goldenScoreEnabled: false,
          goldenScoreDurationSeconds: null,
          osaekomiYukoSeconds: 5,
          osaekomiWazaariSeconds: 10,
          osaekomiIpponSeconds: 20,
        },
      },
    })
    const sb = (await startScoreboard(token, eventId, areaId, match.id)).json<ScoreboardDTO>()
    expect((await act(token, sb.id, 'golden-score')).statusCode).toBe(409)
  })

  it('in golden score the clock counts up (no limit) and the first score freezes it', async () => {
    const { token, eventId, areaId, match } = await setupFight()
    const sb = (await startScoreboard(token, eventId, areaId, match.id)).json<ScoreboardDTO>()

    const gs = (await act(token, sb.id, 'golden-score')).json<ScoreboardDTO>()
    expect(gs.phase).toBe('golden_score')
    expect(gs.clock).toMatchObject({ clockMs: 0, countsUp: true, running: false })

    await act(token, sb.id, 'clock/start')
    const after = (await act(token, sb.id, 'score', { side: 'B', type: 'yuko' })).json<ScoreboardDTO>()
    expect(after.clock.running).toBe(false) // first score in GS is decisive
  })

  it('score removal requires a reason and undoes awasete-ippon', async () => {
    const { token, eventId, areaId, match } = await setupFight()
    const sb = (await startScoreboard(token, eventId, areaId, match.id)).json<ScoreboardDTO>()

    await act(token, sb.id, 'score', { side: 'A', type: 'wazaari' })
    await act(token, sb.id, 'score', { side: 'A', type: 'wazaari' })

    expect((await act(token, sb.id, 'score/remove', { side: 'A', type: 'wazaari' })).statusCode).toBe(400) // no reason
    const removed = (
      await act(token, sb.id, 'score/remove', { side: 'A', type: 'wazaari', reason: 'marcado errado' })
    ).json<ScoreboardDTO>()
    expect(removed.sides.A).toMatchObject({ wazaari: 1, ippon: 0 })
  })

  it('abort releases the match back to the dispatch pool', async () => {
    const { token, eventId, areaId, match } = await setupFight()
    const sb = (await startScoreboard(token, eventId, areaId, match.id)).json<ScoreboardDTO>()

    const res = await act(token, sb.id, 'abort', { reason: 'atleta não compareceu à mesa' })
    expect(res.statusCode).toBe(200)
    expect(res.json<ScoreboardDTO>().status).toBe('aborted')

    // the match went back to the pool (no area) and can be brought back and
    // fought on a fresh scoreboard
    const matchesRes = await app.inject({
      method: 'GET',
      url: `/api/events/${eventId}/divisions/${(await app.inject({ method: 'GET', url: `/api/events/${eventId}/divisions`, headers: { authorization: `Bearer ${token}` } })).json<Array<{ id: string }>>()[0]?.id}/matches`,
      headers: { authorization: `Bearer ${token}` },
    })
    const released = matchesRes.json<Array<{ id: string; areaId?: string | null }>>().find((m) => m.id === match.id)
    expect(released?.areaId ?? null).toBeNull()

    const forced = await app.inject({
      method: 'POST',
      url: `/api/events/${eventId}/areas/${areaId}/force-match`,
      headers: { authorization: `Bearer ${token}` },
      payload: { matchId: match.id },
    })
    expect(forced.statusCode).toBe(200)
    const restarted = await startScoreboard(token, eventId, areaId, match.id)
    expect(restarted.statusCode).toBe(201)
    expect(restarted.json<ScoreboardDTO>().id).not.toBe(sb.id)
  })

  it('RBAC: scoreboard mutations require scoreboard_operator+', async () => {
    const { token, eventId, areaId, match } = await setupFight()
    const athleteToken = await createUserAndLogin(token, 'athlete', 'athlete@test.com')

    expect((await startScoreboard(athleteToken, eventId, areaId, match.id)).statusCode).toBe(403)

    const sb = (await startScoreboard(token, eventId, areaId, match.id)).json<ScoreboardDTO>()
    expect(
      (
        await app.inject({
          method: 'POST',
          url: `/api/scoreboards/${sb.id}/score`,
          headers: { authorization: `Bearer ${athleteToken}` },
          payload: { side: 'A', type: 'yuko' },
        })
      ).statusCode,
    ).toBe(403)
  })

  // The mesário does not cancel a fight anymore — only event_manager+ can
  // abort (wrong athletes at the table, etc.), reason required, audited.
  // Hiding the button client-side is not authorization, so this must be
  // enforced server-side regardless of what the UI shows.
  it('RBAC: abort requires event_manager+, not just scoreboard_operator', async () => {
    const { token, eventId, areaId, match } = await setupFight()
    const operatorToken = await createUserAndLogin(token, 'scoreboard_operator', 'mesario@test.com')
    const managerToken = await createUserAndLogin(token, 'event_manager', 'gerente@test.com')

    const sb1 = (await startScoreboard(token, eventId, areaId, match.id)).json<ScoreboardDTO>()
    const deniedRes = await act(operatorToken, sb1.id, 'abort', { reason: 'atletas errados na mesa' })
    expect(deniedRes.statusCode).toBe(403)

    // still active — the denied attempt did not mutate anything
    const stillActive = await act(token, sb1.id, 'clock/start')
    expect(stillActive.statusCode).toBe(200)
    expect(stillActive.json<ScoreboardDTO>().status).toBe('active')

    const allowedRes = await act(managerToken, sb1.id, 'abort', { reason: 'atletas errados na mesa' })
    expect(allowedRes.statusCode).toBe(200)
    expect(allowedRes.json<ScoreboardDTO>().status).toBe('aborted')

    // audited with the reason and the actual actor (the manager, not the denied operator)
    const auditEntry = await AuditLogModel.findOne({
      entityType: 'Scoreboard',
      entityId: sb1.id,
      fieldName: 'status',
      newValue: 'aborted',
    })
    expect(auditEntry?.reason).toBe('atletas errados na mesa')
  })
})

describe('Public payloads and privacy', () => {
  it('public scoreboard hides minor names when the event sets publicHideNamesUnderAge; operator keeps full names', async () => {
    const { token, eventId, areaId, match } = await setupFight({
      eventOverrides: { publicHideNamesUnderAge: 18 },
      athleteOverrides: [
        { fullName: 'Maria Silva Santos', birthDate: '2015-05-05', guardianName: 'Resp Silva', guardianPhone: '11999990000' }, // 11 at event date → hidden
        { fullName: 'José Oliveira', birthDate: '1990-01-01' },
        { fullName: 'Pedro Souza', birthDate: '1991-01-01' },
      ],
    })

    const sb = (await startScoreboard(token, eventId, areaId, match.id)).json<ScoreboardDTO>()
    const operatorNames = [sb.sides.A.displayName, sb.sides.B.displayName]

    const pub = await app.inject({ method: 'GET', url: `/api/public/areas/${areaId}/scoreboard` })
    expect(pub.statusCode).toBe(200)
    const publicSb = pub.json<{ scoreboard: ScoreboardDTO }>().scoreboard
    const publicNames = [publicSb.sides.A.displayName, publicSb.sides.B.displayName]

    if (operatorNames.includes('Maria Silva Santos')) {
      expect(publicNames).toContain('Maria S.')
      expect(publicNames).not.toContain('Maria Silva Santos')
    }
    // adults are never masked
    for (const adult of ['José Oliveira', 'Pedro Souza']) {
      if (operatorNames.includes(adult)) expect(publicNames).toContain(adult)
    }
  })

  it('gives the operator a resolved identity label per side, but never exposes it on the public payload', async () => {
    const { token, eventId, areaId, match } = await setupFight({
      athleteOverrides: [
        {
          fullName: 'Alice Alves Rodrigues',
          birthDate: '2012-04-01',
          cpf: '11144477735',
          guardianName: 'Resp Alves',
          guardianPhone: '11999990001',
        },
        {
          fullName: 'Alice Gomes Rodrigues',
          birthDate: '2014-06-10',
          guardianName: 'Resp Gomes',
          guardianPhone: '11999990002',
        },
        { fullName: 'Terceira Atleta', birthDate: '1990-01-01' },
      ],
    })

    const sb = (await startScoreboard(token, eventId, areaId, match.id)).json<ScoreboardDTO>()
    // Whichever two of the three fought, the operator sees a non-empty identity for both.
    expect(sb.sides.A.identity).toBeTruthy()
    expect(sb.sides.B.identity).toBeTruthy()
    // The CPF-derived one is masked — the raw number never appears.
    for (const side of [sb.sides.A, sb.sides.B]) {
      if (side.displayName === 'Alice Alves Rodrigues') {
        expect(side.identity).toBe('CPF ***.***.***-35')
      }
      if (side.displayName === 'Alice Gomes Rodrigues') {
        expect(side.identity).toBe('nasc. 2014')
      }
    }
    expect(JSON.stringify(sb)).not.toContain('11144477735')

    const pub = await app.inject({ method: 'GET', url: `/api/public/areas/${areaId}/scoreboard` })
    const publicSb = pub.json<{ scoreboard: ScoreboardDTO }>().scoreboard
    expect(publicSb.sides.A.identity).toBeNull()
    expect(publicSb.sides.B.identity).toBeNull()
  })

  it('broadcasts the privacy-filtered public DTO on every mutation', async () => {
    const { token, eventId, areaId, match } = await setupFight({
      eventOverrides: { publicHideNamesUnderAge: 18 },
      athleteOverrides: [
        { fullName: 'Maria Silva Santos', birthDate: '2015-05-05', guardianName: 'Resp Silva', guardianPhone: '11999990000' },
        { fullName: 'José Oliveira', birthDate: '1990-01-01' },
        { fullName: 'Pedro Souza', birthDate: '1991-01-01' },
      ],
    })

    const sb = (await startScoreboard(token, eventId, areaId, match.id)).json<ScoreboardDTO>()

    const received: ScoreboardDTO[] = []
    const listener = (payload: ScoreboardDTO) => received.push(payload)
    scoreboardEvents.on(`area:${areaId}`, listener)
    try {
      await act(token, sb.id, 'score', { side: 'A', type: 'yuko' })
    } finally {
      scoreboardEvents.off(`area:${areaId}`, listener)
    }

    expect(received).toHaveLength(1)
    const names = [received[0]?.sides.A.displayName, received[0]?.sides.B.displayName]
    expect(names).not.toContain('Maria Silva Santos')
  })

  it('the public event display lists areas, current fights and the upcoming queue with rest countdowns', async () => {
    const { token, eventId, areaId, match, athleteIds } = await setupFight()

    const sb = (await startScoreboard(token, eventId, areaId, match.id)).json<ScoreboardDTO>()
    await act(token, sb.id, 'winner', { winnerId: sb.sides.A.athleteId, method: 'ippon' })

    const res = await app.inject({ method: 'GET', url: `/api/public/events/${eventId}/display` })
    expect(res.statusCode).toBe(200)
    const display = res.json<{
      areas: Array<{ id: string; scoreboard: ScoreboardDTO | null }>
      upcoming: Array<{
        matchNumber: number
        athleteA: { displayName: string; restingUntil: string | null }
        athleteB: { displayName: string; restingUntil: string | null }
      }>
    }>()

    expect(display.areas).toHaveLength(1)
    expect(display.areas[0]?.scoreboard?.status).toBe('completed')

    // rodizio-3: the two remaining matches are upcoming; the two athletes who
    // just fought are resting
    expect(display.upcoming.length).toBe(2)
    const resting = display.upcoming
      .flatMap((m) => [m.athleteA, m.athleteB])
      .filter((a) => a.restingUntil !== null)
    expect(resting.length).toBeGreaterThan(0)
    void athleteIds
  })

  it('orders the upcoming queue by matchNumber, not by last-updated (the venue board must be predictable)', async () => {
    // 4 athletes → rodizio round-robin = 6 matches; one gets dispatched to
    // the area, leaving 5 upcoming — enough to prove ordering isn't by chance.
    const { eventId, areaId, match } = await setupFight({ athleteCount: 4 })
    void areaId
    void match

    // Touch matches in reverse order so `updatedAt` (the old, buggy sort key)
    // would come out backwards if it were still in play.
    const allMatches = await MatchModel.find({ eventId }).sort({ matchNumber: 1 })
    for (const m of [...allMatches].reverse()) {
      await MatchModel.updateOne({ _id: m._id }, { $set: { updatedAt: new Date() } })
    }

    const res = await app.inject({ method: 'GET', url: `/api/public/events/${eventId}/display` })
    expect(res.statusCode).toBe(200)
    const display = res.json<{ upcoming: Array<{ matchNumber: number }> }>()

    expect(display.upcoming.length).toBeGreaterThan(1)
    const numbers = display.upcoming.map((m) => m.matchNumber)
    const sorted = [...numbers].sort((a, b) => a - b)
    expect(numbers).toEqual(sorted)
  })
})

describe('Manual dispatch override (force-match)', () => {
  it('moves a queued match to an area, enforcing rest unless ignoreRest, and refuses live matches', async () => {
    const { token, eventId, areaId, match } = await setupFight()

    // finish the dispatched match so its athletes are resting
    const sb = (await startScoreboard(token, eventId, areaId, match.id)).json<ScoreboardDTO>()
    await act(token, sb.id, 'winner', { winnerId: sb.sides.A.athleteId, method: 'ippon' })

    // rodizio-3 schedule: next ready match shares no athlete... actually every
    // match shares athletes in a 3-person pool, so ALL remaining matches are
    // rest-blocked right now — exactly what force-match must handle.
    const matches = await app.inject({
      method: 'GET',
      url: `/api/events/${eventId}/divisions/${(await app.inject({ method: 'GET', url: `/api/events/${eventId}/divisions`, headers: { authorization: `Bearer ${token}` } })).json<Array<{ id: string }>>()[0]?.id}/matches`,
      headers: { authorization: `Bearer ${token}` },
    })
    const pending = matches
      .json<Array<{ id: string; matchNumber: number; result: unknown | null }>>()
      .find((m) => m.result === null)
    expect(pending).toBeDefined()

    const denied = await app.inject({
      method: 'POST',
      url: `/api/events/${eventId}/areas/${areaId}/force-match`,
      headers: { authorization: `Bearer ${token}` },
      payload: { matchId: pending?.id },
    })
    expect(denied.statusCode).toBe(409)
    expect(denied.json<{ error: string }>().error).toMatch(/resting/)

    const forced = await app.inject({
      method: 'POST',
      url: `/api/events/${eventId}/areas/${areaId}/force-match`,
      headers: { authorization: `Bearer ${token}` },
      payload: { matchId: pending?.id, ignoreRest: true },
    })
    expect(forced.statusCode).toBe(200)
    expect(forced.json<{ match: { id: string } }>().match.id).toBe(pending?.id)

    // a match with a live scoreboard cannot be forced elsewhere
    const startedRes = await startScoreboard(token, eventId, areaId, pending?.id as string)
    expect(startedRes.statusCode).toBe(201)
    const area2 = await app.inject({
      method: 'POST',
      url: `/api/events/${eventId}/areas`,
      headers: { authorization: `Bearer ${token}` },
      payload: { name: 'Mesa 2' },
    })
    const deniedLive = await app.inject({
      method: 'POST',
      url: `/api/events/${eventId}/areas/${area2.json<{ id: string }>().id}/force-match`,
      headers: { authorization: `Bearer ${token}` },
      payload: { matchId: pending?.id, ignoreRest: true },
    })
    expect(deniedLive.statusCode).toBe(409)
  })

  it('RBAC: force-match requires event_manager+', async () => {
    const { token, eventId, areaId, match } = await setupFight()
    const operatorToken = await createUserAndLogin(token, 'scoreboard_operator', 'op@test.com')
    const res = await app.inject({
      method: 'POST',
      url: `/api/events/${eventId}/areas/${areaId}/force-match`,
      headers: { authorization: `Bearer ${operatorToken}` },
      payload: { matchId: match.id },
    })
    expect(res.statusCode).toBe(403)
  })
})

describe('Rankings route', () => {
  it('returns final standings once the bracket is decided, 409 before', async () => {
    const { token, eventId, divisionId, areaId, match } = await setupFight()

    const early = await app.inject({
      method: 'GET',
      url: `/api/events/${eventId}/divisions/${divisionId}/rankings`,
      headers: { authorization: `Bearer ${token}` },
    })
    expect(early.statusCode).toBe(409)

    // decide all 3 rodizio matches via scoreboard + force-match for the rest-blocked ones
    let current = match
    for (;;) {
      const sb = (await startScoreboard(token, eventId, areaId, current.id)).json<ScoreboardDTO>()
      await act(token, sb.id, 'winner', { winnerId: sb.sides.A.athleteId, method: 'ippon' })

      const remaining = (
        await app.inject({
          method: 'GET',
          url: `/api/events/${eventId}/divisions/${divisionId}/matches`,
          headers: { authorization: `Bearer ${token}` },
        })
      )
        .json<Array<{ id: string; result: unknown | null }>>()
        .filter((m) => m.result === null)
      if (remaining.length === 0) break

      const forced = await app.inject({
        method: 'POST',
        url: `/api/events/${eventId}/areas/${areaId}/force-match`,
        headers: { authorization: `Bearer ${token}` },
        payload: { matchId: remaining[0]?.id, ignoreRest: true },
      })
      expect(forced.statusCode).toBe(200)
      current = { id: remaining[0]?.id as string, matchNumber: 0 }
    }

    const res = await app.inject({
      method: 'GET',
      url: `/api/events/${eventId}/divisions/${divisionId}/rankings`,
      headers: { authorization: `Bearer ${token}` },
    })
    expect(res.statusCode).toBe(200)
    const rankings = res.json<Array<{ place: number; fullName: string }>>()
    expect(rankings).toHaveLength(3)
    expect(rankings[0]?.place).toBe(1)
    expect(rankings[0]?.fullName).toMatch(/Atleta/)
  })
})
