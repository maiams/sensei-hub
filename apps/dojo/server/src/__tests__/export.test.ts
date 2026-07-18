import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { connectTestDb, closeTestDb, clearTestDb } from '@sensei-hub/core-server/testing'
import * as XLSX from 'xlsx'
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

// Literal copy of the dojo→arena contract (ATHLETE_SHEET_HEADERS) — kept
// inline on purpose so an accidental change to the shared constant fails
// this test instead of silently retagging both sides.
const EXPECTED_HEADERS = [
  'nome_completo',
  'nome_preferido',
  'academia',
  'data_nascimento',
  'genero',
  'faixa',
  'peso_declarado_kg',
  'cpf',
  'email',
  'telefone',
  'responsavel_nome',
  'responsavel_telefone',
  'termos_aceitos',
  'observacoes',
]

async function setupAdmin(): Promise<string> {
  await app.inject({
    method: 'POST',
    url: '/api/setup',
    payload: {
      academyName: 'Academia Central',
      adminName: 'Admin',
      adminEmail: 'admin@test.com',
      adminPassword: 'senha12345',
    },
  })
  const loginRes = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { email: 'admin@test.com', password: 'senha12345' },
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
      birthDate: '1990-01-15',
      currentBelt: 'blue',
      termsAccepted: true,
      ...overrides,
    },
  })
  expect(res.statusCode).toBe(201)
  return res.json<{ id: string }>()
}

function sheetRows(payload: Buffer): unknown[][] {
  const wb = XLSX.read(payload, { type: 'buffer' })
  const sheet = wb.Sheets[wb.SheetNames[0] as string]
  return XLSX.utils.sheet_to_json<unknown[]>(sheet as XLSX.WorkSheet, { header: 1 })
}

describe('GET /api/athletes/export', () => {
  it('returns 401 without token', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/athletes/export' })
    expect(res.statusCode).toBe(401)
  })

  it('exports active athletes in the arena import format (headers, dates, belts, terms)', async () => {
    const token = await setupAdmin()
    await createAthlete(token, {
      fullName: 'Ana Lima',
      gender: 'female',
      birthDate: '1995-05-10',
      currentBelt: 'coral-8dan',
      cpf: '11144477735',
      email: 'ana@test.com',
      phone: '11988887777',
    })

    const res = await app.inject({
      method: 'GET',
      url: '/api/athletes/export',
      headers: { authorization: `Bearer ${token}` },
    })
    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toContain('spreadsheetml')

    const rows = sheetRows(res.rawPayload)
    expect(rows[0]).toEqual(EXPECTED_HEADERS)
    expect(rows).toHaveLength(2)

    const [nome, nomePref, academia, data, genero, faixa, , cpf, email, telefone, , , termos] = rows[1] as string[]
    expect(nome).toBe('Ana Lima')
    expect(nomePref).toBe('')
    expect(academia).toBe('Academia Central') // falls back to the academy name when clubName is unset
    expect(data).toBe('10/05/1995') // DD/MM/AAAA, as the arena parser expects
    expect(genero).toBe('F')
    expect(faixa).toBe('Coral 8º Dan') // BELT_LABEL_PT label the arena maps back to coral-8dan
    expect(cpf).toBe('11144477735')
    expect(email).toBe('ana@test.com')
    expect(telefone).toBe('11988887777')
    expect(termos).toBe('S')
  })

  it('exports a minor with the guardian name/phone columns filled', async () => {
    const token = await setupAdmin()
    await createAthlete(token, {
      fullName: 'Maria Souza',
      gender: 'female',
      birthDate: '2015-03-20',
      currentBelt: 'white',
      guardian: {
        name: 'Responsável Souza',
        relationship: 'mother',
        phone: '11999990000',
        termsAccepted: true,
      },
    })

    const res = await app.inject({
      method: 'GET',
      url: '/api/athletes/export',
      headers: { authorization: `Bearer ${token}` },
    })
    const rows = sheetRows(res.rawPayload)
    const [, , , , , , , , , , respNome, respTelefone] = rows[1] as string[]
    expect(respNome).toBe('Responsável Souza')
    expect(respTelefone).toBe('11999990000')
  })

  it('exports gender not_informed as an empty genero cell (arena flags the row for the operator)', async () => {
    const token = await setupAdmin()
    await createAthlete(token, { fullName: 'Alex Silva', gender: 'not_informed' })

    const res = await app.inject({
      method: 'GET',
      url: '/api/athletes/export',
      headers: { authorization: `Bearer ${token}` },
    })
    const rows = sheetRows(res.rawPayload)
    expect((rows[1] as string[])[4]).toBe('')
  })

  it('does not export deactivated athletes', async () => {
    const token = await setupAdmin()
    const athlete = await createAthlete(token, { fullName: 'Inativo Santos' })
    await createAthlete(token, { fullName: 'Ativo Santos' })
    await app.inject({
      method: 'DELETE',
      url: `/api/athletes/${athlete.id}`,
      headers: { authorization: `Bearer ${token}` },
      payload: { reason: 'saiu da academia' },
    })

    const res = await app.inject({
      method: 'GET',
      url: '/api/athletes/export',
      headers: { authorization: `Bearer ${token}` },
    })
    const rows = sheetRows(res.rawPayload)
    expect(rows).toHaveLength(2)
    expect((rows[1] as string[])[0]).toBe('Ativo Santos')
  })
})
