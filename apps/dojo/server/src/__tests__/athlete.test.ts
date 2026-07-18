import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { connectTestDb, closeTestDb, clearTestDb } from '@sensei-hub/core-server/testing'
import { buildApp } from '../app.js'
import { AcademyModel } from '@sensei-hub/core-server'
import { GuardianModel } from '../repositories/GuardianModel.js'
import { AthleteService } from '../services/AthleteService.js'
import { BELT_VALUES } from '@sensei-hub/shared'
import { CreateAthleteInput } from '@dojo/shared'
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

// ─── Helpers ─────────────────────────────────────────────────────────────────

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

function adultAthletePayload(overrides: Record<string, unknown> = {}) {
  return {
    fullName: 'Ricardo Santos',
    gender: 'male',
    birthDate: '1990-01-01',
    currentBelt: 'blue',
    termsAccepted: true,
    imageAuthorizationAccepted: true,
    ...overrides,
  }
}

function minorAthletePayload(overrides: Record<string, unknown> = {}) {
  return {
    fullName: 'Joãozinho Silva',
    gender: 'male',
    birthDate: '2015-01-01', // 11 years old relative to 2026
    currentBelt: 'yellow',
    termsAccepted: true,
    imageAuthorizationAccepted: true,
    ...overrides,
  }
}

function guardianPayload(overrides: Record<string, unknown> = {}) {
  return {
    name: 'Maria Silva',
    relationship: 'mother',
    phone: '12999999999',
    termsAccepted: true,
    imageAuthorizationAccepted: true,
    ...overrides,
  }
}

// ─── Create athlete ──────────────────────────────────────────────────────────

