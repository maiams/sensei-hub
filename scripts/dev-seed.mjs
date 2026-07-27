import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import process from 'node:process'

// ---------------------------------------------------------------------------
// Seed de DESENVOLVIMENTO para o Sensei Arena.
//
// O banco de dev roda em MongoMemoryReplSet (scripts/dev-run.mjs): cada
// restart do servidor apaga tudo. Este script fala com a API REST do
// servidor Arena já em execução (não toca no Mongo diretamente) e deixa o
// ambiente pronto para trabalhar:
//
//   1. Setup inicial (academia + admin), se ainda não foi feito.
//   2. Login como admin.
//   3. Carrega o preset de divisões FPJ (idempotente).
//   4. Cria um evento de exemplo (se ainda não existir) e importa as
//      divisões do preset para dentro dele.
//   5. Importa os 52 atletas de teste de scripts/seed-data/atletas-campeonato.xlsx
//      (se o evento ainda não tiver nenhuma inscrição).
//
// Uso:
//   pnpm dev:seed
//   pnpm dev:seed --no-event      (só academia/admin + preset FPJ, sem evento de exemplo)
//   pnpm dev:seed --api-base=http://localhost:3001/api
//
// Protecao: só roda contra localhost/127.0.0.1 por padrao. Para apontar para
// outro host e preciso passar --allow-remote explicitamente — isso e
// deliberado, para nao ser possivel rodar este seed contra uma base real por
// engano (ele cria usuario admin com senha conhecida e reimporta dados de
// teste).
// ---------------------------------------------------------------------------

const DEV_ACADEMY_NAME = 'Academia Dev (seed)'
const DEV_ADMIN_NAME = 'Admin Dev'
const DEV_ADMIN_EMAIL = 'maiams@msn.com'
const DEV_ADMIN_PASSWORD = 'akira12ms'
const SEED_EVENT_NAME = 'Copa Dev (seed)'
const SEED_EVENT_DATE = '2026-08-15'

const args = process.argv.slice(2)
const flag = (name) => args.includes(`--${name}`)
const option = (name, fallback) => {
  const prefix = `--${name}=`
  const found = args.find((a) => a.startsWith(prefix))
  return found ? found.slice(prefix.length) : fallback
}

const apiBase = option('api-base', 'http://localhost:3001/api')
const withEvent = !flag('no-event')
const allowRemote = flag('allow-remote')

function log(message) {
  console.log(`[dev:seed] ${message}`)
}

function assertLocalTarget(base) {
  const url = new URL(base)
  const isLocal = url.hostname === 'localhost' || url.hostname === '127.0.0.1'
  if (!isLocal && !allowRemote) {
    console.error(
      `[dev:seed] Recusando rodar: --api-base aponta para "${url.hostname}", que nao parece ` +
        'ser um ambiente local de desenvolvimento. Este script cria um usuario admin com senha ' +
        'conhecida e reimporta dados de teste — nao deve rodar contra uma base real.\n' +
        '[dev:seed] Se voce tem certeza (ex.: um ambiente de staging efemero seu), rode de novo com --allow-remote.',
    )
    process.exit(1)
  }
}

async function api(path, { method = 'GET', token, body, isForm = false } = {}) {
  const headers = {}
  if (token) headers['Authorization'] = `Bearer ${token}`
  if (body !== undefined && !isForm) headers['Content-Type'] = 'application/json'

  const response = await fetch(`${apiBase}${path}`, {
    method,
    headers,
    body: isForm ? body : body !== undefined ? JSON.stringify(body) : undefined,
  })

  let data = null
  const text = await response.text()
  if (text.length > 0) {
    try {
      data = JSON.parse(text)
    } catch {
      data = text
    }
  }

  return { ok: response.ok, status: response.status, data }
}

async function ensureSetup() {
  const status = await api('/setup/status')
  if (!status.ok) {
    throw new Error(`Falha ao consultar /setup/status: ${status.status} ${JSON.stringify(status.data)}`)
  }

  if (status.data.setupRequired) {
    log(`Nenhuma academia encontrada — criando "${DEV_ACADEMY_NAME}" com admin ${DEV_ADMIN_EMAIL}...`)
    const setup = await api('/setup', {
      method: 'POST',
      body: {
        academyName: DEV_ACADEMY_NAME,
        adminName: DEV_ADMIN_NAME,
        adminEmail: DEV_ADMIN_EMAIL,
        adminPassword: DEV_ADMIN_PASSWORD,
      },
    })
    if (!setup.ok) {
      throw new Error(`Falha no setup inicial: ${setup.status} ${JSON.stringify(setup.data)}`)
    }
    log('Setup inicial concluido.')
  } else {
    log('Setup ja tinha sido feito antes — reaproveitando a academia existente.')
  }
}

