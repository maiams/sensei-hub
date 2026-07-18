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

interface GroupDTO {
  id: string
  label: string
  order: number
  categories: Array<{ label: string; maxKg: number | null }>
  canRestoreFromPreset: boolean
}

interface TemplateDTO {
  id: string
  key: string
  label: string
  minAge: number | null
  maxAge: number | null
  order: number
  groups: GroupDTO[]
}

async function loadPreset(token: string) {
  const res = await app.inject({
    method: 'POST',
    url: '/api/division-templates/load-preset',
    headers: { authorization: `Bearer ${token}` },
  })
  return res.json<TemplateDTO[]>()
}

describe('GET /api/division-templates', () => {
  it('returns 401 without token', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/division-templates' })
    expect(res.statusCode).toBe(401)
  })

  it('returns an empty list for a fresh academy', async () => {
    const token = await setupAdmin()
    const res = await app.inject({
      method: 'GET',
      url: '/api/division-templates',
      headers: { authorization: `Bearer ${token}` },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual([])
  })
})

describe('POST /api/division-templates', () => {
  it('returns 403 for staff', async () => {
    const adminToken = await setupAdmin()
    const staffToken = await createUserAndLogin(adminToken, 'staff', 'staff@test.com')
    const res = await app.inject({
      method: 'POST',
      url: '/api/division-templates',
      headers: { authorization: `Bearer ${staffToken}` },
      payload: { label: 'Livre', minAge: 1, maxAge: 99 },
    })
    expect(res.statusCode).toBe(403)
  })

  it('creates a division with an age range', async () => {
    const token = await setupAdmin()
    const res = await app.inject({
      method: 'POST',
      url: '/api/division-templates',
      headers: { authorization: `Bearer ${token}` },
      payload: { label: 'Livre 1-99', minAge: 1, maxAge: 99 },
    })
    expect(res.statusCode).toBe(201)
    const body = res.json<TemplateDTO>()
    expect(body.key).toBe('livre-1-99')
    expect(body.minAge).toBe(1)
    expect(body.maxAge).toBe(99)
    expect(body.groups).toEqual([])
  })

  it('creates a division with no age restriction (both null)', async () => {
    const token = await setupAdmin()
    const res = await app.inject({
      method: 'POST',
      url: '/api/division-templates',
      headers: { authorization: `Bearer ${token}` },
      payload: { label: 'PCD' },
    })
    expect(res.statusCode).toBe(201)
    const body = res.json<TemplateDTO>()
    expect(body.minAge).toBeNull()
    expect(body.maxAge).toBeNull()
  })

  it('deduplicates the slug when labels collide', async () => {
    const token = await setupAdmin()
    const first = await app.inject({
      method: 'POST',
      url: '/api/division-templates',
      headers: { authorization: `Bearer ${token}` },
      payload: { label: 'Pesado' },
    })
    const second = await app.inject({
      method: 'POST',
      url: '/api/division-templates',
      headers: { authorization: `Bearer ${token}` },
      payload: { label: 'Pesado' },
    })
    expect(first.json<TemplateDTO>().key).toBe('pesado')
    expect(second.json<TemplateDTO>().key).toBe('pesado-2')
  })
})

describe('PATCH /api/division-templates/:key', () => {
  it('renames without changing the key', async () => {
    const token = await setupAdmin()
    const created = await app.inject({
      method: 'POST',
      url: '/api/division-templates',
      headers: { authorization: `Bearer ${token}` },
      payload: { label: 'Pre Mirim Custom', minAge: 5, maxAge: 6 },
    })
    const { key } = created.json<TemplateDTO>()

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/division-templates/${key}`,
      headers: { authorization: `Bearer ${token}` },
      payload: { label: 'Novo Nome', maxAge: 7 },
    })
    expect(res.statusCode).toBe(200)
    const body = res.json<TemplateDTO>()
    expect(body.key).toBe(key)
    expect(body.label).toBe('Novo Nome')
    expect(body.maxAge).toBe(7)
  })

  it('returns 404 for an unknown key', async () => {
    const token = await setupAdmin()
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/division-templates/nao-existe',
      headers: { authorization: `Bearer ${token}` },
      payload: { label: 'X' },
    })
    expect(res.statusCode).toBe(404)
  })

  it('returns 403 for staff', async () => {
    const adminToken = await setupAdmin()
    const staffToken = await createUserAndLogin(adminToken, 'staff', 'staff2@test.com')
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/division-templates/qualquer',
      headers: { authorization: `Bearer ${staffToken}` },
      payload: { label: 'X' },
    })
    expect(res.statusCode).toBe(403)
  })
})

describe('DELETE /api/division-templates/:key', () => {
  it('cascades: deleting a division removes its groups too', async () => {
    const token = await setupAdmin()
    const templates = await loadPreset(token)
    const preMirim = templates.find((t) => t.key === 'pre-mirim')!

    const del = await app.inject({
      method: 'DELETE',
      url: `/api/division-templates/${preMirim.key}`,
      headers: { authorization: `Bearer ${token}` },
    })
    expect(del.statusCode).toBe(204)

    const groupsRes = await app.inject({
      method: 'GET',
      url: `/api/division-templates/${preMirim.key}/groups`,
      headers: { authorization: `Bearer ${token}` },
    })
    expect(groupsRes.statusCode).toBe(404)

    const listRes = await app.inject({
      method: 'GET',
      url: '/api/division-templates',
      headers: { authorization: `Bearer ${token}` },
    })
    const keys = listRes.json<TemplateDTO[]>().map((t) => t.key)
    expect(keys).not.toContain('pre-mirim')
  })

  it('returns 404 for an unknown key and 403 for staff', async () => {
    const adminToken = await setupAdmin()
    const notFound = await app.inject({
      method: 'DELETE',
      url: '/api/division-templates/nao-existe',
      headers: { authorization: `Bearer ${adminToken}` },
    })
    expect(notFound.statusCode).toBe(404)

    const staffToken = await createUserAndLogin(adminToken, 'staff', 'staff3@test.com')
    const forbidden = await app.inject({
      method: 'DELETE',
      url: '/api/division-templates/pre-mirim',
      headers: { authorization: `Bearer ${staffToken}` },
    })
    expect(forbidden.statusCode).toBe(403)
  })
})

describe('POST /api/division-templates/load-preset', () => {
  it('creates all 6 FPJ divisions with Masculino/Feminino groups', async () => {
    const token = await setupAdmin()
    const created = await loadPreset(token)
    expect(created).toHaveLength(6)

    const adulto = created.find((t) => t.key === 'adulto')!
    expect(adulto.groups.map((g) => g.label)).toEqual(['Masculino', 'Feminino'])
    expect(adulto.groups[0]?.categories.map((c) => c.label)).toEqual([
      'Ligeiro', 'Meio Leve', 'Leve', 'Meio Médio', 'Médio', 'Meio Pesado', 'Pesado',
    ])
    expect(adulto.groups.every((g) => g.canRestoreFromPreset)).toBe(true)
  })

  it('is idempotent: only recreates divisions missing by key, does not touch edited ones', async () => {
    const token = await setupAdmin()
    await loadPreset(token)

    // Delete "pre-mirim" entirely, edit "mirim"'s Masculino group
    await app.inject({
      method: 'DELETE',
      url: '/api/division-templates/pre-mirim',
      headers: { authorization: `Bearer ${token}` },
    })
    const mirimGroups = await app.inject({
      method: 'GET',
      url: '/api/division-templates/mirim/groups',
      headers: { authorization: `Bearer ${token}` },
    })
    const mirimMasculino = mirimGroups.json<GroupDTO[]>().find((g) => g.label === 'Masculino')!
    await app.inject({
      method: 'PATCH',
      url: `/api/division-templates/mirim/groups/${mirimMasculino.id}`,
      headers: { authorization: `Bearer ${token}` },
      payload: { categories: [{ label: 'Único', maxKg: null }] },
    })

    const reloaded = await loadPreset(token)
    expect(reloaded).toHaveLength(1)
    expect(reloaded[0]?.key).toBe('pre-mirim')

    // mirim's edit must survive the reload
    const mirimAfter = await app.inject({
      method: 'GET',
      url: '/api/division-templates/mirim/groups',
      headers: { authorization: `Bearer ${token}` },
    })
    const mirimMasculinoAfter = mirimAfter.json<GroupDTO[]>().find((g) => g.label === 'Masculino')!
    expect(mirimMasculinoAfter.categories).toEqual([{ label: 'Único', maxKg: null }])
  })

  it('returns an empty array when nothing is missing, no duplicates', async () => {
    const token = await setupAdmin()
    await loadPreset(token)
    const second = await loadPreset(token)
    expect(second).toEqual([])

    const list = await app.inject({
      method: 'GET',
      url: '/api/division-templates',
      headers: { authorization: `Bearer ${token}` },
    })
    expect(list.json<TemplateDTO[]>()).toHaveLength(6)
  })

  it('returns 403 for staff', async () => {
    const adminToken = await setupAdmin()
    const staffToken = await createUserAndLogin(adminToken, 'staff', 'staff4@test.com')
    const res = await app.inject({
      method: 'POST',
      url: '/api/division-templates/load-preset',
      headers: { authorization: `Bearer ${staffToken}` },
    })
    expect(res.statusCode).toBe(403)
  })
})

describe('Groups', () => {
  it('creates a custom group alongside the preset groups', async () => {
    const token = await setupAdmin()
    const templates = await loadPreset(token)
    const adulto = templates.find((t) => t.key === 'adulto')!

    const res = await app.inject({
      method: 'POST',
      url: `/api/division-templates/${adulto.key}/groups`,
      headers: { authorization: `Bearer ${token}` },
      payload: { label: 'Misto', categories: [{ label: 'Único', maxKg: null }] },
    })
    expect(res.statusCode).toBe(201)
    const created = res.json<GroupDTO>()
    expect(created.canRestoreFromPreset).toBe(false)

    const list = await app.inject({
      method: 'GET',
      url: `/api/division-templates/${adulto.key}/groups`,
      headers: { authorization: `Bearer ${token}` },
    })
    expect(list.json<GroupDTO[]>().map((g) => g.label)).toEqual(['Masculino', 'Feminino', 'Misto'])
  })

  it('returns 400 for non-ascending categories and 400 for a non-last open category', async () => {
    const token = await setupAdmin()
    const templates = await loadPreset(token)
    const adulto = templates.find((t) => t.key === 'adulto')!

    const nonAscending = await app.inject({
      method: 'POST',
      url: `/api/division-templates/${adulto.key}/groups`,
      headers: { authorization: `Bearer ${token}` },
      payload: { label: 'Teste', categories: [{ label: 'A', maxKg: 80 }, { label: 'B', maxKg: 70 }] },
    })
    expect(nonAscending.statusCode).toBe(400)

    const openNotLast = await app.inject({
      method: 'POST',
      url: `/api/division-templates/${adulto.key}/groups`,
      headers: { authorization: `Bearer ${token}` },
      payload: { label: 'Teste2', categories: [{ label: 'A', maxKg: null }, { label: 'B', maxKg: 70 }] },
    })
    expect(openNotLast.statusCode).toBe(400)
  })

  it('deletes one of two groups without affecting the other', async () => {
    const token = await setupAdmin()
    const templates = await loadPreset(token)
    const adulto = templates.find((t) => t.key === 'adulto')!
    const feminino = adulto.groups.find((g) => g.label === 'Feminino')!

    const del = await app.inject({
      method: 'DELETE',
      url: `/api/division-templates/${adulto.key}/groups/${feminino.id}`,
      headers: { authorization: `Bearer ${token}` },
    })
    expect(del.statusCode).toBe(204)

    const list = await app.inject({
      method: 'GET',
      url: `/api/division-templates/${adulto.key}/groups`,
      headers: { authorization: `Bearer ${token}` },
    })
    expect(list.json<GroupDTO[]>().map((g) => g.label)).toEqual(['Masculino'])
  })

  it('renaming a preset group does not break restore-from-preset', async () => {
    const token = await setupAdmin()
    const templates = await loadPreset(token)
    const adulto = templates.find((t) => t.key === 'adulto')!
    const masculino = adulto.groups.find((g) => g.label === 'Masculino')!

    await app.inject({
      method: 'PATCH',
      url: `/api/division-templates/${adulto.key}/groups/${masculino.id}`,
      headers: { authorization: `Bearer ${token}` },
      payload: { label: 'Homens', categories: [{ label: 'Único', maxKg: null }] },
    })

    const restore = await app.inject({
      method: 'POST',
      url: `/api/division-templates/${adulto.key}/groups/${masculino.id}/restore`,
      headers: { authorization: `Bearer ${token}` },
    })
    expect(restore.statusCode).toBe(200)
    const body = restore.json<GroupDTO>()
    expect(body.label).toBe('Homens') // renamed label is preserved, only categories restore
    expect(body.categories.map((c) => c.label)).toEqual([
      'Ligeiro', 'Meio Leve', 'Leve', 'Meio Médio', 'Médio', 'Meio Pesado', 'Pesado',
    ])
  })

  it('returns 400 restoring a custom (non-preset) group', async () => {
    const token = await setupAdmin()
    const templates = await loadPreset(token)
    const adulto = templates.find((t) => t.key === 'adulto')!

    const created = await app.inject({
      method: 'POST',
      url: `/api/division-templates/${adulto.key}/groups`,
      headers: { authorization: `Bearer ${token}` },
      payload: { label: 'Misto', categories: [{ label: 'Único', maxKg: null }] },
    })
    const group = created.json<GroupDTO>()

    const restore = await app.inject({
      method: 'POST',
      url: `/api/division-templates/${adulto.key}/groups/${group.id}/restore`,
      headers: { authorization: `Bearer ${token}` },
    })
    expect(restore.statusCode).toBe(400)
  })

  it('staff can read groups but not write', async () => {
    const adminToken = await setupAdmin()
    const templates = await loadPreset(adminToken)
    const adulto = templates.find((t) => t.key === 'adulto')!
    const staffToken = await createUserAndLogin(adminToken, 'staff', 'staff5@test.com')

    const read = await app.inject({
      method: 'GET',
      url: `/api/division-templates/${adulto.key}/groups`,
      headers: { authorization: `Bearer ${staffToken}` },
    })
    expect(read.statusCode).toBe(200)

    const write = await app.inject({
      method: 'POST',
      url: `/api/division-templates/${adulto.key}/groups`,
      headers: { authorization: `Bearer ${staffToken}` },
      payload: { label: 'X', categories: [{ label: 'Único', maxKg: null }] },
    })
    expect(write.statusCode).toBe(403)
  })
})

describe('End-to-end: collapse everything into a single free-form division', () => {
  it('load preset, delete all 6, create one custom division with one group', async () => {
    const token = await setupAdmin()
    const templates = await loadPreset(token)
    expect(templates).toHaveLength(6)

    for (const t of templates) {
      await app.inject({
        method: 'DELETE',
        url: `/api/division-templates/${t.key}`,
        headers: { authorization: `Bearer ${token}` },
      })
    }

    const created = await app.inject({
      method: 'POST',
      url: '/api/division-templates',
      headers: { authorization: `Bearer ${token}` },
      payload: { label: 'Livre', minAge: 1, maxAge: 99 },
    })
    const livre = created.json<TemplateDTO>()

    await app.inject({
      method: 'POST',
      url: `/api/division-templates/${livre.key}/groups`,
      headers: { authorization: `Bearer ${token}` },
      payload: { label: 'Todos', categories: [{ label: 'Único', maxKg: null }] },
    })

    const finalList = await app.inject({
      method: 'GET',
      url: '/api/division-templates',
      headers: { authorization: `Bearer ${token}` },
    })
    const final = finalList.json<TemplateDTO[]>()
    expect(final).toHaveLength(1)
    expect(final[0]?.label).toBe('Livre')
    expect(final[0]?.groups.map((g) => g.label)).toEqual(['Todos'])
  })
})

describe('Match rules (matchRules)', () => {
  const CBJ_DEFAULT = {
    matchDurationSeconds: 240,
    goldenScoreEnabled: true,
    goldenScoreDurationSeconds: null,
    osaekomiYukoSeconds: 5,
    osaekomiWazaariSeconds: 10,
    osaekomiIpponSeconds: 20,
  }

  it('creating a template without matchRules applies the CBJ default', async () => {
    const token = await setupAdmin()
    const res = await app.inject({
      method: 'POST',
      url: '/api/division-templates',
      headers: { authorization: `Bearer ${token}` },
      payload: { label: 'Livre' },
    })
    expect(res.statusCode).toBe(201)
    expect(res.json().matchRules).toEqual(CBJ_DEFAULT)
  })

  it('PATCH updates matchRules (golden score disabled, shorter fight)', async () => {
    const token = await setupAdmin()
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/division-templates',
      headers: { authorization: `Bearer ${token}` },
      payload: { label: 'Festival Kids' },
    })
    const key = createRes.json().key

    const newRules = {
      matchDurationSeconds: 90,
      goldenScoreEnabled: false,
      goldenScoreDurationSeconds: null,
      osaekomiYukoSeconds: 5,
      osaekomiWazaariSeconds: 10,
      osaekomiIpponSeconds: 15,
    }
    const patchRes = await app.inject({
      method: 'PATCH',
      url: `/api/division-templates/${key}`,
      headers: { authorization: `Bearer ${token}` },
      payload: { matchRules: newRules },
    })
    expect(patchRes.statusCode).toBe(200)
    expect(patchRes.json().matchRules).toEqual(newRules)

    const listRes = await app.inject({
      method: 'GET',
      url: '/api/division-templates',
      headers: { authorization: `Bearer ${token}` },
    })
    const persisted = listRes.json<Array<{ key: string; matchRules: unknown }>>().find((t) => t.key === key)
    expect(persisted?.matchRules).toEqual(newRules)
  })

  it('rejects osaekomi thresholds that are not strictly increasing', async () => {
    const token = await setupAdmin()
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/division-templates',
      headers: { authorization: `Bearer ${token}` },
      payload: { label: 'Livre' },
    })
    const key = createRes.json().key

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/division-templates/${key}`,
      headers: { authorization: `Bearer ${token}` },
      payload: {
        matchRules: {
          matchDurationSeconds: 240,
          goldenScoreEnabled: true,
          goldenScoreDurationSeconds: null,
          osaekomiYukoSeconds: 10,
          osaekomiWazaariSeconds: 10,
          osaekomiIpponSeconds: 20,
        },
      },
    })
    expect(res.statusCode).toBe(400)
  })

  it('load-preset applies CBJ RNC 2025 fight times per age class', async () => {
    const token = await setupAdmin()
    const templates = await loadPreset(token)
    const byKey = new Map(templates.map((t) => [t.key, t as unknown as { matchRules: typeof CBJ_DEFAULT }]))

    expect(byKey.get('infantil')?.matchRules.matchDurationSeconds).toBe(120) // Sub-13: 2min
    expect(byKey.get('infanto-juvenil')?.matchRules.matchDurationSeconds).toBe(180) // Sub-15: 3min
    expect(byKey.get('juvenil')?.matchRules.matchDurationSeconds).toBe(240) // Cadete: 4min
    expect(byKey.get('adulto')?.matchRules.matchDurationSeconds).toBe(240)
    // Sub-09/Sub-11 are not in the RNC — preset assumes 2min like Sub-13
    expect(byKey.get('pre-mirim')?.matchRules.matchDurationSeconds).toBe(120)
    expect(byKey.get('mirim')?.matchRules.matchDurationSeconds).toBe(120)

    for (const t of templates as unknown as Array<{ matchRules: typeof CBJ_DEFAULT }>) {
      expect(t.matchRules.goldenScoreEnabled).toBe(true)
      expect(t.matchRules.goldenScoreDurationSeconds).toBeNull()
      expect(t.matchRules.osaekomiYukoSeconds).toBe(5)
      expect(t.matchRules.osaekomiWazaariSeconds).toBe(10)
      expect(t.matchRules.osaekomiIpponSeconds).toBe(20)
    }
  })

  it('templates created before the field existed fall back to the CBJ default in the DTO', async () => {
    const token = await setupAdmin()
    // Simulate a pre-existing document without matchRules by writing directly.
    const { DivisionTemplateModel } = await import('../repositories/DivisionTemplateModel.js')
    const { AcademyModel } = await import('@sensei-hub/core-server')
    const academy = await AcademyModel.findOne()
    await DivisionTemplateModel.create({
      academyId: academy!._id,
      key: 'legado',
      label: 'Legado',
      minAge: null,
      maxAge: null,
      order: 0,
    })

    const res = await app.inject({
      method: 'GET',
      url: '/api/division-templates',
      headers: { authorization: `Bearer ${token}` },
    })
    const legacy = res.json<Array<{ key: string; matchRules: unknown }>>().find((t) => t.key === 'legado')
    expect(legacy?.matchRules).toEqual(CBJ_DEFAULT)
  })
})
