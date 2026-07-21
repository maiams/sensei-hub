// Exposed only to the launcher window (see kiosk.ts createLauncherWindow) —
// contextIsolation:true means the renderer can't reach ipcRenderer directly,
// this is the narrow, explicit bridge instead. Scoreboard kiosk windows get
// a *different* preload (kioskExitPreload.ts) with just the exit affordance,
// on the principle of exposing only what each window actually needs.
import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('senseiHubKiosk', {
  openScoreboard: (url: string) => ipcRenderer.send('open-scoreboard', url),
  openInBrowser: (url: string) => ipcRenderer.send('open-in-browser', url),
})
