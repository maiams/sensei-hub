import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import * as XLSX from 'xlsx'
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

const TEMPLATE_HEADERS = [
  'nome_completo', 'nome_preferido', 'academia', 'data_nascimento', 'genero', 'faixa',
  'peso_declarado_kg', 'cpf', 'email', 'telefone',
  'responsavel_nome', 'responsavel_telefone', 'termos_aceitos', 'observacoes',
]

function buildXlsxBuffer(rows: (string | number)[][]): Buffer {
  const ws = XLSX.utils.aoa_to_sheet([TEMPLATE_HEADERS, ...rows])
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Atletas')
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer
}

function multipartBody(buffer: Buffer, filename = 'atletas.xlsx') {
  const boundary = '----senseihubtestboundary'
  const body = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet\r\n\r\n`,
    ),
    buffer,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ])
  return { boundary, body }
}

async function postImport(token: string, eventId: string, xlsxBuffer: Buffer) {
  const { boundary, body } = multipartBody(xlsxBuffer)
  return app.inject({
    method: 'POST',
    url: `/api/events/${eventId}/import`,
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': `multipart/form-data; boundary=${boundary}`,
    },
    payload: body,
  })
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

interface EventDTO {
  id: string
  name: string
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

interface DivisionDTO {
  id: string
  name: string
}

async function createDivision(token: string, eventId: string, overrides: Record<string, unknown> = {}) {
  const res = await app.inject({
    method: 'POST',
    url: `/api/events/${eventId}/divisions`,
    headers: { authorization: `Bearer ${token}` },
    payload: { name: 'Livre', ...overrides },
  })
  return res.json<DivisionDTO>()
}

interface ImportJobDTO {
  id: string
  eventId: string
  filename: string
  totalRows: number
  successCount: number
  errorCount: number
  errors: Array<{ row: number; field?: string; message: string }>
}

interface EntryDTO {
  id: string
  divisionId: string
  athleteId: string
  status: string
  registrationMethod: string
  declaredWeightKg?: number
}

interface AthleteDTO {
  id: string
  clubName?: string
  cpf?: string
  currentBelt?: string
}

// ─── Template ────────────────────────────────────────────────────────────

describe('GET /api/events/:id/import/template', () => {
  it('returns an xlsx file for event_manager+, 403 for staff, 401 without token', async () => {
    const token = await setupAdmin()
    const event = await createEvent(token)

    const noToken = await app.inject({ method: 'GET', url: `/api/events/${event.id}/import/template` })
    expect(noToken.statusCode).toBe(401)

    const staffToken = await createUserAndLogin(token, 'staff', 'staff@test.com')
    const staffRes = await app.inject({
      method: 'GET',
      url: `/api/events/${event.id}/import/template`,
      headers: { authorization: `Bearer ${staffToken}` },
    })
    expect(staffRes.statusCode).toBe(403)

    const res = await app.inject({
      method: 'GET',
      url: `/api/events/${event.id}/import/template`,
      headers: { authorization: `Bearer ${token}` },
    })
    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toContain('spreadsheetml')
    const wb = XLSX.read(res.rawPayload, { type: 'buffer' })
    const sheet = wb.Sheets[wb.SheetNames[0] as string]
    const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet as XLSX.WorkSheet, { header: 1 })
    expect(rows[0]).toEqual(TEMPLATE_HEADERS)
  })
})

// ─── Import ──────────────────────────────────────────────────────────────

describe('POST /api/events/:id/import', () => {
  it('returns 403 for staff', async () => {
    const token = await setupAdmin()
    const event = await createEvent(token)
    const staffToken = await createUserAndLogin(token, 'staff', 'staff@test.com')
    const res = await postImport(staffToken, event.id, buildXlsxBuffer([]))
    expect(res.statusCode).toBe(403)
  })

  it('imports valid rows: creates competitors with clubName and registered entries', async () => {
    const token = await setupAdmin()
    const event = await createEvent(token)
    await createDivision(token, event.id) // open division (no age/weight restriction) — matches anyone

    const buffer = buildXlsxBuffer([
      ['João Silva', '', 'Academia Visitante', '10/05/1995', 'M', 'Coral — 8º Dan', 80, '', '', '', '', '', 'S', ''],
      ['Maria Souza', '', 'Academia Visitante', '10/05/2015', 'F', 'branca', 30, '', '', '', 'Responsável', '11999999999', 'S', ''],
    ])
    const res = await postImport(token, event.id, buffer)
    expect(res.statusCode).toBe(201)
    const job = res.json<ImportJobDTO>()
    expect(job.totalRows).toBe(2)
    expect(job.successCount).toBe(2)
    expect(job.errorCount).toBe(0)

    const entriesRes = await app.inject({
      method: 'GET',
      url: `/api/events/${event.id}/entries`,
      headers: { authorization: `Bearer ${token}` },
    })
    const entries = entriesRes.json<EntryDTO[]>()
    expect(entries).toHaveLength(2)
    expect(entries.every((e) => e.registrationMethod === 'import' && e.status === 'registered')).toBe(true)

    const athleteRes = await app.inject({
      method: 'GET',
      url: `/api/athletes/${entries[0]?.athleteId}`,
      headers: { authorization: `Bearer ${token}` },
    })
    const athlete = athleteRes.json<AthleteDTO>()
    expect(athlete.clubName).toBe('Academia Visitante')
    expect(athlete.currentBelt).toBe('coral-8dan')
  })

  it('reports per-row validation errors without failing the whole batch', async () => {
    const token = await setupAdmin()
    const event = await createEvent(token)
    await createDivision(token, event.id) // open division — matches anyone, so it never masks the other errors below

    const buffer = buildXlsxBuffer([
      ['', '', 'Clube', '10/05/1995', 'M', 'azul', 80, '', '', '', '', '', 'S', ''], // missing name
      ['Nome B', '', 'Clube', '31/02/1995', 'M', 'azul', 80, '', '', '', '', '', 'S', ''], // invalid date
      ['Nome C', '', 'Clube', '10/05/1995', 'X', 'azul', 80, '', '', '', '', '', 'S', ''], // invalid gender
      ['Nome D', '', 'Clube', '10/05/1995', 'M', 'dourada', 80, '', '', '', '', '', 'S', ''], // invalid belt
      ['Nome E', '', 'Clube', '10/05/1995', 'M', 'azul', 'abc', '', '', '', '', '', 'S', ''], // invalid weight
      ['Nome G', '', 'Clube', '10/05/1995', 'M', 'azul', 80, '123', '', '', '', '', 'S', ''], // invalid CPF
      ['Nome H', '', 'Clube', '10/05/2015', 'M', 'azul', 40, '', '', '', '', '', 'S', ''], // minor without guardian
      ['Nome I', '', 'Clube', '10/05/2015', 'M', 'azul', 40, '', '', '', 'Resp', '11988887777', 'N', ''], // minor, terms not accepted
      ['Nome Válido', '', 'Clube', '10/05/1995', 'M', 'azul', 80, '', '', '', '', '', 'S', ''], // valid
    ])

    const res = await postImport(token, event.id, buffer)
    expect(res.statusCode).toBe(201)
    const job = res.json<ImportJobDTO>()
    expect(job.totalRows).toBe(9)
    expect(job.successCount).toBe(1)
    expect(job.errorCount).toBe(8)

    const fields = job.errors.map((e) => e.field)
    expect(fields).toEqual(
      expect.arrayContaining([
        'nome_completo', 'data_nascimento', 'genero', 'faixa', 'peso_declarado_kg',
        'cpf', 'responsavel_nome', 'termos_aceitos',
      ]),
    )
  })

  describe('division matching (idade + peso + gênero, sem coluna de categoria)', () => {
    it('reports a row error when no division in the event fits the age/weight', async () => {
      const token = await setupAdmin()
      const event = await createEvent(token)
      await createDivision(token, event.id, { weightLimitKg: 60 })

      const buffer = buildXlsxBuffer([
        ['Pesado Demais', '', 'Clube', '10/05/1995', 'M', 'azul', 90, '', '', '', '', '', 'S', ''],
      ])
      const res = await postImport(token, event.id, buffer)
      const job = res.json<ImportJobDTO>()
      expect(job.successCount).toBe(0)
      expect(job.errorCount).toBe(1)
      expect(job.errors[0]?.message).toMatch(/nenhuma categoria/i)
    })

    it('uses gender to disambiguate between divisions with overlapping weight caps from the same FPJ preset load', async () => {
      const token = await setupAdmin()
      const event = await createEvent(token)

      await app.inject({
        method: 'POST',
        url: '/api/division-templates/load-preset',
        headers: { authorization: `Bearer ${token}` },
      })
      await app.inject({
        method: 'POST',
        url: `/api/events/${event.id}/divisions/import-from-templates`,
        headers: { authorization: `Bearer ${token}` },
        payload: { templateKeys: ['adulto'] },
      })

      // A 65kg woman fits both "Masculino — Meio Leve" (-66kg) and "Feminino
      // — Médio" (-70kg) by weight alone; only gender tells them apart. The
      // tightest-fit-by-weight rule alone would wrongly pick the male -66kg
      // bracket (66 < 70), which is exactly the bug being guarded against here.
      const buffer = buildXlsxBuffer([
        ['Atleta Visitante', '', 'Clube', '10/05/1995', 'F', 'azul', 65, '', '', '', '', '', 'S', ''],
      ])
      const res = await postImport(token, event.id, buffer)
      const job = res.json<ImportJobDTO>()
      expect(job.successCount).toBe(1)
      expect(job.errorCount).toBe(0)

      const entriesRes = await app.inject({
        method: 'GET',
        url: `/api/events/${event.id}/entries`,
        headers: { authorization: `Bearer ${token}` },
      })
      const entries = entriesRes.json<EntryDTO[]>()
      expect(entries).toHaveLength(1)

      const divisionsRes = await app.inject({
        method: 'GET',
        url: `/api/events/${event.id}/divisions`,
        headers: { authorization: `Bearer ${token}` },
      })
      const divisions = divisionsRes.json<DivisionDTO[]>()
      const matched = divisions.find((d) => d.id === entries[0]?.divisionId)
      expect(matched?.name).toContain('Feminino')
      expect(matched?.name).toContain('Médio')
    })
  })

  it('matches an existing permanent athlete by CPF instead of creating a duplicate', async () => {
    const token = await setupAdmin()
    const event = await createEvent(token)
    await createDivision(token, event.id)

    const existing = await app.inject({
      method: 'POST',
      url: '/api/athletes',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        fullName: 'Atleta Permanente',
        gender: 'male',
        birthDate: '1990-01-01',
        currentBelt: 'blue',
        cpf: '111.444.777-35',
        termsAccepted: true,
      },
    })
    const existingAthlete = existing.json<AthleteDTO>()

    const buffer = buildXlsxBuffer([
      ['Atleta Permanente', '', 'Academia Teste', '10/05/1990', 'M', 'azul', 80, '11144477735', '', '', '', '', 'S', ''],
    ])
    const res = await postImport(token, event.id, buffer)
    const job = res.json<ImportJobDTO>()
    expect(job.successCount).toBe(1)

    const entriesRes = await app.inject({
      method: 'GET',
      url: `/api/events/${event.id}/entries`,
      headers: { authorization: `Bearer ${token}` },
    })
    const entries = entriesRes.json<EntryDTO[]>()
    expect(entries).toHaveLength(1)
    expect(entries[0]?.athleteId).toBe(existingAthlete.id)

    const athletesRes = await app.inject({
      method: 'GET',
      url: '/api/athletes',
      headers: { authorization: `Bearer ${token}` },
    })
    expect(athletesRes.json<{ total: number }>().total).toBe(1) // no duplicate created
  })

  it('re-importing the same athlete into the same division reports a row error, not a crash', async () => {
    const token = await setupAdmin()
    const event = await createEvent(token)
    await createDivision(token, event.id)
    const buffer = buildXlsxBuffer([
      ['Repetido', '', 'Clube', '10/05/1995', 'M', 'azul', 80, '111.444.777-35', '', '', '', '', 'S', ''],
    ])

    const first = await postImport(token, event.id, buffer)
    expect(first.json<ImportJobDTO>().successCount).toBe(1)

    const second = await postImport(token, event.id, buffer)
    const job = second.json<ImportJobDTO>()
    expect(job.successCount).toBe(0)
    expect(job.errorCount).toBe(1)
  })
})

// ─── Jobs ────────────────────────────────────────────────────────────────

describe('GET /api/events/:id/import/jobs', () => {
  it('lists jobs newest first and returns a single job by id', async () => {
    const token = await setupAdmin()
    const event = await createEvent(token)
    await createDivision(token, event.id)
    const buffer = buildXlsxBuffer([
      ['Nome', '', 'Clube', '10/05/1995', 'M', 'azul', 80, '', '', '', '', '', 'S', ''],
    ])
    const imported = await postImport(token, event.id, buffer)
    const job = imported.json<ImportJobDTO>()

    const listRes = await app.inject({
      method: 'GET',
      url: `/api/events/${event.id}/import/jobs`,
      headers: { authorization: `Bearer ${token}` },
    })
    expect(listRes.json<ImportJobDTO[]>()).toHaveLength(1)

    const getRes = await app.inject({
      method: 'GET',
      url: `/api/events/${event.id}/import/jobs/${job.id}`,
      headers: { authorization: `Bearer ${token}` },
    })
    expect(getRes.statusCode).toBe(200)
    expect(getRes.json<ImportJobDTO>().id).toBe(job.id)

    const notFound = await app.inject({
      method: 'GET',
      url: `/api/events/${event.id}/import/jobs/000000000000000000000000`,
      headers: { authorization: `Bearer ${token}` },
    })
    expect(notFound.statusCode).toBe(404)
  })
})
