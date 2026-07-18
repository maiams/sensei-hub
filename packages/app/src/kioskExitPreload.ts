// Attached only to fullscreen scoreboard windows (kiosk.ts
// createScoreboardKioskWindow) — the one thing those windows can ask the
// main process for is "close me". Kept separate from preload.ts so a
// scoreboard window (which may be facing the public, at a gym) never gets
// openScoreboard/openInBrowser in its world.
import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('senseiHubKiosk', {
  exitScoreboard: () => ipcRenderer.send('exit-scoreboard'),
})
