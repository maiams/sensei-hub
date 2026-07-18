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

async function setupAdmin(email = 'admin@test.com', password = 'senha12345') {
  await app.inject({
    method: 'POST',
    url: '/api/setup',
    payload: {
      academyName: 'Academia Teste',
      adminName: 'Admin',
      adminEmail: email,
      adminPassword: password,
    },
  })
  const loginRes = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { email, password },
  })
  return loginRes.json<{ accessToken: string }>().accessToken
}

async function createUserAndLogin(adminToken: string, role: string, email: string) {
  await app.inject({
    method: 'POST',
    url: '/api/users',
    headers: { authorization: `Bearer ${adminToken}` },
    payload: { name: 'User ' + role, email, password: 'senha12345', role },
  })
  const loginRes = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { email, password: 'senha12345' },
  })
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

interface EventDTO {
  id: string
  name: string
  status: string
}

interface DivisionDTO {
  id: string
  eventId: string
  name: string
  minAge: number | null
  maxAge: number | null
  weightLimitKg: number | null
  sourceTemplateKey?: string
}

interface EntryDTO {
  id: string
  divisionId: string
  athleteId: string
  status: string
  confirmedDivisionId?: string
  confirmedWeightKg?: number
  withdrawnReason?: string
  disqualifiedReason?: string
}

async function createDivision(token: string, eventId: string, overrides: Record<string, unknown> = {}) {
  const res = await app.inject({
    method: 'POST',
    url: `/api/events/${eventId}/divisions`,
    headers: { authorization: `Bearer ${token}` },
    payload: { name: 'Adulto Masculino Médio', weightLimitKg: 90, ...overrides },
  })
  return res.json<DivisionDTO>()
}

// ─── Events ──────────────────────────────────────────────────────────────

describe('POST /api/events', () => {
  it('returns 401 without token and 403 for staff', async () => {
    const noToken = await app.inject({ method: 'POST', url: '/api/events', payload: { name: 'X', eventDate: '2026-08-01' } })
    expect(noToken.statusCode).toBe(401)

    const adminToken = await setupAdmin()
    const staffToken = await createUserAndLogin(adminToken, 'staff', 'staff@test.com')
    const res = await app.inject({
      method: 'POST',
      url: '/api/events',
      headers: { authorization: `Bearer ${staffToken}` },
      payload: { name: 'X', eventDate: '2026-08-01' },
    })
    expect(res.statusCode).toBe(403)
  })

  it('creates an event as event_manager+', async () => {
    const token = await setupAdmin()
    const event = await createEvent(token)
    expect(event.name).toBe('Copa Teste')
    expect(event.status).toBe('draft')
  })
})

