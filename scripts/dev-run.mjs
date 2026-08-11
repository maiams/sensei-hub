import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import process from 'node:process'

const SHUTDOWN_TIMEOUT_MS = 5_000

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
    if (process.platform === 'win32') {
      child.kill(signal)
    } else {
      process.kill(-child.pid, signal)
    }
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

function processIsRunning(child) {
  if (child?.pid === undefined) return false
  if (child.exitCode !== null || child.signalCode !== null) return false

  try {
    process.kill(child.pid, 0)
    return true
  } catch (error) {
    if (error.code === 'ESRCH') return false
    return true
  }
}

function clearExitedMongodReferences() {
  for (const server of replicaSet.servers) {
    const instance = server.instanceInfo?.instance
    if (instance?.mongodProcess && !processIsRunning(instance.mongodProcess)) {
      instance.mongodProcess = undefined
    }
  }
}

async function stopReplicaSet() {
  if (replicaSet === undefined) return

  // A process can still disappear outside the runner (for example, after an
  // interrupted startup). mongodb-memory-server 11 keeps that stale reference
  // and rejects cleanup, so discard only a ChildProcess known to have exited.
  clearExitedMongodReferences()

  await replicaSet.stop({ doCleanup: false })
  clearExitedMongodReferences()
  await replicaSet.cleanup({ doCleanup: true, force: false })
}

async function shutdown(exitCode = 0) {
  if (shuttingDown) return
  shuttingDown = true

  console.log('\n[dev:run] Encerrando web, servidor e MongoDB...')
  let finalExitCode = exitCode

  try {
    await stopChildProcesses()
  } catch (error) {
    console.error('[dev:run] Falha ao encerrar os processos da aplicacao:', error)
    finalExitCode = 1
  }

  try {
    await stopReplicaSet()
  } catch (error) {
    console.error('[dev:run] Falha ao encerrar o MongoDB efemero:', error)
    finalExitCode = 1
  }

  process.exit(finalExitCode)
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
    // Keep mongod out of this runner's foreground process group. Ctrl+C then
    // reaches only the runner, which lets mongodb-memory-server perform its
    // graceful shutdown instead of racing an already-signalled mongod.
    replSet: { count: 1, storageEngine: 'wiredTiger', spawn: { detached: true } },
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
