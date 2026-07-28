import { app, dialog, BrowserWindow, ipcMain } from 'electron'
import * as fs from 'fs'
import * as path from 'path'

// Fase 8 — Master/Backup declarado. Only asked for products that support
// the cluster (today: Arena — see DesktopAppConfig.features.cluster in
// createDesktopApp.ts; Dojô never calls this, always standalone).
//
// Replaces the old Fase 7 "sozinho vs em rede" binary choice (mDNS
// peer-to-peer discovery, every node a potential primary, the set
// reconfiguring itself on its own) with the model the product owner asked
// for explicitly: roles are DECLARED by a human at setup time, never
// inferred or elected.
//
//   - standalone: everything on one computer (today's default, unchanged).
//   - master: the central-desk computer. Runs its own mongod and always
//     accepts writes — it's the only voting member of the replica set, so
//     one vote is always a majority of one.
//   - backup: a second computer. This dialog only readies its mongod to be
//     added — the actual "declare this as backup" action happens
//     separately, deliberately, from the MASTER's own web management
//     screen (see apps/arena/server/src/cluster/ClusterManager.ts).
//   - station: an area notebook. Runs no local mongod at all — needs the
//     master's (and ideally the backup's) LAN mongod address, entered ONCE
//     here, so its own Fastify server's MONGODB_URI can seed a
//     replicaSet-aware connection. See supervisor.ts's module doc comment
//     for why that alone is enough for "reapontar rápido" after a
//     promotion — no further input is ever needed from this station again.
export type MachineRole = 'standalone' | 'master' | 'backup' | 'station'

export interface MachineRoleConfig {
  role: MachineRole
  /** Only for role 'station' — "ip:mongoPort" of the master, and
   *  optionally the backup, entered once at setup. */
  stationSeeds?: string[]
}

function configPath(): string {
  return path.join(app.getPath('userData'), 'machine-role.json')
}

function readConfig(): MachineRoleConfig | null {
  try {
    const raw = fs.readFileSync(configPath(), 'utf8')
    const parsed = JSON.parse(raw) as Partial<MachineRoleConfig>
    if (parsed.role === 'standalone' || parsed.role === 'master' || parsed.role === 'backup' || parsed.role === 'station') {
      return { role: parsed.role, ...(Array.isArray(parsed.stationSeeds) ? { stationSeeds: parsed.stationSeeds } : {}) }
    }
    return null
  } catch {
    return null
  }
}

function writeConfig(config: MachineRoleConfig): void {
  fs.mkdirSync(path.dirname(configPath()), { recursive: true })
  fs.writeFileSync(configPath(), JSON.stringify(config, null, 2), 'utf8')
}

/**
 * Resolves this machine's role for the current run, asking the operator
 * (native dialog, first run only) when nothing was decided yet. Persisted
 * so every subsequent launch is silent. `resetMachineRole()` (wired to a
 * menu item in createDesktopApp) deletes the file so the next launch asks
 * again — the only way to change the answer, by design: this is a decision
 * made once per machine, at setup time, in the gym, not a runtime toggle to
 * be flipped away by end users.
 */
