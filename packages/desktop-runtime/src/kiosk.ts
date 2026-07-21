import { BrowserWindow, dialog, shell } from 'electron'
import * as path from 'path'
import { networkInterfaces } from 'node:os'
import QRCode from 'qrcode'

const EMERGENCY_EXIT_KEY = 'ctrl+alt+shift+q'

// Set once by createDesktopApp() before any window is created. Distinct per
// product (dojo :3100, arena :3000) so the same runtime serves both.
let APP_ORIGIN = 'http://localhost:3000'
let WEB_PORT = 3000
let PRODUCT_NAME = 'Sensei Hub'

export function configureKiosk(config: { appOrigin: string; webPort: number; productName: string }): void {
  APP_ORIGIN = config.appOrigin
  WEB_PORT = config.webPort
  PRODUCT_NAME = config.productName
}

// Only the scoreboard/operate screens run fullscreen kiosk now — academy
// management (athletes, events, settings) is meant to be used from a normal
// browser tab (CLAUDE.md: "gerenciamento de academia pode ser por navegador
// normal"). The launcher is the one always-open, normal-chrome window;
// scoreboard windows are opened on demand from it and can be closed
// independently without taking the launcher (or the shared mongod/server/
// web backend) down with them.
let launcherWin: BrowserWindow | null = null
const scoreboardWins = new Set<BrowserWindow>()

function preloadPath(file: string): string {
  // dist/*.js at runtime (both dev, via tsc watch/build, and packaged,
  // inside app.asar — preload scripts load fine from within an asar).
  return path.join(__dirname, file)
}

