import { ChildProcess, spawn } from 'child_process'
import * as http from 'http'
import { MongoClient } from 'mongodb'

const HEALTH_INTERVAL_MS = 5_000
const HEALTH_FAIL_THRESHOLD = 3
const RESTART_DELAY_MS = 2_000

export interface SupervisorConfig {
  /** Network interface mongod binds to. '127.0.0.1' for single-node dev; '0.0.0.0' for cluster. */
  bindIp?: string
  serverPort?: number
  mongodbUri?: string
  jwtSecret?: string
}

export interface SupervisorEvents {
  onMongoReady: () => void
  onServerReady: () => void
  onServerDied: (restartCount: number) => void
  onMongoDied: () => void
}

export class Supervisor {
  private mongoProcess: ChildProcess | null = null
  private serverProcess: ChildProcess | null = null
  private healthTimer: NodeJS.Timeout | null = null
  private consecutiveFails = 0
  private serverRestartCount = 0
  private stopping = false
  private isRestarting = false  // prevents concurrent restartServer() calls

  private readonly bindIp: string
  private readonly serverPort: number
  private readonly mongodbUri: string
  private readonly jwtSecret: string

  constructor(
    private readonly mongoBin: string,
    private readonly mongoDataDir: string,
    private readonly serverScript: string,
    private readonly events: SupervisorEvents,
    config: SupervisorConfig = {},
  ) {
    this.bindIp = config.bindIp ?? '127.0.0.1'
    this.serverPort = config.serverPort ?? 3001
    this.mongodbUri = config.mongodbUri ?? `mongodb://127.0.0.1:27017/senseihub?replicaSet=sensei-rs`
    this.jwtSecret = config.jwtSecret ?? 'dev-secret-change-in-production-min-32-chars'
  }

  async start(): Promise<void> {
    this.startMongo()
    await this.waitForMongoPort()
    await this.initReplicaSetIfNeeded()
    this.events.onMongoReady()
    await this.startServer()
    await this.waitForServer()
    this.events.onServerReady()
    this.startHealthLoop()
  }

  async stop(): Promise<void> {
    this.stopping = true
    if (this.healthTimer) clearInterval(this.healthTimer)

    await this.httpPost(`http://127.0.0.1:${this.serverPort}/api/shutdown-prep`).catch(() => null)

    this.serverProcess?.kill('SIGTERM')
    this.mongoProcess?.kill('SIGTERM')

    await Promise.all([
      this.waitForExit(this.serverProcess),
      this.waitForExit(this.mongoProcess),
    ])
  }

  private startMongo(): void {
    const args = [
      '--replSet', 'sensei-rs',
      '--dbpath', this.mongoDataDir,
      '--bind_ip', this.bindIp,
      '--port', '27017',
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
      if (await this.checkTcpPort('127.0.0.1', 27017)) return
      await sleep(500)
    }
    throw new Error('MongoDB did not start within 30s')
  }

  /**
   * Connects directly (no replicaSet param) and initiates the RS if not yet done.
   * Safe to call multiple times — idempotent.
   */
  private async initReplicaSetIfNeeded(timeoutMs = 15_000): Promise<void> {
    const client = new MongoClient('mongodb://127.0.0.1:27017', {
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
            _id: 'sensei-rs',
            members: [{ _id: 0, host: '127.0.0.1:27017', priority: 1 }],
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
        NODE_ENV: 'production',
        PORT: String(this.serverPort),
        MONGODB_URI: this.mongodbUri,
        JWT_SECRET: this.jwtSecret,
      },
    })
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
