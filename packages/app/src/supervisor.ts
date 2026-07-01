import { ChildProcess, spawn } from 'child_process'
import * as http from 'http'
import * as path from 'path'

const HEALTH_URL = 'http://127.0.0.1:3001/api/health'
const HEALTH_INTERVAL_MS = 5_000
const HEALTH_FAIL_THRESHOLD = 3
const RESTART_DELAY_MS = 2_000

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

  constructor(
    private readonly mongoBin: string,
    private readonly mongoDataDir: string,
    private readonly serverScript: string,
    private readonly events: SupervisorEvents,
  ) {}

  async start(): Promise<void> {
    await this.startMongo()
    await this.waitForMongo()
    this.events.onMongoReady()
    await this.startServer()
    await this.waitForServer()
    this.events.onServerReady()
    this.startHealthLoop()
  }

  async stop(): Promise<void> {
    this.stopping = true
    if (this.healthTimer) clearInterval(this.healthTimer)

    // Ask server to flush pending writes
    await this.httpPost('http://127.0.0.1:3001/api/shutdown-prep').catch(() => null)

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
      '--bind_ip', '127.0.0.1',
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

  private async waitForMongo(timeoutMs = 30_000): Promise<void> {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      const ok = await this.checkTcpPort('127.0.0.1', 27017)
      if (ok) return
      await sleep(500)
    }
    throw new Error('MongoDB did not start within 30s')
  }

  private async startServer(): Promise<void> {
    this.serverProcess = spawn(process.execPath, [this.serverScript], {
      stdio: 'pipe',
      env: { ...process.env, NODE_ENV: 'production' },
    })
    this.serverProcess.on('exit', (code) => {
      if (!this.stopping) {
        console.error(`[supervisor] server exited with code ${code}`)
        this.restartServer()
      }
    })
  }

  private async waitForServer(timeoutMs = 30_000): Promise<void> {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      const ok = await this.pingHealth()
      if (ok) return
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
          console.warn('[supervisor] health check failed, restarting server')
          this.restartServer()
        }
      }
    }, HEALTH_INTERVAL_MS)
  }

  private async restartServer(): Promise<void> {
    if (this.stopping) return
    this.consecutiveFails = 0
    this.serverRestartCount++
    this.serverProcess?.kill('SIGTERM')
    await sleep(RESTART_DELAY_MS)
    await this.startServer()
    await this.waitForServer()
    this.events.onServerDied(this.serverRestartCount)
  }

  private pingHealth(): Promise<boolean> {
    return new Promise((resolve) => {
      const req = http.get(HEALTH_URL, { timeout: 3000 }, (res) => {
        resolve(res.statusCode === 200)
        res.resume()
      })
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
