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

// ─── Setup ─────────────────────────────────────────────────────────────────

describe('GET /api/setup/status', () => {
  it('returns setupRequired: true when no academy exists', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/setup/status' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ setupRequired: true })
  })

  it('returns setupRequired: false after setup', async () => {
    await app.inject({
      method: 'POST',
      url: '/api/setup',
      payload: {
        academyName: 'Academia Teste',
        adminName: 'Admin',
        adminEmail: 'admin@test.com',
        adminPassword: 'senha12345',
      },
    })
    const res = await app.inject({ method: 'GET', url: '/api/setup/status' })
    expect(res.json()).toEqual({ setupRequired: false })
  })
})

describe('POST /api/setup', () => {
  it('creates academy and super_admin, returns 201', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/setup',
      payload: {
        academyName: 'Dojo São Paulo',
        adminName: 'Sensei Ricardo',
        adminEmail: 'ricardo@dojo.com',
        adminPassword: 'senha12345',
      },
    })
    expect(res.statusCode).toBe(201)
    const body = res.json()
    expect(body.academy.name).toBe('Dojo São Paulo')
    expect(body.academy.slug).toBe('dojo-sao-paulo')
  })

  it('returns 409 if called a second time', async () => {
    const payload = {
      academyName: 'Academia',
      adminName: 'Admin',
      adminEmail: 'admin@test.com',
      adminPassword: 'senha12345',
    }
    await app.inject({ method: 'POST', url: '/api/setup', payload })
    const res = await app.inject({ method: 'POST', url: '/api/setup', payload })
    expect(res.statusCode).toBe(409)
  })

  it('returns 400 with short password', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/setup',
      payload: {
        academyName: 'Academia',
        adminName: 'Admin',
        adminEmail: 'admin@test.com',
        adminPassword: 'curta',
      },
    })
    expect(res.statusCode).toBe(400)
  })
})

// ─── Login ─────────────────────────────────────────────────────────────────

async function setupAndLogin(email = 'admin@test.com', password = 'senha12345') {
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
  return app.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { email, password },
  })
}

describe('POST /api/auth/login', () => {
  it('returns accessToken and refreshToken on valid credentials', async () => {
    const res = await setupAndLogin()
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body).toHaveProperty('accessToken')
    expect(body).toHaveProperty('refreshToken')
    expect(body.user.role).toBe('super_admin')
  })

  it('returns 401 on wrong password (generic message)', async () => {
    await setupAndLogin()
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'admin@test.com', password: 'errada' },
    })
    expect(res.statusCode).toBe(401)
    expect(res.json().error).toBe('Invalid credentials')
  })

  it('returns 401 on unknown email (generic message)', async () => {
    await setupAndLogin()
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'nao@existe.com', password: 'senha12345' },
    })
    expect(res.statusCode).toBe(401)
    expect(res.json().error).toBe('Invalid credentials')
  })
})

// ─── Token refresh ──────────────────────────────────────────────────────────

describe('POST /api/auth/refresh', () => {
  it('issues new token pair and invalidates the old refresh token', async () => {
    const loginRes = await setupAndLogin()
    const { refreshToken } = loginRes.json<{ refreshToken: string }>()

    const refreshRes = await app.inject({
      method: 'POST',
      url: '/api/auth/refresh',
      payload: { refreshToken },
    })
    expect(refreshRes.statusCode).toBe(200)
    const body = refreshRes.json()
    expect(body).toHaveProperty('accessToken')
    expect(body).toHaveProperty('refreshToken')
    // new token must differ from original
    expect(body.refreshToken).not.toBe(refreshToken)
  })

  it('rejects a reused refresh token (rotation protection)', async () => {
    const loginRes = await setupAndLogin()
    const { refreshToken } = loginRes.json<{ refreshToken: string }>()

    // First use — consumes the token
    await app.inject({
      method: 'POST',
      url: '/api/auth/refresh',
      payload: { refreshToken },
    })

    // Second use — must fail
    const second = await app.inject({
      method: 'POST',
      url: '/api/auth/refresh',
      payload: { refreshToken },
    })
    expect(second.statusCode).toBe(401)
  })

  it('returns 401 for invalid token', async () => {
    await setupAndLogin()
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/refresh',
      payload: { refreshToken: 'token-invalido' },
    })
    expect(res.statusCode).toBe(401)
  })
})

