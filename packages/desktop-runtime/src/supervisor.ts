import { ChildProcess, spawn } from 'child_process'
import * as http from 'http'
import { MongoClient } from 'mongodb'

const HEALTH_INTERVAL_MS = 5_000
const HEALTH_FAIL_THRESHOLD = 3
const RESTART_DELAY_MS = 2_000

// This machine's declared role (see machineRole.ts — chosen once, by a
// human, at setup time; never inferred or elected). Determines what
// Supervisor spawns:
//   - standalone: mongod (localhost-only) + server + web. Unchanged from
//     before this redesign — the default for a single-computer academy.
//   - master: mongod (LAN-reachable) + server + web. The server's own
//     ClusterManager self-initiates the replica set (see
//     apps/arena/server/src/cluster/ClusterManager.ts) — Supervisor
//     deliberately does NOT call rs.initiate() for this role.
//   - backup: mongod (LAN-reachable) + server + web. Nothing initiates or
//     joins anything here — this mongod just sits and waits for the
//     master's own management screen to add it to the replica set.
//   - station: NO mongod at all — just server + web, with the server's
//     MONGODB_URI pointing at the master/backup pair over the LAN (see
//     SupervisorConfig.mongodbUri's doc comment). This is the fix for
//     "toda máquina sobe seu próprio mongod" being dead weight on a weak
//     area notebook — a station's Fastify app runs, but MongoDB itself
//     does not.
export type MachineRole = 'standalone' | 'master' | 'backup' | 'station'

export interface SupervisorConfig {
  role?: MachineRole // default 'standalone'
  /** Network interface mongod binds to. '127.0.0.1' for standalone/dev;
   *  '0.0.0.0' for master/backup so the LAN can reach them. Irrelevant for
   *  role: 'station' (no mongod is spawned at all). */
  bindIp?: string
  serverPort?: number
  /** Port the local mongod listens on. Distinct per product so the two
   *  Sensei Hub apps can run side by side on one machine (dojo 27117,
   *  arena 27017). Irrelevant for role: 'station'. */
  mongoPort?: number
  /**
   * The connection string the SERVER process gets as MONGODB_URI.
   * - standalone/master/backup: defaults to the local mongod
   *   (`mongodb://127.0.0.1:<mongoPort>/...?replicaSet=<name>`) — a
   *   backup's own mongod only becomes a real member once the master's
   *   declareBackup() adds it, but the same connection string keeps
   *   retrying via the driver's normal server-selection backoff until then.
   * - station: there is no local mongod to default to. The caller MUST
   *   supply this explicitly — built from whatever LAN address(es) the
   *   operator entered once at station setup (see machineRole.ts). Omitting
   *   it for role: 'station' is a configuration error, not a silent
   *   fallback to localhost (which would be actively wrong).
   */
  mongodbUri?: string
  jwtSecret?: string
  /** Extra env vars forwarded to the spawned server process — used for
   *  CLUSTER_ROLE, CLUSTER_REPLICA_SET_NAME, CLUSTER_MONGO_PORT,
   *  CLUSTER_ADVERTISE_HOST (see apps/arena/server/src/config/env.ts). */
  clusterEnv?: Record<string, string>
  replicaSetName?: string
  /**
   * Path to the Next.js standalone server.js (apps/<product>/web, output:
   * 'standalone'). Null in dev — the web UI is assumed to already be
   * running externally (e.g. `next dev`, as `scripts/dev-run.mjs` does).
   * When set, Supervisor spawns it as a third process and gates
   * onWebReady on its own TCP health check, instead of firing it
   * immediately.
   */
  webScript?: string | null
  webPort?: number
}

export interface SupervisorEvents {
  onMongoReady: () => void
  onServerReady: () => void
  onWebReady: () => void
  onServerDied: (restartCount: number) => void
  onMongoDied: () => void
}

