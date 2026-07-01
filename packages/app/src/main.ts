import { app } from 'electron'
import * as path from 'path'
import * as fs from 'fs'
import { Supervisor } from './supervisor.js'
import { createKioskWindow, showLoadingOverlay, hideLoadingOverlay } from './kiosk.js'

const IS_DEV = process.env.NODE_ENV !== 'production'

function resolveMongoPath(): string {
  if (IS_DEV) {
    // In dev, use system mongod
    return process.platform === 'win32' ? 'mongod.exe' : 'mongod'
  }
  const ext = process.platform === 'win32' ? '.exe' : ''
  return path.join(process.resourcesPath, 'mongodb', `mongod${ext}`)
}

function resolveServerScript(): string {
  if (IS_DEV) {
    return path.join(__dirname, '../../server/dist/index.js')
  }
  return path.join(process.resourcesPath, 'server', 'index.js')
}

function resolveDataDir(): string {
  const base = app.getPath('userData')
  const dataDir = path.join(base, 'mongodb-data')
  fs.mkdirSync(dataDir, { recursive: true })
  return dataDir
}

let supervisor: Supervisor | null = null

app.whenReady().then(async () => {
  const win = createKioskWindow()
  showLoadingOverlay()

  supervisor = new Supervisor(
    resolveMongoPath(),
    resolveDataDir(),
    resolveServerScript(),
    {
      onMongoReady: () => console.log('[app] MongoDB ready'),
      onServerReady: () => {
        console.log('[app] server ready')
        // Load the Next.js app only after the server is up
        win.loadURL('http://localhost:3000').then(() => hideLoadingOverlay())
      },
      onServerDied: (restartCount) => {
        console.warn(`[app] server restarted (attempt ${restartCount})`)
      },
      onMongoDied: () => {
        console.error('[app] MongoDB died unexpectedly')
      },
    },
  )

  supervisor.start().catch((err) => {
    console.error('[app] startup failed', err)
    // Show error in the kiosk window
    win.loadURL(`data:text/html,<h1 style="color:red;font-family:sans-serif;padding:2rem">Erro ao iniciar: ${String(err)}</h1>`)
  })
})

app.on('before-quit', async (event) => {
  if (!supervisor) return
  event.preventDefault()
  await supervisor.stop()
  supervisor = null
  app.quit()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
