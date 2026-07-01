import { BrowserWindow, app, dialog } from 'electron'

const APP_URL = 'http://localhost:3000'
const EMERGENCY_EXIT_KEY = 'ctrl+alt+shift+q'

let win: BrowserWindow | null = null

export function createKioskWindow(): BrowserWindow {
  win = new BrowserWindow({
    fullscreen: true,
    kiosk: true,
    autoHideMenuBar: true,
    backgroundColor: '#0f172a',
    webPreferences: {
      spellcheck: false,
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  win.loadURL(APP_URL)

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

    // Emergency exit: Ctrl+Alt+Shift+Q
    if (
      input.control && input.alt && input.shift &&
      input.key.toLowerCase() === 'q'
    ) {
      promptEmergencyExit()
    }
  })

  // Prevent navigation to external URLs
  win.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith(APP_URL)) {
      event.preventDefault()
    }
  })

  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))

  win.on('closed', () => { win = null })

  return win
}

export function showLoadingOverlay(): void {
  win?.webContents.executeJavaScript(`
    document.body.insertAdjacentHTML('beforeend',
      '<div id="sh-loading" style="position:fixed;inset:0;background:#0f172a;display:flex;align-items:center;justify-content:center;z-index:9999;color:white;font-family:sans-serif;font-size:1.5rem">Iniciando Sensei Hub…</div>'
    )
  `).catch(() => null)
}

export function hideLoadingOverlay(): void {
  win?.webContents.executeJavaScript(`
    document.getElementById('sh-loading')?.remove()
  `).catch(() => null)
}

function promptEmergencyExit(): void {
  dialog.showMessageBox(win!, {
    type: 'warning',
    title: 'Sair do modo kiosk',
    message: 'Esta ação encerrará o Sensei Hub. Confirma?',
    buttons: ['Cancelar', 'Sair'],
    defaultId: 0,
    cancelId: 0,
  }).then(({ response }) => {
    if (response === 1) app.quit()
  })
}

export { EMERGENCY_EXIT_KEY }