export class Supervisor {
  private mongoProcess: ChildProcess | null = null
  private serverProcess: ChildProcess | null = null
  private webProcess: ChildProcess | null = null
  private healthTimer: NodeJS.Timeout | null = null
  private consecutiveFails = 0
  private serverRestartCount = 0
  private stopping = false
  private isRestarting = false  // prevents concurrent restartServer() calls

  private readonly role: MachineRole
  private readonly bindIp: string
  private readonly serverPort: number
  private readonly mongoPort: number
  private readonly mongodbUri: string
  private readonly jwtSecret: string
  private readonly clusterEnv: Record<string, string>
  private readonly replicaSetName: string
  private readonly webScript: string | null
  private readonly webPort: number

  constructor(
    private readonly mongoBin: string,
    private readonly mongoDataDir: string,
    private readonly serverScript: string,
    private readonly events: SupervisorEvents,
    config: SupervisorConfig = {},
  ) {
    this.role = config.role ?? 'standalone'
    this.bindIp = config.bindIp ?? '127.0.0.1'
    this.serverPort = config.serverPort ?? 3001
    this.mongoPort = config.mongoPort ?? 27017
    this.replicaSetName = config.replicaSetName ?? 'sensei-rs'
    if (this.role === 'station' && !config.mongodbUri) {
      throw new Error(
        "Supervisor: role 'station' requires an explicit mongodbUri pointing at the master/backup pair — there is no local mongod to default to.",
      )
    }
    this.mongodbUri = config.mongodbUri ?? `mongodb://127.0.0.1:${this.mongoPort}/senseihub?replicaSet=${this.replicaSetName}`
    this.jwtSecret = config.jwtSecret ?? 'dev-secret-change-in-production-min-32-chars'
    this.clusterEnv = config.clusterEnv ?? {}
    this.webScript = config.webScript ?? null
    this.webPort = config.webPort ?? 3000
  }

  async start(): Promise<void> {
    if (this.role === 'station') {
      // No local mongod — the server connects straight to the remote
      // master/backup pair via this.mongodbUri (see its doc comment).
      this.events.onMongoReady()
    } else {
      this.startMongo()
      await this.waitForMongoPort()
      if (this.role === 'standalone') {
        await this.initReplicaSetIfNeeded()
      }
      // master/backup: mongod is up but deliberately left un-initiated/
      // un-added here — that decision belongs entirely to the server
      // process's ClusterManager (master self-initiates; backup waits to
      // be added by the master's own management screen).
      this.events.onMongoReady()
    }
    await this.startServer()
    // Master/backup/station all get real headroom: a backup's server may
    // need to keep retrying its Mongo connection until the master declares
    // it (see mongodbUri's doc comment), and a station's remote connection
    // over LAN can reasonably take a little longer than localhost.
    await this.waitForServer(this.role !== 'standalone' ? 90_000 : 30_000)
    this.events.onServerReady()
    if (this.webScript) {
      this.startWeb()
      await this.waitForWeb()
    }
    // Fires even without a spawned web process (dev: web runs externally,
    // e.g. `next dev`) — the caller uses this as the single "safe to
    // loadURL now" signal regardless of how the web server got there.
    this.events.onWebReady()
    this.startHealthLoop()
  }

  async stop(): Promise<void> {
    this.stopping = true
    if (this.healthTimer) clearInterval(this.healthTimer)

    await this.httpPost(`http://127.0.0.1:${this.serverPort}/api/shutdown-prep`).catch(() => null)

    // Sequenced, not parallel: waitForExit already caps itself at 5s, so
    // this doesn't meaningfully slow down the standalone/station case where
    // the server exits almost immediately.
    this.webProcess?.kill('SIGTERM')
    await this.waitForExit(this.webProcess)

    this.serverProcess?.kill('SIGTERM')
    await this.waitForExit(this.serverProcess)

    this.mongoProcess?.kill('SIGTERM')
    await this.waitForExit(this.mongoProcess)
  }

