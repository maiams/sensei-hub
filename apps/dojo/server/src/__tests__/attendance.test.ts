import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { connectTestDb, closeTestDb, clearTestDb } from '@sensei-hub/core-server/testing'
import { buildApp } from '../app.js'
import { LessonModel } from '../repositories/LessonModel.js'
import { AttendanceEventModel } from '../repositories/AttendanceEventModel.js'

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

beforeEach(async () => clearTestDb())

async function setup() {
  const adminEmail = 'admin@presenca.test'
  const password = 'senha12345'
  await app.inject({ method: 'POST', url: '/api/setup', payload: { academyName: 'Dojô Teste', adminName: 'Admin', adminEmail, adminPassword: password } })
  const adminLogin = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: adminEmail, password } })
  const adminToken = adminLogin.json().accessToken as string

  async function user(role: string, email: string) {
    const created = await app.inject({ method: 'POST', url: '/api/users', headers: { authorization: `Bearer ${adminToken}` }, payload: { name: `Usuário ${role}`, email, password, role } })
    expect(created.statusCode).toBe(201)
    const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email, password } })
    return { id: created.json().id as string, token: login.json().accessToken as string }
  }

  const coach = await user('coach', 'coach@presenca.test')
  const athleteUser = await user('athlete', 'aluno@presenca.test')
  const eventManager = await user('event_manager', 'evento@presenca.test')
  const athleteRes = await app.inject({
    method: 'POST', url: '/api/athletes', headers: { authorization: `Bearer ${adminToken}` },
    payload: { userId: athleteUser.id, fullName: 'Aluno Presença', gender: 'not_informed', birthDate: '1990-01-01', currentBelt: 'white', termsAccepted: true, imageAuthorizationAccepted: false },
  })
  expect(athleteRes.statusCode).toBe(201)
  return { adminToken, coach, athleteUser, eventManager, athleteId: athleteRes.json().id as string }
}

async function classAndLesson(adminToken: string, coachId: string, athleteId: string) {
  const classRes = await app.inject({ method: 'POST', url: '/api/classes', headers: { authorization: `Bearer ${adminToken}` }, payload: { name: 'Adulto' } })
  expect(classRes.statusCode).toBe(201)
  const classId = classRes.json().id as string
  const enrollment = await app.inject({ method: 'POST', url: `/api/classes/${classId}/enrollments`, headers: { authorization: `Bearer ${adminToken}` }, payload: { athleteId } })
  expect(enrollment.statusCode).toBe(201)
  const startsAt = new Date(Date.now() + 10 * 60_000)
  const endsAt = new Date(Date.now() + 70 * 60_000)
  const lessonRes = await app.inject({ method: 'POST', url: '/api/lessons', headers: { authorization: `Bearer ${adminToken}` }, payload: { classId, coachId, startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString() } })
  expect(lessonRes.statusCode).toBe(201)
  return { classId, lessonId: lessonRes.json().id as string, lesson: lessonRes.json() }
}