describe('GET/PATCH /api/events/:id', () => {
  it('returns 404 for an unknown event', async () => {
    const token = await setupAdmin()
    const res = await app.inject({
      method: 'GET',
      url: '/api/events/000000000000000000000000',
      headers: { authorization: `Bearer ${token}` },
    })
    expect(res.statusCode).toBe(404)
  })

  it('updates name and status', async () => {
    const token = await setupAdmin()
    const event = await createEvent(token)
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/events/${event.id}`,
      headers: { authorization: `Bearer ${token}` },
      payload: { name: 'Copa Renomeada', status: 'registration' },
    })
    expect(res.statusCode).toBe(200)
    const body = res.json<EventDTO>()
    expect(body.name).toBe('Copa Renomeada')
    expect(body.status).toBe('registration')
  })
})

// ─── Divisions ───────────────────────────────────────────────────────────

describe('Divisions', () => {
  it('CRUD: create, list, update, delete', async () => {
    const token = await setupAdmin()
    const event = await createEvent(token)

    const created = await createDivision(token, event.id)
    expect(created.weightLimitKg).toBe(90)

    const list = await app.inject({
      method: 'GET',
      url: `/api/events/${event.id}/divisions`,
      headers: { authorization: `Bearer ${token}` },
    })
    expect(list.json<DivisionDTO[]>()).toHaveLength(1)

    const updated = await app.inject({
      method: 'PATCH',
      url: `/api/events/${event.id}/divisions/${created.id}`,
      headers: { authorization: `Bearer ${token}` },
      payload: { name: 'Adulto Masculino Médio (ajustado)' },
    })
    expect(updated.json<DivisionDTO>().name).toBe('Adulto Masculino Médio (ajustado)')

    const deleted = await app.inject({
      method: 'DELETE',
      url: `/api/events/${event.id}/divisions/${created.id}`,
      headers: { authorization: `Bearer ${token}` },
    })
    expect(deleted.statusCode).toBe(204)
  })

  it('returns 409 deleting a division that has entries', async () => {
    const token = await setupAdmin()
    const event = await createEvent(token)
    const division = await createDivision(token, event.id)
    const athlete = await createAthlete(token)

    await app.inject({
      method: 'POST',
      url: `/api/events/${event.id}/entries`,
      headers: { authorization: `Bearer ${token}` },
      payload: { divisionId: division.id, athleteId: athlete.id },
    })

    const res = await app.inject({
      method: 'DELETE',
      url: `/api/events/${event.id}/divisions/${division.id}`,
      headers: { authorization: `Bearer ${token}` },
    })
    expect(res.statusCode).toBe(409)
  })

  it('import-from-templates expands the FPJ preset into one division per weight category', async () => {
    const token = await setupAdmin()
    const event = await createEvent(token)

    await app.inject({
      method: 'POST',
      url: '/api/division-templates/load-preset',
      headers: { authorization: `Bearer ${token}` },
    })

    const res = await app.inject({
      method: 'POST',
      url: `/api/events/${event.id}/divisions/import-from-templates`,
      headers: { authorization: `Bearer ${token}` },
      payload: { templateKeys: ['adulto'] },
    })
    expect(res.statusCode).toBe(201)
    const created = res.json<DivisionDTO[]>()
    // "adulto" has 2 groups (Masculino/Feminino) x 7 categories each = 14 divisions
    expect(created).toHaveLength(14)
    expect(created.every((d) => d.sourceTemplateKey === 'adulto')).toBe(true)
    expect(created.every((d) => d.minAge === 18 && d.maxAge === null)).toBe(true)
    const pesado = created.find((d) => d.name.includes('Pesado') && !d.name.includes('Meio'))
    expect(pesado?.weightLimitKg).toBeNull() // open/heaviest category

    const list = await app.inject({
      method: 'GET',
      url: `/api/events/${event.id}/divisions`,
      headers: { authorization: `Bearer ${token}` },
    })
    expect(list.json<DivisionDTO[]>()).toHaveLength(14)
  })

  it('a manually created division gets the CBJ default matchRules; import-from-templates inherits the template rules', async () => {
    const token = await setupAdmin()
    const event = await createEvent(token)

    const manual = await createDivision(token, event.id, { name: 'Aberta' })
    expect((manual as unknown as { matchRules: { matchDurationSeconds: number; goldenScoreEnabled: boolean } }).matchRules).toEqual({
      matchDurationSeconds: 240,
      goldenScoreEnabled: true,
      goldenScoreDurationSeconds: null,
      osaekomiYukoSeconds: 5,
      osaekomiWazaariSeconds: 10,
      osaekomiIpponSeconds: 20,
    })

    await app.inject({
      method: 'POST',
      url: '/api/division-templates/load-preset',
      headers: { authorization: `Bearer ${token}` },
    })
    const res = await app.inject({
      method: 'POST',
      url: `/api/events/${event.id}/divisions/import-from-templates`,
      headers: { authorization: `Bearer ${token}` },
      payload: { templateKeys: ['infantil'] },
    })
    expect(res.statusCode).toBe(201)
    const imported = res.json<Array<{ matchRules: { matchDurationSeconds: number } }>>()
    expect(imported.length).toBeGreaterThan(0)
    // Infantil (Sub-13) fights last 2 minutes per CBJ RNC 2025
    expect(imported.every((d) => d.matchRules.matchDurationSeconds === 120)).toBe(true)
  })

  it('returns 403 for staff on write routes', async () => {
    const adminToken = await setupAdmin()
    const event = await createEvent(adminToken)
    const staffToken = await createUserAndLogin(adminToken, 'staff', 'staff2@test.com')
    const res = await app.inject({
      method: 'POST',
      url: `/api/events/${event.id}/divisions`,
      headers: { authorization: `Bearer ${staffToken}` },
      payload: { name: 'X' },
    })
    expect(res.statusCode).toBe(403)
  })
})

// ─── Entries — state machine ────────────────────────────────────────────

describe('Event entries', () => {
  it('full happy path: registered -> checked_in -> weighed_in -> confirmed', async () => {
    const token = await setupAdmin()
    const event = await createEvent(token)
    const division = await createDivision(token, event.id, { weightLimitKg: 90 })
    const athlete = await createAthlete(token)

    const created = await app.inject({
      method: 'POST',
      url: `/api/events/${event.id}/entries`,
      headers: { authorization: `Bearer ${token}` },
      payload: { divisionId: division.id, athleteId: athlete.id, declaredWeightKg: 88 },
    })
    expect(created.statusCode).toBe(201)
    const entry = created.json<EntryDTO>()
    expect(entry.status).toBe('registered')

    const checkedIn = await app.inject({
      method: 'PATCH',
      url: `/api/events/${event.id}/entries/${entry.id}/checkin`,
      headers: { authorization: `Bearer ${token}` },
    })
    expect(checkedIn.json<EntryDTO>().status).toBe('checked_in')

    const weighedIn = await app.inject({
      method: 'PATCH',
      url: `/api/events/${event.id}/entries/${entry.id}/weighin`,
      headers: { authorization: `Bearer ${token}` },
      payload: { weightKg: 89.5 },
    })
    expect(weighedIn.statusCode).toBe(200)
    const weighedBody = weighedIn.json<EntryDTO & { outcome: string }>()
    expect(weighedBody.status).toBe('weighed_in')
    expect(weighedBody.confirmedWeightKg).toBe(89.5)
    expect(weighedBody.outcome).toBe('ok')

    // weigh-in should have created a real WeightRecord visible on the athlete
    const weights = await app.inject({
      method: 'GET',
      url: `/api/athletes/${athlete.id}/weights`,
      headers: { authorization: `Bearer ${token}` },
    })
    expect(weights.json()).toHaveLength(1)

    const confirmed = await app.inject({
      method: 'PATCH',
      url: `/api/events/${event.id}/entries/${entry.id}/confirm`,
      headers: { authorization: `Bearer ${token}` },
      payload: {},
    })
    const confirmedBody = confirmed.json<EntryDTO>()
    expect(confirmedBody.status).toBe('confirmed')
    expect(confirmedBody.confirmedDivisionId).toBe(division.id)
  })

  it('weigh-in over the division limit disqualifies the entry under the default policy', async () => {
    const token = await setupAdmin()
    const event = await createEvent(token) // overweightPolicy defaults to 'disqualify'
    const division = await createDivision(token, event.id, { weightLimitKg: 90 })
    const athlete = await createAthlete(token)
    const entry = (
      await app.inject({
        method: 'POST',
        url: `/api/events/${event.id}/entries`,
        headers: { authorization: `Bearer ${token}` },
        payload: { divisionId: division.id, athleteId: athlete.id },
      })
    ).json<EntryDTO>()
    await app.inject({
      method: 'PATCH',
      url: `/api/events/${event.id}/entries/${entry.id}/checkin`,
      headers: { authorization: `Bearer ${token}` },
    })

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/events/${event.id}/entries/${entry.id}/weighin`,
      headers: { authorization: `Bearer ${token}` },
      payload: { weightKg: 95 },
    })
    expect(res.statusCode).toBe(200)
    const body = res.json<EntryDTO & { outcome: string }>()
    expect(body.outcome).toBe('disqualified')
    expect(body.status).toBe('disqualified')
    expect(body.disqualifiedReason).toContain('95kg > 90kg')

    // disqualified is terminal
    const again = await app.inject({
      method: 'PATCH',
      url: `/api/events/${event.id}/entries/${entry.id}/confirm`,
      headers: { authorization: `Bearer ${token}` },
      payload: {},
    })
    expect(again.statusCode).toBe(409)
  })

  it('reallocate policy moves the entry into the lightest sibling division that fits the weight', async () => {
    const token = await setupAdmin()
    await app.inject({
      method: 'POST',
      url: '/api/division-templates/load-preset',
      headers: { authorization: `Bearer ${token}` },
    })
    const event = await createEvent(token, { overweightPolicy: 'reallocate' })
    await app.inject({
      method: 'POST',
      url: `/api/events/${event.id}/divisions/import-from-templates`,
      headers: { authorization: `Bearer ${token}` },
      payload: { templateKeys: ['adulto'] },
    })
    const divisions = (
      await app.inject({
        method: 'GET',
        url: `/api/events/${event.id}/divisions`,
        headers: { authorization: `Bearer ${token}` },
      })
    ).json<DivisionDTO[]>()
    const ligeiro = divisions.find((d) => d.name.includes('Masculino — Ligeiro'))!
    const meioLeve = divisions.find((d) => d.name.includes('Masculino — Meio Leve'))!
    expect(ligeiro.weightLimitKg).toBe(60)
    expect(meioLeve.weightLimitKg).toBe(66)

    const athlete = await createAthlete(token)
    const entry = (
      await app.inject({
        method: 'POST',
        url: `/api/events/${event.id}/entries`,
        headers: { authorization: `Bearer ${token}` },
        payload: { divisionId: ligeiro.id, athleteId: athlete.id },
      })
    ).json<EntryDTO>()
    await app.inject({
      method: 'PATCH',
      url: `/api/events/${event.id}/entries/${entry.id}/checkin`,
      headers: { authorization: `Bearer ${token}` },
    })

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/events/${event.id}/entries/${entry.id}/weighin`,
      headers: { authorization: `Bearer ${token}` },
      payload: { weightKg: 65 },
    })
    const body = res.json<EntryDTO & { outcome: string }>()
    expect(body.outcome).toBe('reallocated')
    expect(body.status).toBe('weighed_in') // still in the flow, not disqualified
    expect(body.divisionId).toBe(meioLeve.id)

    // confirmEntry remains available after a reallocation
    const confirmed = await app.inject({
      method: 'PATCH',
      url: `/api/events/${event.id}/entries/${entry.id}/confirm`,
      headers: { authorization: `Bearer ${token}` },
      payload: {},
    })
    expect(confirmed.json<EntryDTO>().status).toBe('confirmed')
    expect(confirmed.json<EntryDTO>().confirmedDivisionId).toBe(meioLeve.id)
  })

  it('reallocate policy falls back to disqualify when the division has no siblings (manually created)', async () => {
    const token = await setupAdmin()
    const event = await createEvent(token, { overweightPolicy: 'reallocate' })
    const division = await createDivision(token, event.id, { weightLimitKg: 90 })
    const athlete = await createAthlete(token)
    const entry = (
      await app.inject({
        method: 'POST',
        url: `/api/events/${event.id}/entries`,
        headers: { authorization: `Bearer ${token}` },
        payload: { divisionId: division.id, athleteId: athlete.id },
      })
    ).json<EntryDTO>()
    await app.inject({
      method: 'PATCH',
      url: `/api/events/${event.id}/entries/${entry.id}/checkin`,
      headers: { authorization: `Bearer ${token}` },
    })

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/events/${event.id}/entries/${entry.id}/weighin`,
      headers: { authorization: `Bearer ${token}` },
      payload: { weightKg: 95 },
    })
    const body = res.json<EntryDTO & { outcome: string }>()
    expect(body.outcome).toBe('disqualified')
    expect(body.status).toBe('disqualified')
  })

  it('confirm can move the entry into a different division (manual override, independent of weight)', async () => {
    const token = await setupAdmin()
    const event = await createEvent(token)
    const divisionA = await createDivision(token, event.id, { name: 'Médio', weightLimitKg: 90 })
    const divisionB = await createDivision(token, event.id, { name: 'Meio-Pesado', weightLimitKg: 100 })
    const athlete = await createAthlete(token)
    const entry = (
      await app.inject({
        method: 'POST',
        url: `/api/events/${event.id}/entries`,
        headers: { authorization: `Bearer ${token}` },
        payload: { divisionId: divisionA.id, athleteId: athlete.id },
      })
    ).json<EntryDTO>()
    await app.inject({
      method: 'PATCH',
      url: `/api/events/${event.id}/entries/${entry.id}/checkin`,
      headers: { authorization: `Bearer ${token}` },
    })
    await app.inject({
      method: 'PATCH',
      url: `/api/events/${event.id}/entries/${entry.id}/weighin`,
      headers: { authorization: `Bearer ${token}` },
      payload: { weightKg: 88 }, // within divisionA's limit — policy doesn't kick in
    })

    const confirmed = await app.inject({
      method: 'PATCH',
      url: `/api/events/${event.id}/entries/${entry.id}/confirm`,
      headers: { authorization: `Bearer ${token}` },
      payload: { confirmedDivisionId: divisionB.id },
    })
    expect(confirmed.json<EntryDTO>().confirmedDivisionId).toBe(divisionB.id)
  })

  it('withdraw is reachable from any non-terminal status and requires a reason', async () => {
    const token = await setupAdmin()
    const event = await createEvent(token)
    const division = await createDivision(token, event.id)
    const athlete = await createAthlete(token)
    const entry = (
      await app.inject({
        method: 'POST',
        url: `/api/events/${event.id}/entries`,
        headers: { authorization: `Bearer ${token}` },
        payload: { divisionId: division.id, athleteId: athlete.id },
      })
    ).json<EntryDTO>()

    const noReason = await app.inject({
      method: 'PATCH',
      url: `/api/events/${event.id}/entries/${entry.id}/withdraw`,
      headers: { authorization: `Bearer ${token}` },
      payload: { reason: '' },
    })
    expect(noReason.statusCode).toBe(400)

    const withdrawn = await app.inject({
      method: 'PATCH',
      url: `/api/events/${event.id}/entries/${entry.id}/withdraw`,
      headers: { authorization: `Bearer ${token}` },
      payload: { reason: 'lesão' },
    })
    expect(withdrawn.statusCode).toBe(200)
    expect(withdrawn.json<EntryDTO>().status).toBe('withdrawn')
    expect(withdrawn.json<EntryDTO>().withdrawnReason).toBe('lesão')

    // withdrawn is terminal
    const again = await app.inject({
      method: 'PATCH',
      url: `/api/events/${event.id}/entries/${entry.id}/withdraw`,
      headers: { authorization: `Bearer ${token}` },
      payload: { reason: 'de novo' },
    })
    expect(again.statusCode).toBe(409)
  })

  it('returns 409 skipping a state (registered straight to confirmed)', async () => {
    const token = await setupAdmin()
    const event = await createEvent(token)
    const division = await createDivision(token, event.id)
    const athlete = await createAthlete(token)
    const entry = (
      await app.inject({
        method: 'POST',
        url: `/api/events/${event.id}/entries`,
        headers: { authorization: `Bearer ${token}` },
        payload: { divisionId: division.id, athleteId: athlete.id },
      })
    ).json<EntryDTO>()

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/events/${event.id}/entries/${entry.id}/confirm`,
      headers: { authorization: `Bearer ${token}` },
      payload: {},
    })
    expect(res.statusCode).toBe(409)
  })

  it('returns 409 registering the same athlete twice in the same division', async () => {
    const token = await setupAdmin()
    const event = await createEvent(token)
    const division = await createDivision(token, event.id)
    const athlete = await createAthlete(token)

    await app.inject({
      method: 'POST',
      url: `/api/events/${event.id}/entries`,
      headers: { authorization: `Bearer ${token}` },
      payload: { divisionId: division.id, athleteId: athlete.id },
    })
    const dup = await app.inject({
      method: 'POST',
      url: `/api/events/${event.id}/entries`,
      headers: { authorization: `Bearer ${token}` },
      payload: { divisionId: division.id, athleteId: athlete.id },
    })
    expect(dup.statusCode).toBe(409)
  })

  it('RBAC: weigh-in requires weigh_in_operator+, confirm/withdraw require event_manager+', async () => {
    const adminToken = await setupAdmin()
    const event = await createEvent(adminToken)
    const division = await createDivision(adminToken, event.id)
    const athlete = await createAthlete(adminToken)
    const entry = (
      await app.inject({
        method: 'POST',
        url: `/api/events/${event.id}/entries`,
        headers: { authorization: `Bearer ${adminToken}` },
        payload: { divisionId: division.id, athleteId: athlete.id },
      })
    ).json<EntryDTO>()
    await app.inject({
      method: 'PATCH',
      url: `/api/events/${event.id}/entries/${entry.id}/checkin`,
      headers: { authorization: `Bearer ${adminToken}` },
    })

    const scoreboardToken = await createUserAndLogin(adminToken, 'scoreboard_operator', 'scoreop@test.com')
    const forbiddenWeighIn = await app.inject({
      method: 'PATCH',
      url: `/api/events/${event.id}/entries/${entry.id}/weighin`,
      headers: { authorization: `Bearer ${scoreboardToken}` },
      payload: { weightKg: 90 },
    })
    expect(forbiddenWeighIn.statusCode).toBe(403)

    const staffToken = await createUserAndLogin(adminToken, 'staff', 'staff3@test.com')
    const forbiddenConfirm = await app.inject({
      method: 'PATCH',
      url: `/api/events/${event.id}/entries/${entry.id}/confirm`,
      headers: { authorization: `Bearer ${staffToken}` },
      payload: {},
    })
    expect(forbiddenConfirm.statusCode).toBe(403)
  })
})
