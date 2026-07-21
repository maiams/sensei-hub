import { ChildProcess, spawn } from 'child_process'
import * as http from 'http'
import { networkInterfaces } from 'node:os'
import { MongoClient } from 'mongodb'

const HEALTH_INTERVAL_MS = 5_000
const HEALTH_FAIL_THRESHOLD = 3
const RESTART_DELAY_MS = 2_000

export interface SupervisorConfig {
  /** Network interface mongod binds to. '127.0.0.1' for single-node dev; '0.0.0.0' for cluster. */
  bindIp?: string
  serverPort?: number
  /** Port the primary mongod listens on. Distinct per product so the two
   *  Sensei Hub apps can run side by side on one machine (dojo 27117,
   *  arena 27017). The arbiter port is derived as mongoPort + 1 by default. */
  mongoPort?: number
  mongodbUri?: string
  jwtSecret?: string
  /**
   * Fase 7. When true: mongod still gets spawned here (bound per `bindIp`,
   * normally '0.0.0.0' in this mode), but Supervisor does NOT call
   * rs.initiate() itself — that decision (found a new replica set vs. join
   * an existing one via mDNS) belongs entirely to the server process's
   * ClusterManager, which needs to run its own discovery *before* anyone
   * touches the replica set config. Extra cluster env vars are forwarded
   * to the spawned server process.
   */
  clusterEnabled?: boolean
  clusterEnv?: Record<string, string>
  /**
   * Fase 7 — N=2 arbiter. Where to put the arbiter-only mongod's dbpath
   * (it stores no real data, but MongoDB still requires a dbpath) and
   * which port it listens on. Only used when clusterEnabled is true.
   */
  arbiterDataDir?: string
  arbiterMongoPort?: number
  replicaSetName?: string
  /**
   * Path to the Next.js standalone server.js (packages/web, output:
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

  private readonly bindIp: string
  private readonly serverPort: number
  private readonly mongoPort: number
  private readonly mongodbUri: string
  private readonly jwtSecret: string
  private readonly clusterEnabled: boolean
  private readonly clusterEnv: Record<string, string>
  private readonly arbiterDataDir: string | undefined
  private readonly arbiterMongoPort: number
  private readonly replicaSetName: string
  private readonly webScript: string | null
  private readonly webPort: number
  private arbiterProcess: ChildProcess | null = null
  private arbiterWatchTimer: NodeJS.Timeout | null = null

  constructor(
    private readonly mongoBin: string,
    private readonly mongoDataDir: string,
    private readonly serverScript: string,
    private readonly events: SupervisorEvents,
    config: SupervisorConfig = {},
  ) {
    this.bindIp = config.bindIp ?? '127.0.0.1'
    this.serverPort = config.serverPort ?? 3001
    this.mongoPort = config.mongoPort ?? 27017
    this.mongodbUri = config.mongodbUri ?? `mongodb://127.0.0.1:${this.mongoPort}/senseihub?replicaSet=sensei-rs`
    this.jwtSecret = config.jwtSecret ?? 'dev-secret-change-in-production-min-32-chars'
    this.clusterEnabled = config.clusterEnabled ?? false
    this.clusterEnv = config.clusterEnv ?? {}
    this.arbiterDataDir = config.arbiterDataDir
    this.arbiterMongoPort = config.arbiterMongoPort ?? this.mongoPort + 1
    this.replicaSetName = config.replicaSetName ?? 'sensei-rs'
    this.webScript = config.webScript ?? null
    this.webPort = config.webPort ?? 3000
  }

  async start(): Promise<void> {
    this.startMongo()
    await this.waitForMongoPort()
    if (!this.clusterEnabled) {
      await this.initReplicaSetIfNeeded()
    }
    // In cluster mode, mongod is up but deliberately left un-initiated —
    // the server's ClusterManager.bootstrap() (mDNS discovery, then
    // rs.initiate() or rs.add()-via-join) runs as the very first thing the
    // spawned server process does, before it even connects with mongoose.
    this.events.onMongoReady()
    await this.startServer()
    // Cluster mode: the server doesn't start listening until its own
    // ClusterManager.bootstrap() finishes (mDNS discovery + rs.initiate/
    // join, up to #waitUntilSelfIsMember's own 30s budget when joining) —
    // give it real headroom instead of the single-node default.
    await this.waitForServer(this.clusterEnabled ? 90_000 : 30_000)
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
    if (this.clusterEnabled && this.arbiterDataDir) {
      this.startArbiterWatcher()
    }
  }

  async stop(): Promise<void> {
    this.stopping = true
    if (this.healthTimer) clearInterval(this.healthTimer)
    if (this.arbiterWatchTimer) clearInterval(this.arbiterWatchTimer)

    await this.httpPost(`http://127.0.0.1:${this.serverPort}/api/shutdown-prep`).catch(() => null)

    // Sequenced, not parallel: the server's own shutdown (in cluster mode,
    // ClusterManager.gracefulLeave() — rs.stepDown/rs.remove against its
    // own mongod) needs mongod alive to finish. waitForExit already caps
    // itself at 5s, so this doesn't meaningfully slow down the non-cluster
    // case where the server exits almost immediately.
    this.webProcess?.kill('SIGTERM')
    await this.waitForExit(this.webProcess)

    this.serverProcess?.kill('SIGTERM')
    await this.waitForExit(this.serverProcess)

    this.mongoProcess?.kill('SIGTERM')
    await this.waitForExit(this.mongoProcess)

    this.arbiterProcess?.kill('SIGTERM')
    await this.waitForExit(this.arbiterProcess)
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
   * Connects directly (no replicaSet param) and initiates the RS if not yet done.
   * Safe to call multiple times — idempotent.
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
        ...(this.clusterEnabled ? { CLUSTER_ENABLED: 'true', ...this.clusterEnv } : {}),
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

  // Spawns the Next.js standalone server.js (packages/web, output:
  // 'standalone'). It talks to the Fastify API through its own baked-in
  // rewrite (next.config.ts: /api/* -> http://localhost:<serverPort>), so
  // no extra wiring is needed here beyond the port it listens on itself.
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

  // Fase 7 — N=2 arbiter. Polls this node's OWN server for cluster status;
  // only spawns the arbiter when this node is currently primary (every
  // node in a 2-member set would otherwise see needsArbiter=true
  // simultaneously and race to spawn duplicate arbiters — gating on
  // "am I primary" gives a single, well-defined owner without needing a
  // separate election just for this).
  private startArbiterWatcher(): void {
    this.arbiterWatchTimer = setInterval(() => void this.checkArbiterNeeded(), 10_000)
  }

  private async checkArbiterNeeded(): Promise<void> {
    if (this.arbiterProcess || this.stopping) return
    try {
      const status = await this.httpGetJson<{
        needsArbiter: boolean
        nodes: Array<{ isSelf: boolean; role: string }>
      }>(`http://127.0.0.1:${this.serverPort}/api/cluster/status`)
      const selfIsPrimary = status.nodes.some((n) => n.isSelf && n.role === 'primary')
      if (status.needsArbiter && selfIsPrimary && this.arbiterDataDir) {
        await this.spawnArbiter(this.arbiterDataDir)
      }
    } catch (err) {
      console.warn('[supervisor] arbiter check failed', err)
    }
  }

  private async spawnArbiter(dataDir: string): Promise<void> {
    console.log('[supervisor] cluster needs an arbiter — spawning one locally')
    const args = [
      '--replSet', this.replicaSetName,
      '--dbpath', dataDir,
      '--bind_ip', this.bindIp,
      '--port', String(this.arbiterMongoPort),
    ]
    this.arbiterProcess = spawn(this.mongoBin, args, { stdio: 'pipe' })
    this.arbiterProcess.on('exit', (code) => {
      if (!this.stopping) console.error(`[supervisor] arbiter mongod exited with code ${code}`)
      this.arbiterProcess = null
    })

    const deadline = Date.now() + 15_000
    while (Date.now() < deadline) {
      if (await this.checkTcpPort('127.0.0.1', this.arbiterMongoPort)) break
      await sleep(500)
    }

    // Connect through the replica-set-aware URI so the driver routes the
    // admin command to whichever node is ACTUALLY primary right now
    // (usually self, but elections can happen between the status check
    // above and this point).
    const client = new MongoClient(this.mongodbUri, { serverSelectionTimeoutMS: 10_000 })
    try {
      await client.connect()
      const conf = await client.db('admin').command({ replSetGetConfig: 1 })
      const members = conf.config.members as Array<{ _id: number; host: string }>
      const arbiterHost = `${this.bindIp === '0.0.0.0' ? (findOwnLanIp() ?? '127.0.0.1') : '127.0.0.1'}:${this.arbiterMongoPort}`
      if (members.some((m) => m.host === arbiterHost)) return // already added, idempotent
      const nextId = Math.max(0, ...members.map((m) => m._id)) + 1
      await client.db('admin').command({
        replSetReconfig: {
          ...conf.config,
          members: [...members, { _id: nextId, host: arbiterHost, arbiterOnly: true }],
          version: conf.config.version + 1,
        },
      })
      console.log(`[supervisor] arbiter added to replica set as ${arbiterHost}`)
    } finally {
      await client.close()
    }
  }

  private httpGetJson<T>(url: string): Promise<T> {
    return new Promise((resolve, reject) => {
      const req = http.get(url, { timeout: 5000 }, (res) => {
        let body = ''
        res.on('data', (chunk) => (body += chunk))
        res.on('end', () => {
          if (res.statusCode !== 200) {
            reject(new Error(`GET ${url} -> ${res.statusCode}`))
            return
          }
          try {
            resolve(JSON.parse(body) as T)
          } catch (err) {
            reject(err)
          }
        })
      })
      req.on('error', reject)
      req.on('timeout', () => {
        req.destroy()
        reject(new Error('timeout'))
      })
    })
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

// Same best-effort first-non-internal-IPv4 approach as kiosk.ts's QR code —
// duplicated rather than shared because the two files serve different
// processes/bundles (kiosk.ts runs in the Electron main process directly;
// this is a small, self-contained utility not worth a shared module for).
function findOwnLanIp(): string | null {
  const interfaces = networkInterfaces()
  for (const addrs of Object.values(interfaces)) {
    for (const addr of addrs ?? []) {
      if (addr.family === 'IPv4' && !addr.internal) return addr.address
    }
  }
  return null
}