describe('attendance MVP', () => {
  it('materializes lesson windows and roster, then confirms an athlete request', async () => {
    const s = await setup()
    const { lessonId, lesson } = await classAndLesson(s.adminToken, s.coach.id, s.athleteId)
    expect(new Date(lesson.requestOpensAt).getTime()).toBe(new Date(lesson.startsAt).getTime() - 30 * 60_000)
    expect(new Date(lesson.requestClosesAt).getTime()).toBe(new Date(lesson.startsAt).getTime() + 60 * 60_000)
    expect(new Date(lesson.decisionDeadlineAt).getTime()).toBe(new Date(lesson.endsAt).getTime() + 24 * 60 * 60_000)

    const dashboard = await app.inject({ method: 'GET', url: '/api/student/dashboard', headers: { authorization: `Bearer ${s.athleteUser.token}` } })
    expect(dashboard.statusCode).toBe(200)
    expect(dashboard.json().athlete.fullName).toBe('Aluno Presença')

    const requestHeaders = { authorization: `Bearer ${s.athleteUser.token}`, 'idempotency-key': 'request-unique-key-0001' }
    const requested = await app.inject({ method: 'POST', url: `/api/lessons/${lessonId}/attendance-requests`, headers: requestHeaders, payload: {} })
    expect(requested.statusCode).toBe(201)
    expect(requested.json().locationStatus).toBe('unavailable')

    const replay = await app.inject({ method: 'POST', url: `/api/lessons/${lessonId}/attendance-requests`, headers: requestHeaders, payload: {} })
    expect(replay.statusCode).toBe(201)
    expect(replay.json().id).toBe(requested.json().id)

    const duplicate = await app.inject({ method: 'POST', url: `/api/lessons/${lessonId}/attendance-requests`, headers: { authorization: `Bearer ${s.athleteUser.token}` }, payload: {} })
    expect(duplicate.statusCode).toBe(409)

    const confirmHeaders = { authorization: `Bearer ${s.coach.token}`, 'idempotency-key': 'confirm-unique-key-0001' }
    const confirmed = await app.inject({ method: 'POST', url: `/api/attendance-requests/${requested.json().id}/confirm`, headers: confirmHeaders })
    expect(confirmed.statusCode).toBe(200)
    expect(confirmed.json().status).toBe('confirmed')
    const confirmedReplay = await app.inject({ method: 'POST', url: `/api/attendance-requests/${requested.json().id}/confirm`, headers: confirmHeaders })
    expect(confirmedReplay.statusCode).toBe(200)
    expect(confirmedReplay.json().id).toBe(confirmed.json().id)

    const rollCall = await app.inject({ method: 'GET', url: `/api/lessons/${lessonId}/roll-call`, headers: { authorization: `Bearer ${s.coach.token}` } })
    expect(rollCall.statusCode).toBe(200)
    expect(rollCall.json().items).toHaveLength(1)
    expect(rollCall.json().items[0]).toMatchObject({ athleteName: 'Aluno Presença', result: 'present' })
    expect(await AttendanceEventModel.countDocuments({ lessonId })).toBeGreaterThanOrEqual(3)
  })

  it('uses exact attendance roles and does not admit event_manager by hierarchy', async () => {
    const s = await setup()
    const denied = await app.inject({ method: 'POST', url: '/api/classes', headers: { authorization: `Bearer ${s.eventManager.token}` }, payload: { name: 'Não pode' } })
    expect(denied.statusCode).toBe(403)
  })

  it('rejects with a reason and permits an audited correction in the deadline', async () => {
    const s = await setup()
    const { lessonId } = await classAndLesson(s.adminToken, s.coach.id, s.athleteId)
    const requested = await app.inject({ method: 'POST', url: `/api/lessons/${lessonId}/attendance-requests`, headers: { authorization: `Bearer ${s.athleteUser.token}` }, payload: { location: { status: 'outside', distanceMeters: 850 } } })
    const rejected = await app.inject({ method: 'POST', url: `/api/attendance-requests/${requested.json().id}/reject`, headers: { authorization: `Bearer ${s.coach.token}` }, payload: { reason: 'Aluno não compareceu' } })
    expect(rejected.statusCode).toBe(200)
    expect(rejected.json()).toMatchObject({ status: 'rejected', rejectionReason: 'Aluno não compareceu' })
    const rollCall = await app.inject({ method: 'GET', url: `/api/lessons/${lessonId}/roll-call`, headers: { authorization: `Bearer ${s.coach.token}` } })
    const attendanceId = rollCall.json().items[0].attendanceId as string
    const corrected = await app.inject({ method: 'POST', url: `/api/attendance/${attendanceId}/correct`, headers: { authorization: `Bearer ${s.coach.token}` }, payload: { result: 'present', reason: 'Conferência corrigida' } })
    expect(corrected.statusCode).toBe(200)
    expect(corrected.json()).toMatchObject({ result: 'present', source: 'correction' })
  })

  it('expires pending requests and marks the roster absent after the lesson deadline', async () => {
    const s = await setup()
    const { lessonId } = await classAndLesson(s.adminToken, s.coach.id, s.athleteId)
    const requested = await app.inject({ method: 'POST', url: `/api/lessons/${lessonId}/attendance-requests`, headers: { authorization: `Bearer ${s.athleteUser.token}` }, payload: {} })
    expect(requested.statusCode).toBe(201)
    await LessonModel.updateOne({ _id: lessonId }, { $set: { decisionDeadlineAt: new Date(Date.now() - 1000) } })
    const rollCall = await app.inject({ method: 'GET', url: `/api/lessons/${lessonId}/roll-call`, headers: { authorization: `Bearer ${s.coach.token}` } })
    expect(rollCall.statusCode).toBe(200)
    expect(rollCall.json().lesson.status).toBe('closed')
    expect(rollCall.json().items[0]).toMatchObject({ result: 'absent', request: { status: 'expired' } })
  })
})
