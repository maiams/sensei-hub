'use client'

// Cluster management screen (Fase 8 — master/backup declarado). Shows who
// the master and backup are, whether the backup's replica is caught up,
// which stations are connected, and lets an event_manager+ declare a
// backup or promote one — both server-enforced (CLAUDE.md: "Frontend
// hiding is not authorization"; the backend re-checks role on every
// request regardless of what this screen shows or hides).
//
// Deliberately does NOT poll aggressively — this is a setup/incident
// screen, not a live dashboard meant to stay open during normal operation.

import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { hasMinRole, type UserRole } from '@sensei-hub/shared'
import { apiFetch, ApiError, getCurrentRole, isLoggedIn } from '../../../lib/api'
import { translateApiError } from '../../../lib/labels'

interface ClusterNodeDTO {
  host: string
  role: 'master' | 'backup'
  mongoState: string
  isSelf: boolean
  replicationLagSeconds: number | null
}
interface StationStatusDTO {
  stationId: string
  lastSeenAt: string
  online: boolean
}
interface ClusterStatusDTO {
  enabled: boolean
  replicaSetName: string | null
  selfHost: string | null
  selfRole: 'master' | 'backup' | null
  master: ClusterNodeDTO | null
  backup: ClusterNodeDTO | null
  stations: StationStatusDTO[]
}

const MONGO_STATE_LABELS: Record<string, string> = {
  PRIMARY: 'Primário (gravando)',
  SECONDARY: 'Secundário (réplica)',
  STARTUP: 'Iniciando',
  STARTUP2: 'Sincronizando pela primeira vez',
  RECOVERING: 'Recuperando',
  ROLLBACK: 'Revertendo',
  unreachable: 'Inacessível',
  unknown: 'Desconhecido',
}

function formatTimestamp(iso: string): string {
  try {
    return new Date(iso).toLocaleString('pt-BR')
  } catch {
    return iso
  }
}

