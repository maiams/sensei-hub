import { app, ipcMain, BrowserWindow, dialog } from 'electron'
import * as path from 'path'
import * as fs from 'fs'
import { Supervisor } from './supervisor.js'
import {
  configureKiosk,
  createLauncherWindow,
  createScoreboardKioskWindow,
  exitScoreboardWindow,
  openInBrowser,
  showLoadingOverlay,
  hideLoadingOverlay,
} from './kiosk.js'

export interface DesktopAppConfig {
  /** "Sensei Dojô" / "Sensei Arena" — shown in dialogs and the loading overlay. */
  productName: string
  /** 'dojo' | 'arena' — the apps/<slug>/ segment; used to locate the bundled
   *  Next standalone server.js, whose path keeps the monorepo nesting. */
  productSlug: string
  /** http://localhost:<webPort> — origin the window loads and the kiosk locks navigation to. */
  appOrigin: string
  serverPort: number
  webPort: number
  mongoPort: number
  dbName: string
  replicaSetName: string
  features: {
    /** Arena only: fullscreen scoreboard windows + a launcher that lists them. */
    kiosk: boolean
    /** Arena only: Fase 7 mDNS cluster + automatic arbiter for N=2. */
    cluster: boolean
  }
}

const IS_DEV = process.env.NODE_ENV !== 'production'

// Entry point each product's thin main.ts calls with its own config. Owns the
// whole Electron lifecycle (windows, supervisor, quit confirmation) so the two
// apps differ only by the config they pass in.
export function createDesktopApp(config: DesktopAppConfig): void {
  const launcherUrl = config.features.kiosk ? `${config.appOrigin}/kiosk` : config.appOrigin

  function resolveMongoPath(): string {
    if (IS_DEV) {
      return process.platform === 'win32' ? 'mongod.exe' : 'mongod'
    }
    const ext = process.platform === 'win32' ? '.exe' : ''
    return path.join(process.resourcesPath, 'mongodb', `mongod${ext}`)
  }

  function resolveServerScript(): string {
    if (IS_DEV) {
      // apps/<product>/desktop/dist -> apps/<product>/server/dist
      return path.join(__dirname, '../../server/dist/index.js')
    }
    // Matches scripts/package-app.mjs's `pnpm deploy` output layout, copied
    // verbatim into this extraResource: server/{dist,node_modules,package.json}.
    return path.join(process.resourcesPath, 'server', 'dist', 'index.js')
  }

  // null in dev — the web UI is assumed to already be running externally
  // (scripts/dev-run.mjs runs `next dev` itself). In a packaged build there's
  // nothing else to serve it, so Supervisor spawns the Next.js standalone
  // server.js bundled as an extraResource.
  function resolveWebScript(): string | null {
    if (IS_DEV) return null
    // The extraResource is a straight copy of `.next/standalone`, which keeps
    // Next's monorepo-aware layout: a hoisted root node_modules as a sibling
    // of apps/<slug>/web/server.js. server.js needs both reachable via normal
    // upward node_modules resolution, so the nesting is kept intact.
    return path.join(process.resourcesPath, 'web', 'apps', config.productSlug, 'web', 'server.js')
  }

  function resolveDataDir(): string {
    const dataDir = path.join(app.getPath('userData'), 'mongodb-data')
    fs.mkdirSync(dataDir, { recursive: true })
    return dataDir
  }

  function resolveArbiterDataDir(): string {
    const dataDir = path.join(app.getPath('userData'), 'mongodb-arbiter-data')
    fs.mkdirSync(dataDir, { recursive: true })
    return dataDir
  }

  const clusterEnabled = config.features.cluster && process.env.CLUSTER_ENABLED === 'true'

  let supervisor: Supervisor | null = null

  configureKiosk({ appOrigin: config.appOrigin, webPort: config.webPort, productName: config.productName })

  // Scoreboard IPC only exists for the kiosk-enabled product (arena). The dojo
  // window is a plain management window with no fullscreen scoreboard screens.
  if (config.features.kiosk) {
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
  }

  app.whenReady().then(async () => {
    const win = config.features.kiosk
      ? createLauncherWindow(launcherUrl)
      : createLauncherWindow(launcherUrl, { width: 1200, height: 800 })
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
          win.loadURL(launcherUrl).then(() => hideLoadingOverlay())
        },
        onServerDied: (restartCount) => {
          console.warn(`[app] server restarted (attempt ${restartCount})`)
        },
        onMongoDied: () => {
          console.error('[app] MongoDB died unexpectedly')
        },
      },
      {
        serverPort: config.serverPort,
        webPort: config.webPort,
        mongoPort: config.mongoPort,
        replicaSetName: config.replicaSetName,
        mongodbUri: `mongodb://127.0.0.1:${config.mongoPort}/${config.dbName}?replicaSet=${config.replicaSetName}`,
        webScript: resolveWebScript(),
        ...(clusterEnabled
          ? {
              bindIp: '0.0.0.0',
              clusterEnabled: true,
              arbiterDataDir: resolveArbiterDataDir(),
              clusterEnv: {
                CLUSTER_SECRET: process.env.CLUSTER_SECRET ?? 'dev-cluster-secret-change-me',
                CLUSTER_REPLICA_SET_NAME: config.replicaSetName,
                CLUSTER_MONGO_PORT: String(config.mongoPort),
                ...(process.env.CLUSTER_ADVERTISE_HOST
                  ? { CLUSTER_ADVERTISE_HOST: process.env.CLUSTER_ADVERTISE_HOST }
                  : {}),
              },
            }
          : {}),
      },
    )

    supervisor.start().catch((err) => {
      console.error('[app] startup failed', err)
      win.loadURL(
        `data:text/html,<h1 style="color:red;font-family:sans-serif;padding:2rem">Erro ao iniciar: ${String(err)}</h1>`,
      )
    })
  })

  // Single place for the "this stops mongod/server/web for everyone"
  // confirmation, regardless of what triggered the quit. quitConfirmed guards
  // against re-entering when it calls app.quit() itself at the end.
  let quitConfirmed = false

  app.on('before-quit', async (event) => {
    if (quitConfirmed || !supervisor) return
    event.preventDefault()

    const { response } = await dialog.showMessageBox({
      type: 'warning',
      title: `Fechar o ${config.productName}`,
      message: `Isso encerra o ${config.productName} para todos os dispositivos conectados a esta máquina. Continuar?`,
      buttons: ['Cancelar', 'Fechar'],
      defaultId: 0,
      cancelId: 0,
    })
    if (response !== 1) return

    quitConfirmed = true
    await supervisor.stop()
    supervisor = null
    app.quit()
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
}
