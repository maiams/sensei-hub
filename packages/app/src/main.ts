import { app, ipcMain, BrowserWindow, dialog } from 'electron'
import * as path from 'path'
import * as fs from 'fs'
import { Supervisor } from './supervisor.js'
import {
  createLauncherWindow,
  createScoreboardKioskWindow,
  exitScoreboardWindow,
  openInBrowser,
  showLoadingOverlay,
  hideLoadingOverlay,
} from './kiosk.js'

const IS_DEV = process.env.NODE_ENV !== 'production'
const APP_ORIGIN = 'http://localhost:3000'
const LAUNCHER_URL = `${APP_ORIGIN}/kiosk`

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
  // Matches scripts/package-app.mjs's `pnpm deploy` output layout, copied
  // verbatim into this extraResource (packages/app/package.json):
  // server/{dist,node_modules,package.json}.
  return path.join(process.resourcesPath, 'server', 'dist', 'index.js')
}

// null in dev — the web UI is assumed to already be running externally
// (scripts/dev-run.mjs runs `next dev` itself). In a packaged build there's
// nothing else to serve it, so Supervisor spawns the Next.js standalone
// server.js bundled as an extraResource (see packages/app/package.json).
function resolveWebScript(): string | null {
  if (IS_DEV) return null
  // The extraResource is a straight copy of `.next/standalone` (see
  // scripts/package-app.mjs), which keeps Next's own monorepo-aware
  // layout: a root node_modules (hoisted deps like `next` itself) as a
  // sibling of packages/web, not inside it. server.js needs both reachable
  // via normal upward node_modules resolution, so the nesting must be kept
  // intact rather than flattened.
  return path.join(process.resourcesPath, 'web', 'packages', 'web', 'server.js')
}

function resolveDataDir(): string {
  const base = app.getPath('userData')
  const dataDir = path.join(base, 'mongodb-data')
  fs.mkdirSync(dataDir, { recursive: true })
  return dataDir
}

function resolveArbiterDataDir(): string {
  const base = app.getPath('userData')
  const dataDir = path.join(base, 'mongodb-arbiter-data')
  fs.mkdirSync(dataDir, { recursive: true })
  return dataDir
}

// Fase 7 opt-in — same env var name the server itself reads
// (packages/server/src/config/env.ts), so a single flag turns cluster mode
// on across both processes. Off by default: normal single-node behavior
// (Fase 0-6) is completely unchanged unless explicitly enabled.
const CLUSTER_ENABLED = process.env.CLUSTER_ENABLED === 'true'

let supervisor: Supervisor | null = null

// The launcher is a normal (non-kiosk) window — "Abrir gestão da academia"
// opens the system browser, "Exibir placar — <área>" opens a dedicated
// fullscreen kiosk window per mat (packages/web/src/app/kiosk/page.tsx
// drives the actual list via the authenticated event/area APIs; this main
// process only ever needs to open the URLs it's told to).
ipcMain.on('open-scoreboard', (_event, url: string) => {
  createScoreboardKioskWindow(url)
})
ipcMain.on('open-in-browser', (_event, url: string) => {
  openInBrowser(url)
})
ipcMain.on('exit-scoreboard', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender)
  if (win) exitScoreboardWindow(win)
})

app.whenReady().then(async () => {
  const win = createLauncherWindow(LAUNCHER_URL)
  showLoadingOverlay()

  supervisor = new Supervisor(
    resolveMongoPath(),
    resolveDataDir(),
    resolveServerScript(),
    {
      onMongoReady: () => console.log('[app] MongoDB ready'),
      onServerReady: () => console.log('[app] server ready'),
      onWebReady: () => {
        console.log('[app] web ready')
        // Load the launcher UI only once web (Next.js) is actually up — in
        // a packaged build that's the standalone server Supervisor just
        // spawned; in dev it's whatever's already serving :3000 externally.
        win.loadURL(LAUNCHER_URL).then(() => hideLoadingOverlay())
      },
      onServerDied: (restartCount) => {
        console.warn(`[app] server restarted (attempt ${restartCount})`)
      },
      onMongoDied: () => {
        console.error('[app] MongoDB died unexpectedly')
      },
    },
    {
      webScript: resolveWebScript(),
      ...(CLUSTER_ENABLED
        ? {
            bindIp: '0.0.0.0',
            clusterEnabled: true,
            arbiterDataDir: resolveArbiterDataDir(),
            clusterEnv: {
              CLUSTER_SECRET: process.env.CLUSTER_SECRET ?? 'dev-cluster-secret-change-me',
              ...(process.env.CLUSTER_ADVERTISE_HOST ? { CLUSTER_ADVERTISE_HOST: process.env.CLUSTER_ADVERTISE_HOST } : {}),
            },
          }
        : {}),
    },
  )

  supervisor.start().catch((err) => {
    console.error('[app] startup failed', err)
    // Show error in the launcher window
    win.loadURL(`data:text/html,<h1 style="color:red;font-family:sans-serif;padding:2rem">Erro ao iniciar: ${String(err)}</h1>`)
  })
})

// Single place for the "this stops mongod/server/web for the whole gym"
// confirmation, regardless of what triggered the quit (Cmd+Q, closing the
// launcher window on Windows/Linux via window-all-closed below, a signal).
// quitConfirmed guards against re-entering this handler when it calls
// app.quit() itself at the end — without it, that second call fires
// before-quit again and would show the dialog a second time, which nobody
// is there to answer (this is what silently hung shutdown during testing).
let quitConfirmed = false

app.on('before-quit', async (event) => {
  if (quitConfirmed || !supervisor) return
  event.preventDefault()

  const { response } = await dialog.showMessageBox({
    type: 'warning',
    title: 'Fechar o Sensei Hub',
    message:
      'Isso encerra o Sensei Hub para toda a academia — outros dispositivos usando o navegador ou telas de placar perdem a conexão. Continuar?',
    buttons: ['Cancelar', 'Fechar'],
    defaultId: 0,
    cancelId: 0,
  })
  if (response !== 1) return // cancelled — stay open

  quitConfirmed = true
  await supervisor.stop()
  supervisor = null
  app.quit()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
