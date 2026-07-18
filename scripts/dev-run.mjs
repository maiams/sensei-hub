import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import process from 'node:process'

const SUPPORTED_PLATFORM = 'darwin'
const SHUTDOWN_TIMEOUT_MS = 5_000

if (process.platform !== SUPPORTED_PLATFORM) {
  console.error(
    `[dev:run] Sistema operacional ainda nao suportado: ${process.platform}. ` +
      'Por enquanto, este comando funciona apenas no macOS.',
  )
  process.exit(1)
}

// Qual produto subir: `pnpm dev:run [dojo|arena]` (default: arena).
const product = process.argv[2] === 'dojo' ? 'dojo' : 'arena'
const serverFilter = product === 'dojo' ? '@dojo/server' : '@arena/server'
const webFilter = product === 'dojo' ? '@dojo/web' : '@arena/web'
const webPort = product === 'dojo' ? 3100 : 3000

const requireFromServer = createRequire(
  new URL(`../apps/${product}/server/package.json`, import.meta.url),
)
const { MongoMemoryReplSet } = requireFromServer('mongodb-memory-server')

let replicaSet
let shuttingDown = false
const children = new Map()

function waitForExit(child) {
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve()
  }

  return new Promise((resolve) => child.once('exit', resolve))
}

function killProcessGroup(child, signal) {
  if (child.pid === undefined) return

  try {
    process.kill(-child.pid, signal)
  } catch (error) {
    if (error.code !== 'ESRCH') {
      console.error(`[dev:run] Falha ao encerrar ${child.spawnargs.join(' ')}:`, error)
    }
  }
}

async function stopChildProcesses() {
  const runningChildren = [...children.values()]
  runningChildren.forEach((child) => killProcessGroup(child, 'SIGTERM'))

  const allExited = Promise.all(runningChildren.map(waitForExit))
  const timedOut = new Promise((resolve) =>
    setTimeout(() => resolve('timeout'), SHUTDOWN_TIMEOUT_MS),
  )

  if ((await Promise.race([allExited, timedOut])) === 'timeout') {
    runningChildren.forEach((child) => killProcessGroup(child, 'SIGKILL'))
    await Promise.all(runningChildren.map(waitForExit))
  }
}

async function shutdown(exitCode = 0) {
  if (shuttingDown) return
  shuttingDown = true

  console.log('\n[dev:run] Encerrando web, servidor e MongoDB...')
  await stopChildProcesses()

  if (replicaSet !== undefined) {
    await replicaSet.stop()
  }

  process.exit(exitCode)
}

function startPackage(name, filter, environment = {}) {
  const child = spawn('pnpm', ['--filter', filter, 'dev'], {
    cwd: new URL('..', import.meta.url),
    detached: true,
    env: { ...process.env, ...environment },
    stdio: 'inherit',
  })

  children.set(name, child)

  child.once('error', (error) => {
    console.error(`[dev:run] Nao foi possivel iniciar ${name}:`, error)
    void shutdown(1)
  })

  child.once('exit', (code, signal) => {
    if (!shuttingDown) {
      console.error(
        `[dev:run] ${name} encerrou inesperadamente (${signal ?? `codigo ${code}`}).`,
      )
      void shutdown(code ?? 1)
    }
  })
}

for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.once(signal, () => void shutdown())
}

try {
  console.log('[dev:run] Iniciando MongoDB efemero em replica set...')
  replicaSet = await MongoMemoryReplSet.create({
    replSet: { count: 1, storageEngine: 'wiredTiger' },
  })

  const mongodbUri = replicaSet.getUri('senseihub-dev')
  console.log(`[dev:run] MongoDB pronto: ${mongodbUri}`)

  startPackage('servidor', serverFilter, { MONGODB_URI: mongodbUri })
  startPackage('web', webFilter)

  console.log(`[dev:run] ${product} iniciando em http://localhost:${webPort}`)
  console.log('[dev:run] Use Ctrl+C para encerrar tudo.')
} catch (error) {
  console.error('[dev:run] Falha ao iniciar a aplicacao:', error)
  await shutdown(1)
}