async function login() {
  const result = await api('/auth/login', {
    method: 'POST',
    body: { email: DEV_ADMIN_EMAIL, password: DEV_ADMIN_PASSWORD },
  })
  if (!result.ok) {
    throw new Error(
      `Login falhou para ${DEV_ADMIN_EMAIL} (${result.status}). Se a academia ja existia com outra ` +
        'senha de admin, ajuste DEV_ADMIN_EMAIL/DEV_ADMIN_PASSWORD no topo deste script ou faca login ' +
        'manualmente e rode o resto do seed a mao.',
    )
  }
  log(`Login ok como ${DEV_ADMIN_EMAIL} (role: ${result.data.user.role}).`)
  return result.data.accessToken
}

async function loadFpjPreset(token) {
  const result = await api('/division-templates/load-preset', { method: 'POST', token })
  if (!result.ok) {
    throw new Error(`Falha ao carregar preset FPJ: ${result.status} ${JSON.stringify(result.data)}`)
  }
  if (result.data.length === 0) {
    log('Preset FPJ ja estava carregado (idempotente — nada criado agora).')
  } else {
    log(`Preset FPJ carregado: ${result.data.length} categorias criadas.`)
  }
}

async function findSeedEvent(token) {
  const result = await api('/events', { token })
  if (!result.ok) {
    throw new Error(`Falha ao listar eventos: ${result.status} ${JSON.stringify(result.data)}`)
  }
  return result.data.find((e) => e.name === SEED_EVENT_NAME) ?? null
}

async function ensureSeedEvent(token) {
  const existing = await findSeedEvent(token)
  if (existing) {
    log(`Evento de exemplo "${SEED_EVENT_NAME}" ja existe (id ${existing.id ?? existing._id}) — reaproveitando.`)
    return existing.id ?? existing._id
  }

  log(`Criando evento de exemplo "${SEED_EVENT_NAME}"...`)
  const created = await api('/events', {
    method: 'POST',
    token,
    body: { name: SEED_EVENT_NAME, eventDate: SEED_EVENT_DATE, venue: 'Ginasio Municipal (seed)' },
  })
  if (!created.ok) {
    throw new Error(`Falha ao criar evento de exemplo: ${created.status} ${JSON.stringify(created.data)}`)
  }
  const id = created.data.id ?? created.data._id
  log(`Evento criado (id ${id}).`)
  return id
}

async function ensureEventDivisions(token, eventId) {
  const existing = await api(`/events/${eventId}/divisions`, { token })
  if (!existing.ok) {
    throw new Error(`Falha ao listar divisoes do evento: ${existing.status} ${JSON.stringify(existing.data)}`)
  }
  if (existing.data.length > 0) {
    log(`Evento ja tem ${existing.data.length} divisoes — nao reimportando (evitaria duplicar).`)
    return
  }

  log('Importando divisoes do preset FPJ para dentro do evento...')
  const imported = await api(`/events/${eventId}/divisions/import-from-templates`, {
    method: 'POST',
    token,
    body: {},
  })
  if (!imported.ok) {
    throw new Error(`Falha ao importar divisoes para o evento: ${imported.status} ${JSON.stringify(imported.data)}`)
  }
  log(`${imported.data.length} divisoes criadas no evento.`)
}

async function ensureAthletesImported(token, eventId) {
  const entries = await api(`/events/${eventId}/entries`, { token })
  if (!entries.ok) {
    throw new Error(`Falha ao listar inscricoes do evento: ${entries.status} ${JSON.stringify(entries.data)}`)
  }
  if (entries.data.length > 0) {
    log(`Evento ja tem ${entries.data.length} inscricoes — nao reimportando a planilha.`)
    return
  }

  const xlsxPath = fileURLToPath(new URL('./seed-data/atletas-campeonato.xlsx', import.meta.url))
  log(`Importando atletas de ${xlsxPath}...`)
  const buffer = await readFile(xlsxPath)
  const form = new FormData()
  form.append('file', new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), 'atletas-campeonato.xlsx')

  const result = await api(`/events/${eventId}/import`, { method: 'POST', token, body: form, isForm: true })
  if (!result.ok) {
    throw new Error(`Falha ao importar planilha de atletas: ${result.status} ${JSON.stringify(result.data)}`)
  }
  log(
    `Importacao concluida: ${result.data.successCount} atletas importados, ${result.data.errorCount} erros ` +
      `(de ${result.data.totalRows} linhas).`,
  )
  if (result.data.errorCount > 0) {
    log(`Detalhe dos erros: ${JSON.stringify(result.data.errors)}`)
  }
}

async function main() {
  assertLocalTarget(apiBase)
  log(`Alvo: ${apiBase}`)

  await ensureSetup()
  const token = await login()
  await loadFpjPreset(token)

  if (withEvent) {
    const eventId = await ensureSeedEvent(token)
    await ensureEventDivisions(token, eventId)
    await ensureAthletesImported(token, eventId)
  } else {
    log('--no-event: pulando criacao de evento de exemplo e importacao de atletas.')
  }

  log('Seed de desenvolvimento concluido.')
  log(`Login: ${DEV_ADMIN_EMAIL} / ${DEV_ADMIN_PASSWORD}`)
}

main().catch((error) => {
  console.error(`[dev:seed] ERRO: ${error.message}`)
  process.exit(1)
})