export async function resolveMachineRole(productName: string): Promise<MachineRoleConfig> {
  const existing = readConfig()
  if (existing) return existing

  const response = dialog.showMessageBoxSync({
    type: 'question',
    title: `${productName} — papel deste computador`,
    message: 'Como este computador vai ser usado no ginásio?',
    detail:
      'Sozinho: tudo roda neste único computador (recomendado para a maioria dos casos).\n\n' +
      'Master: computador da mesa central — grava os dados do evento e nunca para de aceitar escrita ' +
      'sozinho, mesmo se o backup cair.\n\n' +
      'Backup: mantém uma cópia viva dos dados do master. A declaração de fato acontece depois, na tela ' +
      'de gerenciamento do computador master — escolher isto aqui só deixa este computador pronto para ser ' +
      'declarado.\n\n' +
      'Estação: computador de uma área/mesa. Não guarda banco de dados — só roda o aplicativo e envia os ' +
      'dados para o master.\n\n' +
      'Dá para mudar depois em Configurações.',
    buttons: ['Sozinho', 'Master', 'Backup', 'Estação'],
    defaultId: 0,
    cancelId: 0,
    noLink: true,
  })

  const role: MachineRole = (['standalone', 'master', 'backup', 'station'] as const)[response] ?? 'standalone'

  if (role === 'station') {
    const master = await promptForText(
      productName,
      'Endereço do mongod do computador MASTER (ip:porta).\nPeça esse endereço para quem administra o master.\nEx.: 192.168.1.10:27017',
    )
    const backup = master
      ? await promptForText(
          productName,
          'Endereço do mongod do computador BACKUP (ip:porta) — opcional,\ndeixe em branco se ainda não houver um.\nEx.: 192.168.1.11:27017',
        )
      : null
    const stationSeeds = [master, backup].filter((s): s is string => Boolean(s && s.trim().length > 0))
    if (stationSeeds.length === 0) {
      dialog.showErrorBox(
        productName,
        'É necessário informar pelo menos o endereço do master para configurar este computador como estação. Reinicie o aplicativo para tentar de novo.',
      )
    }
    const config: MachineRoleConfig = { role, ...(stationSeeds.length > 0 ? { stationSeeds } : {}) }
    writeConfig(config)
    return config
  }

  const config: MachineRoleConfig = { role }
  writeConfig(config)
  return config
}

/** See resolveMachineRole's doc — the only supported way to change the answer. */
export function resetMachineRole(): void {
  try {
    fs.unlinkSync(configPath())
  } catch {
    // already absent — fine, next launch asks again either way
  }
}

// Minimal first-party modal prompt — Electron's `dialog` module has no
// built-in text input box. Only ever loads inline, self-authored HTML
// (never remote or user-supplied content), so nodeIntegration here carries
// the same trust level as a native dialog, not a general webview risk. Each
// call uses its own IPC channel name so two prompts in sequence (master
// address, then backup address) can never cross-resolve each other.
function promptForText(title: string, message: string): Promise<string | null> {
  return new Promise((resolve) => {
    const channel = `machine-role-prompt-result-${Date.now()}-${Math.random().toString(36).slice(2)}`
    const win = new BrowserWindow({
      width: 520,
      height: 260,
      resizable: false,
      minimizable: false,
      maximizable: false,
      title,
      backgroundColor: '#0f172a',
      webPreferences: { nodeIntegration: true, contextIsolation: false },
    })
    win.setMenuBarVisibility(false)

    function finish(value: string | null) {
      ipcMain.removeListener(channel, handleResult)
      resolve(value)
      if (!win.isDestroyed()) win.close()
    }
    function handleResult(_event: unknown, value: string | null) {
      finish(value)
    }

    ipcMain.once(channel, handleResult)
    win.on('closed', () => finish(null))

    const escaped = escapeHtml(message)
    const html = `<!doctype html><html><body style="font-family:sans-serif;padding:16px;background:#0f172a;color:#e2e8f0;margin:0">
      <p style="margin-top:0;white-space:pre-line">${escaped}</p>
      <input id="v" type="text" style="width:100%;padding:8px;font-size:14px;box-sizing:border-box;background:#1e293b;color:#e2e8f0;border:1px solid #475569;border-radius:6px" autofocus />
      <div style="margin-top:16px;text-align:right">
        <button id="cancel" style="padding:6px 14px;margin-right:8px">Deixar em branco</button>
        <button id="ok" style="padding:6px 14px">OK</button>
      </div>
      <script>
        const { ipcRenderer } = require('electron')
        function send(v) { ipcRenderer.send('${channel}', v) }
        document.getElementById('ok').onclick = () => send(document.getElementById('v').value)
        document.getElementById('cancel').onclick = () => send(null)
        document.getElementById('v').addEventListener('keydown', (e) => { if (e.key === 'Enter') send(document.getElementById('v').value) })
      </script>
    </body></html>`

    win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
  })
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}
