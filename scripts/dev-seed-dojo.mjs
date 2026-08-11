import process from 'node:process'

const API = process.env.DOJO_API_BASE ?? 'http://127.0.0.1:3101/api'
const PASSWORD = 'sensei123'
const credentials = {
  admin: { name: 'Admin Demo', email: 'admin@dojo.demo', role: 'academy_admin' },
  coach: { name: 'Sensei Demo', email: 'sensei@dojo.demo', role: 'coach' },
  athlete: { name: 'Aluno Demo', email: 'aluno@dojo.demo', role: 'athlete' },
}

function assertLocalTarget() {
  const host = new URL(API).hostname
  if (host !== '127.0.0.1' && host !== 'localhost') throw new Error('O seed só pode apontar para localhost.')
}

async function api(path, { method = 'GET', token, body } = {}) {
  const response = await fetch(`${API}${path}`, {
    method,
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await response.text()
  const data = text ? JSON.parse(text) : undefined
  return { ok: response.ok, status: response.status, data }
}

async function login(email) {
  const result = await api('/auth/login', { method: 'POST', body: { email, password: PASSWORD } })
  if (!result.ok) throw new Error(`Login ${email} falhou (${result.status}). Use um banco de desenvolvimento limpo.`)
  return result.data
}

async function ensureUser(adminToken, user) {
  const created = await api('/users', { method: 'POST', token: adminToken, body: { ...user, password: PASSWORD } })
  if (!created.ok && created.status !== 409) throw new Error(`Criação de ${user.email} falhou: ${created.status}`)
  return login(user.email)
}

async function main() {
  assertLocalTarget()
  const setupStatus = await api('/setup/status')
  if (!setupStatus.ok) throw new Error(`Servidor indisponível em ${API}`)
  if (setupStatus.data.setupRequired) {
    const setup = await api('/setup', { method: 'POST', body: { academyName: 'Sensei Dojô Demo', adminName: credentials.admin.name, adminEmail: credentials.admin.email, adminPassword: PASSWORD } })
    if (!setup.ok) throw new Error(`Setup falhou: ${setup.status}`)
  }
  const admin = await login(credentials.admin.email)
  const coach = await ensureUser(admin.accessToken, credentials.coach)
  const athleteUser = await ensureUser(admin.accessToken, credentials.athlete)

  let athleteId
  const existingAthletes = await api('/athletes?q=Aluno%20Demo', { token: admin.accessToken })
  athleteId = existingAthletes.data?.items?.find((a) => a.userId === athleteUser.user.id)?.id
  if (!athleteId) {
    const athlete = await api('/athletes', { method: 'POST', token: admin.accessToken, body: {
      userId: athleteUser.user.id, fullName: 'Aluno Demo', gender: 'not_informed', birthDate: '1995-01-01',
      currentBelt: 'white', termsAccepted: true, imageAuthorizationAccepted: false,
    } })
    if (!athlete.ok) throw new Error(`Criação do atleta falhou: ${athlete.status} ${JSON.stringify(athlete.data)}`)
    athleteId = athlete.data.id
  }

  const classes = await api('/classes', { token: admin.accessToken })
  let trainingClass = classes.data.find((item) => item.name === 'Turma Demo')
  if (!trainingClass) {
    const created = await api('/classes', { method: 'POST', token: admin.accessToken, body: { name: 'Turma Demo', description: 'Turma criada pelo seed de presença' } })
    if (!created.ok) throw new Error(`Criação da turma falhou: ${created.status}`)
    trainingClass = created.data
  }
  const enrollment = await api(`/classes/${trainingClass.id}/enrollments`, { method: 'POST', token: admin.accessToken, body: { athleteId } })
  if (!enrollment.ok && enrollment.status !== 409) throw new Error(`Matrícula falhou: ${enrollment.status}`)

  const startsAt = new Date(Date.now() + 10 * 60_000)
  const endsAt = new Date(startsAt.getTime() + 60 * 60_000)
  const lesson = await api('/lessons', { method: 'POST', token: admin.accessToken, body: { classId: trainingClass.id, coachId: coach.user.id, startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString() } })
  if (!lesson.ok) throw new Error(`Criação da aula falhou: ${lesson.status}`)

  console.log('Demo de presença criada.')
  console.log(`Admin:  ${credentials.admin.email} / ${PASSWORD}`)
  console.log(`Sensei: ${credentials.coach.email} / ${PASSWORD}`)
  console.log(`Aluno:  ${credentials.athlete.email} / ${PASSWORD}`)
  console.log(`Aula: ${lesson.data.startsAt}`)
}

main().catch((err) => { console.error(`[seed:dojo] ${err.message}`); process.exit(1) })
