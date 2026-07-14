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

interface GroupDTO {
  groupKey: string
  label: string
  gender: string
  categories: Array<{ label: string; maxKg: number | null }>
  isDefault: boolean
}

describe('GET /api/weight-categories', () => {
  it('returns 401 without token', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/weight-categories' })
    expect(res.statusCode).toBe(401)
  })

  it('returns 12 groups (6 age groups x 2 genders), all default', async () => {
    const token = await setupAdmin()
    const res = await app.inject({
      method: 'GET',
      url: '/api/weight-categories',
      headers: { authorization: `Bearer ${token}` },
    })
    expect(res.statusCode).toBe(200)
    const groups = res.json<GroupDTO[]>()
    expect(groups).toHaveLength(12)
    expect(groups.every((g) => g.isDefault)).toBe(true)

    const adultoMale = groups.find((g) => g.groupKey === 'adulto' && g.gender === 'male')
    expect(adultoMale?.categories.map((c) => c.label)).toEqual([
      'Ligeiro', 'Meio Leve', 'Leve', 'Meio Médio', 'Médio', 'Meio Pesado', 'Pesado',
    ])
    expect(adultoMale?.categories.at(-1)?.maxKg).toBeNull()
  })
})

describe('PUT /api/weight-categories/:groupKey/:gender', () => {
  it('returns 403 for staff (requires academy_admin)', async () => {
    const adminToken = await setupAdmin()
    const staffToken = await createUserAndLogin(adminToken, 'staff', 'staff@test.com')
    const res = await app.inject({
      method: 'PUT',
      url: '/api/weight-categories/adulto/male',
      headers: { authorization: `Bearer ${staffToken}` },
      payload: { categories: [{ label: 'Único', maxKg: null }] },
    })
    expect(res.statusCode).toBe(403)
  })

  it('updates a group and marks it as customized', async () => {
    const token = await setupAdmin()
    const newCategories = [
      { label: 'Leve', maxKg: 70 },
      { label: 'Pesado', maxKg: null },
    ]
    const res = await app.inject({
      method: 'PUT',
      url: '/api/weight-categories/adulto/male',
      headers: { authorization: `Bearer ${token}` },
      payload: { categories: newCategories },
    })
    expect(res.statusCode).toBe(200)
    const body = res.json<GroupDTO>()
    expect(body.isDefault).toBe(false)
    expect(body.categories).toEqual(newCategories)

    const listRes = await app.inject({
      method: 'GET',
      url: '/api/weight-categories',
      headers: { authorization: `Bearer ${token}` },
    })
    const groups = listRes.json<GroupDTO[]>()
    const adultoMale = groups.find((g) => g.groupKey === 'adulto' && g.gender === 'male')
    expect(adultoMale?.isDefault).toBe(false)
    expect(adultoMale?.categories).toEqual(newCategories)

    // Other groups/genders remain untouched
    const adultoFemale = groups.find((g) => g.groupKey === 'adulto' && g.gender === 'female')
    expect(adultoFemale?.isDefault).toBe(true)
  })

  it('returns 400 when a non-last category has no maxKg', async () => {
    const token = await setupAdmin()
    const res = await app.inject({
      method: 'PUT',
      url: '/api/weight-categories/adulto/male',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        categories: [
          { label: 'Aberta', maxKg: null },
          { label: 'Pesado', maxKg: 100 },
        ],
      },
    })
    expect(res.statusCode).toBe(400)
  })

  it('returns 400 when categories are not in strictly ascending order', async () => {
    const token = await setupAdmin()
    const res = await app.inject({
      method: 'PUT',
      url: '/api/weight-categories/adulto/male',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        categories: [
          { label: 'Leve', maxKg: 80 },
          { label: 'Médio', maxKg: 70 },
          { label: 'Pesado', maxKg: null },
        ],
      },
    })
    expect(res.statusCode).toBe(400)
  })

  it('returns 404 for an unknown group', async () => {
    const token = await setupAdmin()
    const res = await app.inject({
      method: 'PUT',
      url: '/api/weight-categories/nao-existe/male',
      headers: { authorization: `Bearer ${token}` },
      payload: { categories: [{ label: 'Único', maxKg: null }] },
    })
    expect(res.statusCode).toBe(404)
  })
})

describe('DELETE /api/weight-categories/:groupKey/:gender', () => {
  it('resets a customized group back to the default', async () => {
    const token = await setupAdmin()
    await app.inject({
      method: 'PUT',
      url: '/api/weight-categories/mirim/female',
      headers: { authorization: `Bearer ${token}` },
      payload: { categories: [{ label: 'Único', maxKg: null }] },
    })

    const res = await app.inject({
      method: 'DELETE',
      url: '/api/weight-categories/mirim/female',
      headers: { authorization: `Bearer ${token}` },
    })
    expect(res.statusCode).toBe(200)
    const body = res.json<GroupDTO>()
    expect(body.isDefault).toBe(true)
    expect(body.categories.map((c) => c.label)).toEqual([
      'Super Ligeiro', 'Ligeiro', 'Meio Leve', 'Leve', 'Meio Médio',
      'Médio', 'Meio Pesado', 'Pesado', 'Super Pesado', 'Extra Pesado',
    ])
  })

  it('returns 403 for staff', async () => {
    const adminToken = await setupAdmin()
    const staffToken = await createUserAndLogin(adminToken, 'staff', 'staff2@test.com')
    const res = await app.inject({
      method: 'DELETE',
      url: '/api/weight-categories/mirim/female',
      headers: { authorization: `Bearer ${staffToken}` },
    })
    expect(res.statusCode).toBe(403)
  })
})