export function createLauncherWindow(url: string, size: { width: number; height: number } = { width: 480, height: 560 }): BrowserWindow {
  launcherWin = new BrowserWindow({
    width: size.width,
    height: size.height,
    backgroundColor: '#0f172a',
    webPreferences: {
      preload: preloadPath('preload.js'),
      spellcheck: false,
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  launcherWin.setMenuBarVisibility(false)
  launcherWin.loadURL(url)

  // Deliberately no per-window close confirmation here: this is a normal
  // window (real title bar, real red/yellow/green buttons on macOS, real
  // Alt+F4/X elsewhere) — that's already a fully discoverable, standard way
  // to close it. The "this stops mongod/server/web for the whole gym"
  // warning belongs to actually QUITTING the app (Cmd+Q, closing the last
  // window on Windows/Linux, etc.), handled once in main.ts's `before-quit`
  // — intercepting close here too would show a second, redundant
  // confirmation for the exact same underlying app.quit() call and risks
  // deadlocking it if that first confirmation already ran (see main.ts).
  launcherWin.on('closed', () => {
    launcherWin = null
  })

  return launcherWin
}

export function createScoreboardKioskWindow(url: string): BrowserWindow {
  const win = new BrowserWindow({
    fullscreen: true,
    kiosk: true,
    autoHideMenuBar: true,
    backgroundColor: '#0f172a',
    webPreferences: {
      preload: preloadPath('kioskExitPreload.js'),
      spellcheck: false,
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  scoreboardWins.add(win)
  win.loadURL(url)

  win.webContents.on('did-finish-load', () => {
    injectExitButton(win)
    void showAccessQrCode(win)
  })

  // Block shortcuts that expose browser internals or escape the kiosk
  win.webContents.on('before-input-event', (_event, input) => {
    const blocked = [
      'F12',
      // DevTools
      input.control && input.shift && input.key.toLowerCase() === 'i',
      // Hard refresh
      input.control && input.key === 'F5',
      // Address bar focus (Windows)
      input.control && input.key.toLowerCase() === 'l',
      // Emergency exit sequence is handled separately
    ]
    if (blocked.some(Boolean)) {
      _event.preventDefault()
    }

    // Emergency exit: Ctrl+Alt+Shift+Q (kept as a keyboard-only fallback —
    // the visible ✕ button injected below is the main, discoverable path)
    if (input.control && input.alt && input.shift && input.key.toLowerCase() === 'q') {
      promptExitScoreboard(win)
    }
  })

  // Prevent navigation to external origins
  win.webContents.on('will-navigate', (event, navUrl) => {
    if (!navUrl.startsWith(APP_ORIGIN)) {
      event.preventDefault()
    }
  })

  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))

  win.on('closed', () => {
    scoreboardWins.delete(win)
  })

  return win
}

export function exitScoreboardWindow(win: BrowserWindow): void {
  win.close()
}

export function openInBrowser(url: string): void {
  void shell.openExternal(url)
}

export function showLoadingOverlay(): void {
  launcherWin?.webContents
    .executeJavaScript(
      `
    document.body.insertAdjacentHTML('beforeend',
      '<div id="sh-loading" style="position:fixed;inset:0;background:#0f172a;display:flex;align-items:center;justify-content:center;z-index:9999;color:white;font-family:sans-serif;font-size:1.5rem">Iniciando ${PRODUCT_NAME}…</div>'
    )
  `,
    )
    .catch(() => null)
}

export function hideLoadingOverlay(): void {
  launcherWin?.webContents
    .executeJavaScript(
      `
    document.getElementById('sh-loading')?.remove()
  `,
    )
    .catch(() => null)
}

// Small, always-visible close affordance for scoreboard kiosk windows —
// this is the direct fix for "sem um comando pra fechar, não rola": before
// this, the only way out was the hidden Ctrl+Alt+Shift+Q combo.
function injectExitButton(win: BrowserWindow): void {
  win.webContents
    .executeJavaScript(
      `
      (function() {
        if (document.getElementById('sh-exit-kiosk')) return;
        var btn = document.createElement('button');
        btn.id = 'sh-exit-kiosk';
        btn.textContent = '✕ Sair';
        btn.title = 'Fechar esta tela de placar';
        btn.style.cssText = 'position:fixed;top:10px;right:10px;z-index:9999;' +
          'background:rgba(15,23,42,0.75);color:#e2e8f0;border:1px solid #475569;' +
          'border-radius:6px;padding:6px 12px;font-family:sans-serif;font-size:13px;' +
          'cursor:pointer;';
        btn.onclick = function() {
          if (window.senseiHubKiosk && window.senseiHubKiosk.exitScoreboard) {
            window.senseiHubKiosk.exitScoreboard();
          }
        };
        document.body.appendChild(btn);
      })();
    `,
    )
    .catch(() => null)
}

// Best-effort LAN IPv4 for phones/tablets on the same gym WiFi to reach this
// machine directly (Fase 6). Picks the first non-internal IPv4 interface;
// with several NICs (e.g. WiFi + Ethernet) this may not be the "right" one,
// but it's a reasonable default for a single-laptop-per-mat deployment.
// Zero-config discovery (senseihub.local via mDNS) is Fase 7 scope, not this.
function findLanAddress(): string | null {
  const interfaces = networkInterfaces()
  for (const addrs of Object.values(interfaces)) {
    for (const addr of addrs ?? []) {
      if (addr.family === 'IPv4' && !addr.internal) {
        return addr.address
      }
    }
  }
  return null
}

// Small, non-interactive QR code fixed in a screen corner so staff can point
// a phone at it and land straight on the mobile check-in/weigh-in flows
// (CLAUDE.md — "QR code fixo no canto da tela do Electron com URL de IP
// direto"). Lives on scoreboard kiosk windows now, not the launcher — this
// is the gym-facing fullscreen screen, the launcher is operator-only.
async function showAccessQrCode(win: BrowserWindow): Promise<void> {
  const ip = findLanAddress()
  if (!ip || win.isDestroyed()) return

  const url = `http://${ip}:${WEB_PORT}`
  let svg: string
  try {
    svg = await QRCode.toString(url, { type: 'svg', margin: 1, width: 120 })
  } catch {
    return // best-effort — never block kiosk startup over a QR code
  }

  const encodedSvg = Buffer.from(svg).toString('base64')
  win.webContents
    .executeJavaScript(
      `
      (function() {
        if (document.getElementById('sh-access-qr')) return;
        document.body.insertAdjacentHTML('beforeend',
          '<div id="sh-access-qr" style="position:fixed;bottom:12px;right:12px;z-index:9998;' +
          'background:rgba(15,23,42,0.9);border:1px solid #334155;border-radius:8px;padding:8px;' +
          'display:flex;flex-direction:column;align-items:center;gap:4px;pointer-events:none;">' +
          '<img src="data:image/svg+xml;base64,${encodedSvg}" width="100" height="100" alt="QR de acesso" />' +
          '<span style="color:#94a3b8;font-family:monospace;font-size:10px;">${url}</span>' +
          '</div>'
        );
      })();
    `,
    )
    .catch(() => null)
}

function promptExitScoreboard(win: BrowserWindow): void {
  dialog
    .showMessageBox(win, {
      type: 'warning',
      title: 'Fechar tela de placar',
      message: 'Fechar esta tela de placar? O restante do Sensei Hub continua rodando normalmente.',
      buttons: ['Cancelar', 'Fechar'],
      defaultId: 0,
      cancelId: 0,
    })
    .then(({ response }) => {
      if (response === 1) win.close()
    })
}

export { EMERGENCY_EXIT_KEY }