// ─── Logout ─────────────────────────────────────────────────────────────────

describe('POST /api/auth/logout', () => {
  it('invalidates the refresh token, returns 204', async () => {
    const loginRes = await setupAndLogin()
    const { accessToken, refreshToken } = loginRes.json<{ accessToken: string; refreshToken: string }>()

    const logoutRes = await app.inject({
      method: 'POST',
      url: '/api/auth/logout',
      headers: { authorization: `Bearer ${accessToken}` },
      payload: { refreshToken },
    })
    expect(logoutRes.statusCode).toBe(204)

    // Refresh must now fail
    const refreshRes = await app.inject({
      method: 'POST',
      url: '/api/auth/refresh',
      payload: { refreshToken },
    })
    expect(refreshRes.statusCode).toBe(401)
  })
})

// ─── Authorize middleware ────────────────────────────────────────────────────

describe('authorize middleware', () => {
  it('returns 401 on GET /api/users without token', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/users' })
    expect(res.statusCode).toBe(401)
  })

  it('returns 403 when role is below required (staff accessing academy_admin route)', async () => {
    // Create academy + super_admin via setup
    await app.inject({
      method: 'POST',
      url: '/api/setup',
      payload: {
        academyName: 'Academia Teste',
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
    const { accessToken } = loginRes.json<{ accessToken: string }>()

    // Create a staff user
    await app.inject({
      method: 'POST',
      url: '/api/users',
      headers: { authorization: `Bearer ${accessToken}` },
      payload: {
        name: 'Funcionário',
        email: 'staff@test.com',
        password: 'senha12345',
        role: 'staff',
      },
    })

    const staffLogin = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'staff@test.com', password: 'senha12345' },
    })
    const staffToken = staffLogin.json<{ accessToken: string }>().accessToken

    // staff tries to create a user — requires academy_admin
    const res = await app.inject({
      method: 'POST',
      url: '/api/users',
      headers: { authorization: `Bearer ${staffToken}` },
      payload: {
        name: 'Outro',
        email: 'outro@test.com',
        password: 'senha12345',
        role: 'staff',
      },
    })
    expect(res.statusCode).toBe(403)
  })
})

// ─── Change password ────────────────────────────────────────────────────────

describe('PATCH /api/users/me/password', () => {
  it('returns 401 without token', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/users/me/password',
      payload: { oldPassword: 'senha12345', newPassword: 'novaSenha123' },
    })
    expect(res.statusCode).toBe(401)
  })

  it('changes password and allows login with the new one', async () => {
    const loginRes = await setupAndLogin()
    const { accessToken } = loginRes.json<{ accessToken: string }>()

    const res = await app.inject({
      method: 'PATCH',
      url: '/api/users/me/password',
      headers: { authorization: `Bearer ${accessToken}` },
      payload: { oldPassword: 'senha12345', newPassword: 'novaSenha123' },
    })
    expect(res.statusCode).toBe(204)

    const oldLogin = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'admin@test.com', password: 'senha12345' },
    })
    expect(oldLogin.statusCode).toBe(401)

    const newLogin = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'admin@test.com', password: 'novaSenha123' },
    })
    expect(newLogin.statusCode).toBe(200)
  })

  it('returns 401 when oldPassword is wrong', async () => {
    const loginRes = await setupAndLogin()
    const { accessToken } = loginRes.json<{ accessToken: string }>()

    const res = await app.inject({
      method: 'PATCH',
      url: '/api/users/me/password',
      headers: { authorization: `Bearer ${accessToken}` },
      payload: { oldPassword: 'errada', newPassword: 'novaSenha123' },
    })
    expect(res.statusCode).toBe(401)
  })

  it('returns 400 when newPassword is too short', async () => {
    const loginRes = await setupAndLogin()
    const { accessToken } = loginRes.json<{ accessToken: string }>()

    const res = await app.inject({
      method: 'PATCH',
      url: '/api/users/me/password',
      headers: { authorization: `Bearer ${accessToken}` },
      payload: { oldPassword: 'senha12345', newPassword: 'curta' },
    })
    expect(res.statusCode).toBe(400)
  })
})
