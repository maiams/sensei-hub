import { app, dialog } from 'electron'
import * as fs from 'fs'
import * as path from 'path'

// Fase 8 (deploy Windows). Only asked for products that actually support the
// Fase 7 mDNS cluster (today: Arena — see DesktopAppConfig.features.cluster
// in createDesktopApp.ts). Dojô never calls this; it's always standalone.
//
// Deliberately NOT a "servidor vs estação" choice. The cluster engine built
// in Fase 7 (ClusterManager.bootstrap()) is peer-to-peer: every node that
// joins keeps a full mongod replica member and can become primary — there is
// no thin "estação" role with zero local data. What the operator actually
// needs to decide, once, is whether THIS machine talks to others on the LAN
// at all. If yes, ClusterManager's own mDNS discovery already figures out
// on its own whether to found a new replica set or join an existing one —
// no further input needed from the user for that part.
export type NetworkMode = 'standalone' | 'cluster'

interface NetworkModeFile {
  mode: NetworkMode
}

function configPath(): string {
  return path.join(app.getPath('userData'), 'network-mode.json')
}

function readConfig(): NetworkModeFile | null {
  try {
    const raw = fs.readFileSync(configPath(), 'utf8')
    const parsed = JSON.parse(raw) as Partial<NetworkModeFile>
    if (parsed.mode === 'standalone' || parsed.mode === 'cluster') return { mode: parsed.mode }
    return null
  } catch {
    return null
  }
}

function writeConfig(config: NetworkModeFile): void {
  fs.mkdirSync(path.dirname(configPath()), { recursive: true })
  fs.writeFileSync(configPath(), JSON.stringify(config, null, 2), 'utf8')
}

/**
 * Resolves this machine's network mode for the current run, asking the
 * operator (native dialog, first run only) when nothing was decided yet.
 * Persisted so every subsequent launch is silent. `resetNetworkMode()`
 * (wired to a menu item in createDesktopApp) deletes the file so the next
 * launch asks again — the only way to change the answer, by design: this is
 * a decision made once per machine, at setup time, in the gym, not a
 * runtime toggle to be flipped away by end users.
 */
export function resolveNetworkMode(productName: string): NetworkMode {
  const existing = readConfig()
  if (existing) return existing.mode

  const response = dialog.showMessageBoxSync({
    type: 'question',
    title: `${productName} — modo de rede`,
    message: `Este computador vai ser usado sozinho ou em rede com outros computadores do ginásio?`,
    detail:
      'Sozinho: tudo roda neste único computador (recomendado para a maioria dos casos).\n\n' +
      'Em rede: este computador compartilha os dados de evento com outros computadores no mesmo ' +
      'local (ex.: um na pesagem, um em cada mesa, um no telão). Escolha "Em rede" em TODOS os ' +
      'computadores que vão participar do mesmo evento — não é preciso indicar qual é o principal, ' +
      'eles se encontram sozinhos na rede local.\n\n' +
      'Dá para mudar depois em Configurações.',
    buttons: ['Sozinho', 'Em rede'],
    defaultId: 0,
    cancelId: 0,
    noLink: true,
  })

  const mode: NetworkMode = response === 1 ? 'cluster' : 'standalone'
  writeConfig({ mode })
  return mode
}

/** See resolveNetworkMode's doc — the only supported way to change the answer. */
export function resetNetworkMode(): void {
  try {
    fs.unlinkSync(configPath())
  } catch {
    // already absent — fine, next launch asks again either way
  }
}
