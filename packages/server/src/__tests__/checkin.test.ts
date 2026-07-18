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
  status: string
}
interface AttendanceDTO {
  id: string
  eventId: string
  athleteId: string
  method: string
  status: 'active' | 'revoked'
  checkedInAt: string
  entriesUpdated: number
  revokedReason?: string
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

async function createDivision(token: string, eventId: string, overrides: Record<string, unknown> = {}) {
  const res = await app.inject({
    method: 'POST',
    url: `/api/events/${eventId}/divisions`,
    headers: { authorization: `Bearer ${token}` },
    payload: { name: 'Adulto Médio', weightLimitKg: 90, ...overrides },
  })
  return res.json<DivisionDTO>()
}

async function createEntry(token: string, eventId: string, divisionId: string, athleteId: string) {
  const res = await app.inject({
    method: 'POST',
    url: `/api/events/${eventId}/entries`,
    headers: { authorization: `Bearer ${token}` },
    payload: { divisionId, athleteId },
  })
  return res.json<EntryDTO>()
}

async function checkIn(token: string, eventId: string, athleteId: string, method = 'staff_search') {
  return app.inject({
    method: 'POST',
    url: `/api/events/${eventId}/checkin`,
    headers: { authorization: `Bearer ${token}` },
    payload: { athleteId, method },
  })
}

describe('POST /api/events/:id/checkin', () => {
  it('creates an Attendance record and advances the athlete\'s registered entries to checked_in', async () => {
    const token = await setupAdmin()
    const event = await createEvent(token)
    const division = await createDivision(token, event.id)
    const athlete = await createAthlete(token)
    const entry = await createEntry(token, event.id, division.id, athlete.id)

    const res = await checkIn(token, event.id, athlete.id)
    expect(res.statusCode).toBe(201)
    const attendance = res.json<AttendanceDTO>()
    expect(attendance.status).toBe('active')
    expect(attendance.method).toBe('staff_search')
    expect(attendance.entriesUpdated).toBe(1)

    const entriesRes = await app.inject({
      method: 'GET',
      url: `/api/events/${event.id}/entries`,
      headers: { authorization: `Bearer ${token}` },
    })
    const updatedEntry = entriesRes.json<EntryDTO[]>().find((e) => e.id === entry.id)
    expect(updatedEntry?.status).toBe('checked_in')
  })

  it('allows check-in with zero registered entries (presence is independent of division registration)', async () => {
    const token = await setupAdmin()
    const event = await createEvent(token)
    const athlete = await createAthlete(token)

    const res = await checkIn(token, event.id, athlete.id)
    expect(res.statusCode).toBe(201)
    expect(res.json<AttendanceDTO>().entriesUpdated).toBe(0)
  })

  it('only advances entries in "registered" status, leaving others untouched', async () => {
    const token = await setupAdmin()
    const event = await createEvent(token)
    const divisionA = await createDivision(token, event.id, { name: 'Div A' })
    const divisionB = await createDivision(token, event.id, { name: 'Div B' })
    const athlete = await createAthlete(token)
    const entryA = await createEntry(token, event.id, divisionA.id, athlete.id)
    await createEntry(token, event.id, divisionB.id, athlete.id)

    // withdraw entryA before check-in — it must not be touched by check-in
    await app.inject({
      method: 'PATCH',
      url: `/api/events/${event.id}/entries/${entryA.id}/withdraw`,
      headers: { authorization: `Bearer ${token}` },
      payload: { reason: 'lesão' },
    })

    const res = await checkIn(token, event.id, athlete.id)
    expect(res.json<AttendanceDTO>().entriesUpdated).toBe(1) // only divisionB's entry

    const entriesRes = await app.inject({
      method: 'GET',
      url: `/api/events/${event.id}/entries`,
      headers: { authorization: `Bearer ${token}` },
    })
    const entries = entriesRes.json<EntryDTO[]>()
    expect(entries.find((e) => e.id === entryA.id)?.status).toBe('withdrawn')
    expect(entries.find((e) => e.id !== entryA.id)?.status).toBe('checked_in')
  })

  it('returns 409 with the prior check-in details on a duplicate active check-in', async () => {
    const token = await setupAdmin()
    const event = await createEvent(token)
    const athlete = await createAthlete(token)

    const first = await checkIn(token, event.id, athlete.id)
    expect(first.statusCode).toBe(201)
    const firstId = first.json<AttendanceDTO>().id

    const second = await checkIn(token, event.id, athlete.id)
    expect(second.statusCode).toBe(409)
    const body = second.json<{ error: string; details?: AttendanceDTO }>()
    expect(body.details?.id).toBe(firstId)
    expect(body.details?.status).toBe('active')
  })

  it('returns 404 for an athlete outside the academy or a nonexistent event', async () => {
    const token = await setupAdmin()
    const event = await createEvent(token)
    const res = await checkIn(token, event.id, '000000000000000000000000')
    expect(res.statusCode).toBe(404)
  })

  it('RBAC: check-in requires staff+', async () => {
    const token = await setupAdmin()
    const event = await createEvent(token)
    const athlete = await createAthlete(token)
    const athleteRoleToken = await createUserAndLogin(token, 'athlete', 'athlete@test.com')

    const res = await checkIn(athleteRoleToken, event.id, athlete.id)
    expect(res.statusCode).toBe(403)
  })
})

describe('DELETE /api/events/:id/checkin/:aid (undo)', () => {
  it('revokes the attendance and reverts entries still in checked_in back to registered', async () => {
    const token = await setupAdmin()
    const event = await createEvent(token)
    const division = await createDivision(token, event.id)
    const athlete = await createAthlete(token)
    const entry = await createEntry(token, event.id, division.id, athlete.id)
    const attendance = (await checkIn(token, event.id, athlete.id)).json<AttendanceDTO>()

    const res = await app.inject({
      method: 'DELETE',
      url: `/api/events/${event.id}/checkin/${attendance.id}`,
      headers: { authorization: `Bearer ${token}` },
      payload: { reason: 'check-in por engano' },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json<AttendanceDTO>().status).toBe('revoked')

    const entriesRes = await app.inject({
      method: 'GET',
      url: `/api/events/${event.id}/entries`,
      headers: { authorization: `Bearer ${token}` },
    })
    expect(entriesRes.json<EntryDTO[]>().find((e) => e.id === entry.id)?.status).toBe('registered')

    // athlete can be checked in again after undo (partial unique index allows it)
    const again = await checkIn(token, event.id, athlete.id)
    expect(again.statusCode).toBe(201)
  })

  it('does not revert an entry that already progressed past checked_in', async () => {
    const token = await setupAdmin()
    const event = await createEvent(token)
    const division = await createDivision(token, event.id)
    const athlete = await createAthlete(token)
    const entry = await createEntry(token, event.id, division.id, athlete.id)
    const attendance = (await checkIn(token, event.id, athlete.id)).json<AttendanceDTO>()

    await app.inject({
      method: 'PATCH',
      url: `/api/events/${event.id}/entries/${entry.id}/weighin`,
      headers: { authorization: `Bearer ${token}` },
      payload: { weightKg: 80 },
    })

    await app.inject({
      method: 'DELETE',
      url: `/api/events/${event.id}/checkin/${attendance.id}`,
      headers: { authorization: `Bearer ${token}` },
      payload: { reason: 'engano' },
    })

    const entriesRes = await app.inject({
      method: 'GET',
      url: `/api/events/${event.id}/entries`,
      headers: { authorization: `Bearer ${token}` },
    })
    expect(entriesRes.json<EntryDTO[]>().find((e) => e.id === entry.id)?.status).toBe('weighed_in')
  })

  it('requires a reason and returns 409 undoing an already-revoked check-in', async () => {
    const token = await setupAdmin()
    const event = await createEvent(token)
    const athlete = await createAthlete(token)
    const attendance = (await checkIn(token, event.id, athlete.id)).json<AttendanceDTO>()

    const noReason = await app.inject({
      method: 'DELETE',
      url: `/api/events/${event.id}/checkin/${attendance.id}`,
      headers: { authorization: `Bearer ${token}` },
      payload: {},
    })
    expect(noReason.statusCode).toBe(400)

    await app.inject({
      method: 'DELETE',
      url: `/api/events/${event.id}/checkin/${attendance.id}`,
      headers: { authorization: `Bearer ${token}` },
      payload: { reason: 'engano' },
    })
    const twice = await app.inject({
      method: 'DELETE',
      url: `/api/events/${event.id}/checkin/${attendance.id}`,
      headers: { authorization: `Bearer ${token}` },
      payload: { reason: 'engano de novo' },
    })
    expect(twice.statusCode).toBe(409)
  })

  it('RBAC: undo requires event_manager+ (staff cannot)', async () => {
    const token = await setupAdmin()
    const event = await createEvent(token)
    const athlete = await createAthlete(token)
    const attendance = (await checkIn(token, event.id, athlete.id)).json<AttendanceDTO>()
    const staffToken = await createUserAndLogin(token, 'staff', 'staff@test.com')

    const res = await app.inject({
      method: 'DELETE',
      url: `/api/events/${event.id}/checkin/${attendance.id}`,
      headers: { authorization: `Bearer ${staffToken}` },
      payload: { reason: 'engano' },
    })
    expect(res.statusCode).toBe(403)
  })
})

describe('GET /api/events/:id/checkin', () => {
  it('lists attendance records, filterable by status', async () => {
    const token = await setupAdmin()
    const event = await createEvent(token)
    const athleteA = await createAthlete(token, { fullName: 'Athlete A' })
    const athleteB = await createAthlete(token, { fullName: 'Athlete B' })
    await checkIn(token, event.id, athleteA.id)
    const attendanceB = (await checkIn(token, event.id, athleteB.id)).json<AttendanceDTO>()
    await app.inject({
      method: 'DELETE',
      url: `/api/events/${event.id}/checkin/${attendanceB.id}`,
      headers: { authorization: `Bearer ${token}` },
      payload: { reason: 'engano' },
    })

    const all = await app.inject({
      method: 'GET',
      url: `/api/events/${event.id}/checkin`,
      headers: { authorization: `Bearer ${token}` },
    })
    expect(all.json<AttendanceDTO[]>()).toHaveLength(2)

    const activeOnly = await app.inject({
      method: 'GET',
      url: `/api/events/${event.id}/checkin?status=active`,
      headers: { authorization: `Bearer ${token}` },
    })
    const activeList = activeOnly.json<AttendanceDTO[]>()
    expect(activeList).toHaveLength(1)
    expect(activeList[0]?.athleteId).toBe(athleteA.id)
  })

  it('persists entriesUpdated so the listing reflects it, not just the original POST response', async () => {
    const token = await setupAdmin()
    const event = await createEvent(token)
    const division = await createDivision(token, event.id)
    const athlete = await createAthlete(token)
    await createEntry(token, event.id, division.id, athlete.id)

    const posted = (await checkIn(token, event.id, athlete.id)).json<AttendanceDTO>()
    expect(posted.entriesUpdated).toBe(1)

    const listed = await app.inject({
      method: 'GET',
      url: `/api/events/${event.id}/checkin`,
      headers: { authorization: `Bearer ${token}` },
    })
    expect(listed.json<AttendanceDTO[]>()[0]?.entriesUpdated).toBe(1)
  })
})

describe('GET /api/scale/reading', () => {
  it('returns a connected reading from the mock adapter', async () => {
    const token = await setupAdmin()
    const res = await app.inject({
      method: 'GET',
      url: '/api/scale/reading',
      headers: { authorization: `Bearer ${token}` },
    })
    expect(res.statusCode).toBe(200)
    const body = res.json<{ connected: boolean; reading: { weightKg: number; timestamp: string } | null }>()
    expect(body.connected).toBe(true)
    expect(body.reading?.weightKg).toBeGreaterThan(0)
  })

  it('RBAC: requires weigh_in_operator+', async () => {
    const token = await setupAdmin()
    const athleteToken = await createUserAndLogin(token, 'athlete', 'athlete2@test.com')
    const res = await app.inject({
      method: 'GET',
      url: '/api/scale/reading',
      headers: { authorization: `Bearer ${athleteToken}` },
    })
    expect(res.statusCode).toBe(403)
  })
})