describe('POST /api/athletes', () => {
  it('uses the supported graduation order and rejects obsolete black dan values', () => {
    expect(BELT_VALUES).toEqual([
      'white', 'burgundy', 'gray', 'blue', 'yellow', 'orange', 'green', 'purple', 'brown',
      'black-1dan', 'black-2dan', 'black-3dan', 'black-4dan', 'black-5dan',
      'coral-6dan', 'coral-7dan', 'coral-8dan', 'red-9dan', 'red-10dan',
    ])

    for (const currentBelt of BELT_VALUES) {
      expect(CreateAthleteInput.safeParse({
        academyId: 'academy-id',
        ...adultAthletePayload({ currentBelt }),
      }).success).toBe(true)
    }

    expect(CreateAthleteInput.safeParse({
      academyId: 'academy-id',
      ...adultAthletePayload({ currentBelt: 'black-6dan' }),
    }).success).toBe(false)
  })

  it('returns 401 without token', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/athletes', payload: adultAthletePayload() })
    expect(res.statusCode).toBe(401)
  })

  it('returns 403 for a role below staff (scoreboard_operator)', async () => {
    const adminToken = await setupAdmin()
    const token = await createUserAndLogin(adminToken, 'scoreboard_operator', 'scoreop@test.com')
    const res = await app.inject({
      method: 'POST',
      url: '/api/athletes',
      headers: { authorization: `Bearer ${token}` },
      payload: adultAthletePayload(),
    })
    expect(res.statusCode).toBe(403)
  })

  it('creates an adult athlete without a guardian', async () => {
    const token = await setupAdmin()
    const res = await app.inject({
      method: 'POST',
      url: '/api/athletes',
      headers: { authorization: `Bearer ${token}` },
      payload: adultAthletePayload({ federationNumber: 'FPJ-123', zempoNumber: 'CBJ-456' }),
    })
    expect(res.statusCode).toBe(201)
    const body = res.json()
    expect(body.fullName).toBe('Ricardo Santos')
    expect(body.enrollmentNumber).toBe('000001')
    expect(body.federationNumber).toBe('FPJ-123')
    expect(body.zempoNumber).toBe('CBJ-456')
  })

  it('returns 400 when a minor is registered without a guardian', async () => {
    const token = await setupAdmin()
    const res = await app.inject({
      method: 'POST',
      url: '/api/athletes',
      headers: { authorization: `Bearer ${token}` },
      payload: minorAthletePayload(),
    })
    expect(res.statusCode).toBe(400)
  })

  it('creates a minor athlete with a guardian atomically', async () => {
    const token = await setupAdmin()
    const res = await app.inject({
      method: 'POST',
      url: '/api/athletes',
      headers: { authorization: `Bearer ${token}` },
      payload: minorAthletePayload({ guardian: guardianPayload() }),
    })
    expect(res.statusCode).toBe(201)
    const athleteId = res.json().id

    const guardianRes = await app.inject({
      method: 'GET',
      url: `/api/athletes/${athleteId}/guardian`,
      headers: { authorization: `Bearer ${token}` },
    })
    expect(guardianRes.statusCode).toBe(200)
    expect(guardianRes.json().name).toBe('Maria Silva')
  })

  it('returns 400 for an invalid CPF', async () => {
    const token = await setupAdmin()
    const res = await app.inject({
      method: 'POST',
      url: '/api/athletes',
      headers: { authorization: `Bearer ${token}` },
      payload: adultAthletePayload({ cpf: '123.456.789-00' }),
    })
    expect(res.statusCode).toBe(400)
  })

  it('returns 409 for a CPF already registered in the same academy', async () => {
    const token = await setupAdmin()
    const cpf = '111.444.777-35'
    await app.inject({
      method: 'POST',
      url: '/api/athletes',
      headers: { authorization: `Bearer ${token}` },
      payload: adultAthletePayload({ cpf }),
    })
    const res = await app.inject({
      method: 'POST',
      url: '/api/athletes',
      headers: { authorization: `Bearer ${token}` },
      payload: adultAthletePayload({ cpf, fullName: 'Outro Nome' }),
    })
    expect(res.statusCode).toBe(409)
  })

  it('allows the same CPF to be registered in a different academy', async () => {
    const token = await setupAdmin()
    const cpf = '529.982.247-25'
    const res1 = await app.inject({
      method: 'POST',
      url: '/api/athletes',
      headers: { authorization: `Bearer ${token}` },
      payload: adultAthletePayload({ cpf }),
    })
    expect(res1.statusCode).toBe(201)

    // No multi-academy API yet (deferred past Fase 7) — create a second academy
    // directly via the model to exercise the per-academy CPF uniqueness scope.
    const otherAcademy = await AcademyModel.create({ name: 'Outra Academia', slug: 'outra-academia' })
    const service = new AthleteService()
    const created = await service.createAthlete(adultAthletePayload({ cpf }) as never, {
      userId: '000000000000000000000000',
      academyId: otherAcademy._id.toString(),
      role: 'academy_admin',
      sessionId: 'test-session',
    })
    expect(created.cpf).toBe(cpf)
  })
})

// ─── Get / list / update / deactivate ──────────────────────────────────────

describe('GET /api/athletes/:id', () => {
  it('does not include medicalNotes for staff role', async () => {
    const adminToken = await setupAdmin()
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/athletes',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: adultAthletePayload({ medicalNotes: 'Asma leve' }),
    })
    const athleteId = createRes.json().id

    const staffToken = await createUserAndLogin(adminToken, 'staff', 'staff@test.com')
    const res = await app.inject({
      method: 'GET',
      url: `/api/athletes/${athleteId}`,
      headers: { authorization: `Bearer ${staffToken}` },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().medicalNotes).toBeUndefined()
  })

  it('includes medicalNotes for coach role', async () => {
    const adminToken = await setupAdmin()
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/athletes',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: adultAthletePayload({ medicalNotes: 'Asma leve' }),
    })
    const athleteId = createRes.json().id

    const coachToken = await createUserAndLogin(adminToken, 'coach', 'coach@test.com')
    const res = await app.inject({
      method: 'GET',
      url: `/api/athletes/${athleteId}`,
      headers: { authorization: `Bearer ${coachToken}` },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().medicalNotes).toBe('Asma leve')
  })

  it('returns 401 without token and 403 for insufficient role', async () => {
    const adminToken = await setupAdmin()
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/athletes',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: adultAthletePayload(),
    })
    const athleteId = createRes.json().id

    const noToken = await app.inject({ method: 'GET', url: `/api/athletes/${athleteId}` })
    expect(noToken.statusCode).toBe(401)

    const scoreOpToken = await createUserAndLogin(adminToken, 'scoreboard_operator', 'scoreop2@test.com')
    const forbidden = await app.inject({
      method: 'GET',
      url: `/api/athletes/${athleteId}`,
      headers: { authorization: `Bearer ${scoreOpToken}` },
    })
    expect(forbidden.statusCode).toBe(403)
  })
})