export default function ClusterSettingsPage() {
  const router = useRouter()
  const [canManage, setCanManage] = useState<boolean | null>(null)
  const [status, setStatus] = useState<ClusterStatusDTO | null>(null)
  const [error, setError] = useState<string | null>(null)

  const [backupHost, setBackupHost] = useState('')
  const [declaring, setDeclaring] = useState(false)

  const [promoteStep, setPromoteStep] = useState<'idle' | 'confirming' | 'splitBrainWarning'>('idle')
  const [promoting, setPromoting] = useState(false)

  const load = useCallback(async () => {
    try {
      const data = await apiFetch<ClusterStatusDTO>('/cluster/status')
      setStatus(data)
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) {
        setCanManage(false)
        return
      }
      setError(err instanceof ApiError ? translateApiError(err.message) : 'Não foi possível carregar o status do cluster.')
    }
  }, [])

  useEffect(() => {
    if (!isLoggedIn()) {
      router.replace('/login')
      return
    }
    const currentRole = getCurrentRole()
    const allowed = currentRole !== null && hasMinRole(currentRole as UserRole, 'event_manager')
    setCanManage(allowed)
    if (allowed) void load()
  }, [router, load])

  useEffect(() => {
    if (!canManage) return
    const interval = setInterval(() => void load(), 10_000)
    return () => clearInterval(interval)
  }, [canManage, load])

  async function handleDeclareBackup(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    setDeclaring(true)
    try {
      await apiFetch('/cluster/backup', { method: 'POST', body: JSON.stringify({ mongoHost: backupHost.trim() }) })
      setBackupHost('')
      await load()
    } catch (err) {
      setError(err instanceof ApiError ? translateApiError(err.message) : 'Não foi possível declarar o backup.')
    } finally {
      setDeclaring(false)
    }
  }

  async function handlePromote(acknowledgeSplitBrainRisk: boolean) {
    setError(null)
    setPromoting(true)
    try {
      await apiFetch('/cluster/promote', {
        method: 'POST',
        body: JSON.stringify({ confirm: true, acknowledgeSplitBrainRisk }),
      })
      setPromoteStep('idle')
      await load()
    } catch (err) {
      if (err instanceof ApiError && /split-brain/i.test(err.message) && !acknowledgeSplitBrainRisk) {
        setPromoteStep('splitBrainWarning')
        setError(translateApiError(err.message))
      } else {
        setError(err instanceof ApiError ? translateApiError(err.message) : 'Não foi possível promover este computador.')
      }
    } finally {
      setPromoting(false)
    }
  }

  if (canManage === null) {
    return (
      <main className="min-h-screen bg-slate-950 px-4 py-8 text-white">
        <p className="text-slate-400">Carregando…</p>
      </main>
    )
  }

  if (!canManage) {
    return (
      <main className="min-h-screen bg-slate-950 px-4 py-8 text-white">
        <div className="mx-auto max-w-xl">
          <p className="text-amber-400">Apenas gestores do evento (ou papéis superiores) podem gerenciar o cluster.</p>
        </div>
      </main>
    )
  }

  return (
    <main className="min-h-screen bg-slate-950 px-4 py-8 text-white">
      <div className="mx-auto max-w-3xl space-y-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Cluster — master e backup</h1>
          <p className="mt-1 text-slate-400">
            Master é o computador da mesa central, sempre grava. Backup mantém uma cópia viva mas nunca assume sozinho —
            promover é uma ação deliberada, feita a partir do próprio computador do backup.
          </p>
        </div>

        {error && (
          <div className="rounded-lg border border-red-800 bg-red-950 px-4 py-3 text-sm text-red-300">{error}</div>
        )}

        {status && !status.enabled && (
          <div className="rounded-lg border border-slate-800 bg-slate-900 p-4 text-sm text-slate-400">
            Este computador não está configurado como master nem como backup — é um computador sozinho ou uma estação.
            O papel é escolhido uma vez, na primeira execução do aplicativo (menu Rede → Alterar papel deste
            computador).
          </div>
        )}

        {status && status.enabled && (
          <>
            <section className="grid gap-4 sm:grid-cols-2">
              <div className="rounded-lg border border-slate-800 bg-slate-900 p-4">
                <h2 className="mb-2 font-semibold text-white">Master</h2>
                {status.master ? (
                  <NodeCard node={status.master} />
                ) : (
                  <p className="text-sm text-slate-500">Ainda não inicializado.</p>
                )}
              </div>
              <div className="rounded-lg border border-slate-800 bg-slate-900 p-4">
                <h2 className="mb-2 font-semibold text-white">Backup</h2>
                {status.backup ? (
                  <NodeCard node={status.backup} />
                ) : (
                  <p className="text-sm text-slate-500">Nenhum backup declarado ainda.</p>
                )}
              </div>
            </section>

            {status.selfRole === 'master' && (
              <section className="rounded-lg border border-slate-800 bg-slate-900 p-4">
                <h2 className="mb-1 font-semibold text-white">Declarar backup</h2>
                <p className="mb-3 text-sm text-slate-400">
                  Informe o endereço (ip:porta) do mongod do computador que vai ser o backup — ele precisa já estar
                  ligado e com o papel &quot;Backup&quot; escolhido nele mesmo.
                </p>
                <form onSubmit={handleDeclareBackup} className="flex flex-wrap gap-2">
                  <input
                    type="text"
                    required
                    value={backupHost}
                    onChange={(e) => setBackupHost(e.target.value)}
                    placeholder="192.168.1.11:27017"
                    className="min-w-[220px] flex-1 rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 font-mono text-white placeholder-slate-500"
                  />
                  <button
                    type="submit"
                    disabled={declaring || !backupHost.trim()}
                    className="rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-blue-500 disabled:opacity-60"
                  >
                    {declaring ? 'Declarando…' : 'Declarar backup'}
                  </button>
                </form>
              </section>
            )}

            {status.selfRole === 'backup' && (
              <section className="rounded-lg border border-amber-800 bg-amber-950/30 p-4">
                <h2 className="mb-1 font-semibold text-white">Promover este computador a master</h2>
                <p className="mb-3 text-sm text-slate-300">
                  Use isto somente quando o master estiver realmente fora do ar. A promoção torna este computador o
                  novo master e é registrada na auditoria — não pode ser desfeita automaticamente.
                </p>
                {promoteStep === 'idle' && (
                  <button
                    type="button"
                    onClick={() => setPromoteStep('confirming')}
                    className="rounded-lg bg-amber-700 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-amber-600"
                  >
                    Promover a master
                  </button>
                )}
                {promoteStep === 'confirming' && (
                  <div className="space-y-3 rounded-lg border border-amber-700 bg-amber-950/50 p-3">
                    <p className="text-sm text-amber-200">
                      Confirma que o master (<span className="font-mono">{status.master?.host ?? '—'}</span>) está fora
                      do ar e que este computador deve assumir a gravação dos dados do evento?
                    </p>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        disabled={promoting}
                        onClick={() => void handlePromote(false)}
                        className="rounded-lg bg-amber-700 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-600 disabled:opacity-60"
                      >
                        {promoting ? 'Promovendo…' : 'Sim, promover'}
                      </button>
                      <button
                        type="button"
                        onClick={() => setPromoteStep('idle')}
                        className="rounded-lg border border-slate-700 px-4 py-2 text-sm text-slate-300 hover:bg-slate-800"
                      >
                        Cancelar
                      </button>
                    </div>
                  </div>
                )}
                {promoteStep === 'splitBrainWarning' && (
                  <div className="space-y-3 rounded-lg border border-red-700 bg-red-950/50 p-3">
                    <p className="text-sm text-red-200">
                      O master declarado ainda respondeu como acessível e primário. Promover agora criaria dois
                      masters ao mesmo tempo (split-brain), com risco real de perda de dados. Só continue se tiver
                      certeza de que o master está mesmo fora do ar (por exemplo, um problema de rede que só afeta
                      este backup).
                    </p>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        disabled={promoting}
                        onClick={() => void handlePromote(true)}
                        className="rounded-lg bg-red-700 px-4 py-2 text-sm font-semibold text-white hover:bg-red-600 disabled:opacity-60"
                      >
                        {promoting ? 'Promovendo…' : 'Entendo o risco, promover assim mesmo'}
                      </button>
                      <button
                        type="button"
                        onClick={() => setPromoteStep('idle')}
                        className="rounded-lg border border-slate-700 px-4 py-2 text-sm text-slate-300 hover:bg-slate-800"
                      >
                        Cancelar
                      </button>
                    </div>
                  </div>
                )}
              </section>
            )}

            <section>
              <h2 className="mb-3 font-semibold text-white">Estações conectadas</h2>
              {status.stations.length === 0 && <p className="text-sm text-slate-500">Nenhuma estação enviou sinal ainda.</p>}
              {status.stations.length > 0 && (
                <div className="overflow-x-auto rounded-lg border border-slate-800">
                  <table className="w-full text-left text-sm">
                    <thead className="bg-slate-900 text-xs uppercase tracking-wide text-slate-500">
                      <tr>
                        <th className="px-4 py-2">Estação</th>
                        <th className="px-4 py-2">Último sinal</th>
                        <th className="px-4 py-2">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {status.stations.map((s) => (
                        <tr key={s.stationId} className="border-t border-slate-800">
                          <td className="px-4 py-2 font-mono text-xs text-slate-300">{s.stationId}</td>
                          <td className="px-4 py-2 text-slate-400">{formatTimestamp(s.lastSeenAt)}</td>
                          <td className="px-4 py-2">
                            {s.online ? (
                              <span className="text-emerald-400">Online</span>
                            ) : (
                              <span className="text-slate-500">Offline</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </>
        )}
      </div>
    </main>
  )
}

function NodeCard({ node }: { node: ClusterNodeDTO }) {
  return (
    <div className="space-y-1 text-sm">
      <p className="font-mono text-slate-200">
        {node.host} {node.isSelf && <span className="ml-1 rounded bg-blue-900 px-1.5 py-0.5 text-xs text-blue-300">este computador</span>}
      </p>
      <p className="text-slate-400">{MONGO_STATE_LABELS[node.mongoState] ?? node.mongoState}</p>
      {node.replicationLagSeconds !== null && (
        <p className={node.replicationLagSeconds > 10 ? 'text-amber-400' : 'text-slate-500'}>
          Réplica {node.replicationLagSeconds}s atrás do master
        </p>
      )}
    </div>
  )
}