  private startMongo(): void {
    const args = [
      '--replSet', this.replicaSetName,
      '--dbpath', this.mongoDataDir,
      '--bind_ip', this.bindIp,
      '--port', String(this.mongoPort),
      '--wiredTigerCacheSizeGB', '0.5',
    ]

    this.mongoProcess = spawn(this.mongoBin, args, { stdio: 'pipe' })
    this.mongoProcess.on('exit', (code) => {
      if (!this.stopping) {
        console.error(`[supervisor] mongod exited with code ${code}`)
        this.events.onMongoDied()
      }
    })
  }

  private async waitForMongoPort(timeoutMs = 30_000): Promise<void> {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      if (await this.checkTcpPort('127.0.0.1', this.mongoPort)) return
      await sleep(500)
    }
    throw new Error('MongoDB did not start within 30s')
  }

  /**
   * Standalone role only. Connects directly (no replicaSet param) and
   * initiates the RS if not yet done. Safe to call multiple times —
   * idempotent. Master/backup roles never call this — see start()'s doc
   * comment for why that decision moved entirely to the server process.
   */
  private async initReplicaSetIfNeeded(timeoutMs = 15_000): Promise<void> {
    const client = new MongoClient(`mongodb://127.0.0.1:${this.mongoPort}`, {
      directConnection: true,
      serverSelectionTimeoutMS: timeoutMs,
    })
    try {
      await client.connect()
      const admin = client.db('admin')

      let alreadyInitiated = false
      try {
        await admin.command({ replSetGetStatus: 1 })
        alreadyInitiated = true
      } catch (err: unknown) {
        const code = (err as { codeName?: string }).codeName
        if (code !== 'NotYetInitialized') throw err
      }

      if (!alreadyInitiated) {
        await admin.command({
          replSetInitiate: {
            _id: this.replicaSetName,
            members: [{ _id: 0, host: `127.0.0.1:${this.mongoPort}`, priority: 1 }],
          },
        })
        console.log('[supervisor] replica set initiated')
        await this.waitForPrimary(admin, timeoutMs)
      }
    } finally {
      await client.close()
    }
  }

  private async waitForPrimary(admin: import('mongodb').Db, timeoutMs: number): Promise<void> {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      const hello = await admin.command({ hello: 1 })
      if (hello.isWritablePrimary) return
      await sleep(500)
    }
    throw new Error('MongoDB did not elect a primary within timeout')
  }

  private async startServer(): Promise<void> {
    this.serverProcess = spawn(process.execPath, [this.serverScript], {
      stdio: 'pipe',
      env: {
        ...process.env,
        // process.execPath in a packaged app IS the Electron binary, not a
        // plain node binary — without this it tries to launch serverScript
        // as another Electron app instead of running it as a Node script.
        ELECTRON_RUN_AS_NODE: '1',
        NODE_ENV: 'production',
        PORT: String(this.serverPort),
        MONGODB_URI: this.mongodbUri,
        JWT_SECRET: this.jwtSecret,
        ...(this.role !== 'standalone' ? this.clusterEnv : {}),
      },
    })
    forwardOutput('server', this.serverProcess)
    this.serverProcess.on('exit', (code) => {
      if (!this.stopping) {
        console.error(`[supervisor] server exited with code ${code}`)
        this.scheduleServerRestart()
      }
    })
  }

  private async waitForServer(timeoutMs = 30_000): Promise<void> {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      if (await this.pingHealth()) return
      await sleep(500)
    }
    throw new Error('Server did not become healthy within 30s')
  }

  // Spawns the Next.js standalone server.js (apps/<product>/web, output:
  // 'standalone'). It talks to the Fastify API through its own baked-in
  // rewrite (next.config.ts: /api/* -> http://localhost:<serverPort>), so
  // no extra wiring is needed here beyond the port it listens on itself —
  // including for role: 'station', where "http://localhost:<serverPort>"
  // is this SAME machine's own local Fastify server (which then talks to
  // the remote master/backup pair itself, see mongodbUri's doc comment).
  private startWeb(): void {
    this.webProcess = spawn(process.execPath, [this.webScript as string], {
      stdio: 'pipe',
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: '1', // see startServer() — same reasoning
        NODE_ENV: 'production',
        PORT: String(this.webPort),
        HOSTNAME: '127.0.0.1',
      },
    })
    forwardOutput('web', this.webProcess)
    this.webProcess.on('exit', (code) => {
      if (!this.stopping) console.error(`[supervisor] web exited with code ${code}`)
    })
  }

  private async waitForWeb(timeoutMs = 30_000): Promise<void> {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      if (await this.checkTcpPort('127.0.0.1', this.webPort)) return
      await sleep(500)
    }
    throw new Error('Web (Next.js) did not start within 30s')
  }

  private startHealthLoop(): void {
    this.healthTimer = setInterval(async () => {
      const ok = await this.pingHealth()
      if (ok) {
        this.consecutiveFails = 0
      } else {
        this.consecutiveFails++
        if (this.consecutiveFails >= HEALTH_FAIL_THRESHOLD) {
          console.warn('[supervisor] health check failed 3 times, restarting server')
          this.scheduleServerRestart()
        }
      }
    }, HEALTH_INTERVAL_MS)
  }

  /** Idempotent: only one restart can run at a time. */
  private scheduleServerRestart(): void {
    if (this.stopping || this.isRestarting) return
    this.isRestarting = true
    this.consecutiveFails = 0

    void this.doRestartServer().finally(() => {
      this.isRestarting = false
    })
  }

  private async doRestartServer(): Promise<void> {
    this.serverProcess?.kill('SIGTERM')
    await sleep(RESTART_DELAY_MS)
    this.serverRestartCount++
    await this.startServer()
    await this.waitForServer()
    this.events.onServerDied(this.serverRestartCount)
  }

  private pingHealth(): Promise<boolean> {
    return new Promise((resolve) => {
      const req = http.get(
        `http://127.0.0.1:${this.serverPort}/api/health`,
        { timeout: 3000 },
        (res) => {
          resolve(res.statusCode === 200)
          res.resume()
        },
      )
      req.on('error', () => resolve(false))
      req.on('timeout', () => { req.destroy(); resolve(false) })
    })
  }

  private httpPost(url: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const req = http.request(url, { method: 'POST', timeout: 5000 }, (res) => {
        res.resume()
        resolve()
      })
      req.on('error', reject)
      req.end()
    })
  }

  private checkTcpPort(host: string, port: number): Promise<boolean> {
    return new Promise((resolve) => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const net = require('net') as typeof import('net')
      const socket = new net.Socket()
      socket.setTimeout(500)
      socket.on('connect', () => { socket.destroy(); resolve(true) })
      socket.on('error', () => resolve(false))
      socket.on('timeout', () => { socket.destroy(); resolve(false) })
      socket.connect(port, host)
    })
  }

  private waitForExit(proc: ChildProcess | null): Promise<void> {
    if (!proc) return Promise.resolve()
    return new Promise((resolve) => {
      proc.on('exit', resolve)
      setTimeout(resolve, 5000)
    })
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// stdio:'pipe' output is otherwise silently discarded — with nothing ever
// reading the pipes, a crash before the process manages to write anything
// meaningful is invisible, which cost real debugging time while building
// the packaging pipeline. Only used for server/web (our own app logs);
// mongod's own log is high-volume and not meant for this console.
function forwardOutput(label: string, proc: ChildProcess): void {
  proc.stdout?.on('data', (chunk: Buffer) => {
    for (const line of chunk.toString('utf8').split('\n')) {
      if (line.trim()) console.log(`[${label}] ${line}`)
    }
  })
  proc.stderr?.on('data', (chunk: Buffer) => {
    for (const line of chunk.toString('utf8').split('\n')) {
      if (line.trim()) console.error(`[${label}] ${line}`)
    }
  })
}