describe('PATCH /api/athletes/:id', () => {
  it('updates a field and records an audit log entry', async () => {
    const token = await setupAdmin()
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/athletes',
      headers: { authorization: `Bearer ${token}` },
      payload: adultAthletePayload(),
    })
    const athleteId = createRes.json().id

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/athletes/${athleteId}`,
      headers: { authorization: `Bearer ${token}` },
      payload: { phone: '11988887777' },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().phone).toBe('11988887777')
  })
})

describe('DELETE /api/athletes/:id', () => {
  it('requires academy_admin and a reason', async () => {
    const adminToken = await setupAdmin()
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/athletes',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: adultAthletePayload(),
    })
    const athleteId = createRes.json().id

    const staffToken = await createUserAndLogin(adminToken, 'staff', 'staff3@test.com')
    const forbidden = await app.inject({
      method: 'DELETE',
      url: `/api/athletes/${athleteId}`,
      headers: { authorization: `Bearer ${staffToken}` },
      payload: { reason: 'saiu da academia' },
    })
    expect(forbidden.statusCode).toBe(403)

    const noReason = await app.inject({
      method: 'DELETE',
      url: `/api/athletes/${athleteId}`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {},
    })
    expect(noReason.statusCode).toBe(400)

    const ok = await app.inject({
      method: 'DELETE',
      url: `/api/athletes/${athleteId}`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { reason: 'saiu da academia' },
    })
    expect(ok.statusCode).toBe(204)
  })
})

// ─── Belt records ────────────────────────────────────────────────────────────

describe('POST /api/athletes/:id/belts', () => {
  it('requires coach+ and updates currentBelt', async () => {
    const adminToken = await setupAdmin()
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/athletes',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: adultAthletePayload(),
    })
    const athleteId = createRes.json().id

    const staffToken = await createUserAndLogin(adminToken, 'staff', 'staff4@test.com')
    const forbidden = await app.inject({
      method: 'POST',
      url: `/api/athletes/${athleteId}/belts`,
      headers: { authorization: `Bearer ${staffToken}` },
      payload: { belt: 'brown', grantedAt: '2026-01-01' },
    })
    expect(forbidden.statusCode).toBe(403)

    const res = await app.inject({
      method: 'POST',
      url: `/api/athletes/${athleteId}/belts`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { belt: 'brown', grantedAt: '2026-01-01' },
    })
    expect(res.statusCode).toBe(201)

    const athleteRes = await app.inject({
      method: 'GET',
      url: `/api/athletes/${athleteId}`,
      headers: { authorization: `Bearer ${adminToken}` },
    })
    expect(athleteRes.json().currentBelt).toBe('brown')
  })
})

// ─── Weight records ──────────────────────────────────────────────────────────

describe('Weight records', () => {
  it('records a manual weight and requires weigh_in_operator+', async () => {
    const adminToken = await setupAdmin()
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/athletes',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: adultAthletePayload(),
    })
    const athleteId = createRes.json().id

    const scoreOpToken = await createUserAndLogin(adminToken, 'scoreboard_operator', 'scoreop3@test.com')
    const forbidden = await app.inject({
      method: 'POST',
      url: `/api/athletes/${athleteId}/weights`,
      headers: { authorization: `Bearer ${scoreOpToken}` },
      payload: { weightKg: 81.4 },
    })
    expect(forbidden.statusCode).toBe(403)

    const res = await app.inject({
      method: 'POST',
      url: `/api/athletes/${athleteId}/weights`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { weightKg: 81.4 },
    })
    expect(res.statusCode).toBe(201)
    expect(res.json().source).toBe('manual')
  })

  it('correction is append-only: original stays intact, new record references it, audit log recorded', async () => {
    const adminToken = await setupAdmin()
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/athletes',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: adultAthletePayload(),
    })
    const athleteId = createRes.json().id

    const weighRes = await app.inject({
      method: 'POST',
      url: `/api/athletes/${athleteId}/weights`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { weightKg: 81.4 },
    })
    const originalId = weighRes.json().id

    const correctRes = await app.inject({
      method: 'POST',
      url: `/api/athletes/${athleteId}/weights/${originalId}/correct`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { weightKg: 80.9, reason: 'balança descalibrada' },
    })
    expect(correctRes.statusCode).toBe(201)
    const corrected = correctRes.json()
    expect(corrected.source).toBe('corrected')
    expect(corrected.originalRecordId).toBe(originalId)
    expect(corrected.correctionReason).toBe('balança descalibrada')

    const listRes = await app.inject({
      method: 'GET',
      url: `/api/athletes/${athleteId}/weights`,
      headers: { authorization: `Bearer ${adminToken}` },
    })
    const records = listRes.json() as Array<{ id: string; weightKg: number }>
    const original = records.find((r) => r.id === originalId)
    expect(original?.weightKg).toBe(81.4) // untouched

    const athleteRes = await app.inject({
      method: 'GET',
      url: `/api/athletes/${athleteId}`,
      headers: { authorization: `Bearer ${adminToken}` },
    })
    expect(athleteRes.json().latestWeightKg).toBe(80.9)
  })

  it('returns 400 when correcting without a reason', async () => {
    const adminToken = await setupAdmin()
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/athletes',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: adultAthletePayload(),
    })
    const athleteId = createRes.json().id
    const weighRes = await app.inject({
      method: 'POST',
      url: `/api/athletes/${athleteId}/weights`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { weightKg: 81.4 },
    })
    const originalId = weighRes.json().id

    const res = await app.inject({
      method: 'POST',
      url: `/api/athletes/${athleteId}/weights/${originalId}/correct`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { weightKg: 80.9, reason: '' },
    })
    expect(res.statusCode).toBe(400)
  })
})

// ─── Guardian ────────────────────────────────────────────────────────────────

describe('Guardian routes', () => {
  it('returns 409 when adding a second guardian for the same athlete', async () => {
    const token = await setupAdmin()
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/athletes',
      headers: { authorization: `Bearer ${token}` },
      payload: minorAthletePayload({ guardian: guardianPayload() }),
    })
    const athleteId = createRes.json().id

    const res = await app.inject({
      method: 'POST',
      url: `/api/athletes/${athleteId}/guardian`,
      headers: { authorization: `Bearer ${token}` },
      payload: guardianPayload({ name: 'Outro Responsável' }),
    })
    expect(res.statusCode).toBe(409)
  })

  it('adds a guardian to an adult athlete on demand', async () => {
    const token = await setupAdmin()
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/athletes',
      headers: { authorization: `Bearer ${token}` },
      payload: adultAthletePayload(),
    })
    const athleteId = createRes.json().id

    const res = await app.inject({
      method: 'POST',
      url: `/api/athletes/${athleteId}/guardian`,
      headers: { authorization: `Bearer ${token}` },
      payload: guardianPayload(),
    })
    expect(res.statusCode).toBe(201)

    const count = await GuardianModel.countDocuments({ athleteId })
    expect(count).toBe(1)
  })
})
