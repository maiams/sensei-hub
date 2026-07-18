'use client'

// Operator screen (Fase 4A routing + Fase 4B live scoreboard): pick an area
// (mat), ask for the next eligible match, start the scoreboard and run the
// whole fight — timer, scores, osaekomi, golden score, winner — from this one
// page. Several people share the same `scoreboard_operator` login and each
// picks their own physical mesa.

import { useCallback, useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { apiFetch, ApiError, isLoggedIn } from '../../../../lib/api'
import { translateApiError } from '../../../../lib/labels'
import { ScoreboardPanel, type ScoreboardDTO } from '../../../../components/ScoreboardPanel'
import { useOnlineStatus } from '../../../../lib/useOnlineStatus'

interface AreaDTO {
  id: string
  name: string
  status: 'open' | 'closed'
}

interface DivisionDTO {
  id: string
  name: string
}

interface AthleteListItem {
  id: string
  fullName: string
  preferredName?: string
}

interface NextMatchDTO {
  match: { id: string; matchNumber: number; divisionId: string; athleteAId: string; athleteBId: string } | null
}

export default function OperateAreaPage() {
  const router = useRouter()
  const params = useParams<{ id: string }>()
  const eventId = params.id
  const online = useOnlineStatus()

  const [areas, setAreas] = useState<AreaDTO[] | null>(null)
  const [divisions, setDivisions] = useState<DivisionDTO[]>([])
  const [athletes, setAthletes] = useState<Record<string, AthleteListItem>>({})
  const [selectedAreaId, setSelectedAreaId] = useState<string | null>(null)
  const [nextMatch, setNextMatch] = useState<NextMatchDTO['match'] | 'unasked'>('unasked')
  const [scoreboard, setScoreboard] = useState<ScoreboardDTO | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const [areasData, divisionsData, athletesData] = await Promise.all([
        apiFetch<AreaDTO[]>(`/events/${eventId}/areas`),
        apiFetch<DivisionDTO[]>(`/events/${eventId}/divisions`),
        apiFetch<{ items: AthleteListItem[] }>('/athletes?pageSize=200'),
      ])
      setAreas(areasData)
      setDivisions(divisionsData)
      const map: Record<string, AthleteListItem> = {}
      for (const a of athletesData.items) map[a.id] = a
      setAthletes(map)
    } catch {
      setError('Não foi possível carregar as áreas.')
    }
  }, [eventId])

  useEffect(() => {
    if (!isLoggedIn()) {
      router.replace('/login')
      return
    }
    void load()
  }, [router, load])

  function athleteName(id: string): string {
    const a = athletes[id]
    if (!a) return id
    return a.preferredName || a.fullName
  }

  function divisionName(id: string): string {
    return divisions.find((d) => d.id === id)?.name ?? id
  }

  async function handleAskNext() {
    if (!selectedAreaId) return
    setLoading(true)
    setError(null)
    try {
      const result = await apiFetch<NextMatchDTO>(`/events/${eventId}/areas/${selectedAreaId}/next-match`, {
        method: 'POST',
      })
      setNextMatch(result.match)
    } catch (err) {
      setError(err instanceof ApiError ? translateApiError(err.message) : 'Não foi possível buscar a próxima luta.')
    } finally {
      setLoading(false)
    }
  }

  async function handleStartScoreboard() {
    if (!selectedAreaId || !nextMatch || nextMatch === 'unasked') return
    setLoading(true)
    setError(null)
    try {
      const dto = await apiFetch<ScoreboardDTO>(`/events/${eventId}/areas/${selectedAreaId}/scoreboard`, {
        method: 'POST',
        body: JSON.stringify({ matchId: nextMatch.id }),
      })
      setScoreboard(dto)
    } catch (err) {
      setError(err instanceof ApiError ? translateApiError(err.message) : 'Não foi possível iniciar o placar.')
    } finally {
      setLoading(false)
    }
  }

  async function handleClose() {
    if (!selectedAreaId) return
    const reason = window.prompt('Motivo do fechamento (ex: almoço):')
    if (!reason || reason.trim().length < 3) return
    setLoading(true)
    setError(null)
    try {
      await apiFetch(`/events/${eventId}/areas/${selectedAreaId}/close`, {
        method: 'PATCH',
        body: JSON.stringify({ reason }),
      })
      setSelectedAreaId(null)
      setNextMatch('unasked')
      await load()
    } catch (err) {
      setError(err instanceof ApiError ? translateApiError(err.message) : 'Não foi possível fechar a área.')
    } finally {
      setLoading(false)
    }
  }

  if (error && !areas) {
    return (
      <main className="min-h-screen bg-slate-950 px-4 py-8 text-white">
        <p className="text-red-300">{error}</p>
      </main>
    )
  }

  if (!areas) {
    return (
      <main className="min-h-screen bg-slate-950 px-4 py-8 text-white">
        <p className="text-slate-400">Carregando…</p>
      </main>
    )
  }

  const openAreas = areas.filter((a) => a.status === 'open')
  const selectedArea = openAreas.find((a) => a.id === selectedAreaId) ?? null

  return (
    <main className="min-h-screen bg-slate-950 px-4 py-8 text-white">
      <div className="mx-auto max-w-xl space-y-6">
        <Link href={`/events/${eventId}`} className="inline-block text-sm text-slate-400 hover:text-slate-200">
          ← Voltar ao evento
        </Link>

        <h1 className="text-2xl font-bold tracking-tight">Operação de mesa</h1>

        {!online && (
          <div className="rounded-lg border-2 border-red-800 bg-red-950/60 p-4 text-sm text-red-300">
            <strong>Sem conexão.</strong> O placar ao vivo exige internet (WebSocket) e não funciona offline —
            reconecte antes de operar uma luta. Check-in e pesagem continuam funcionando e sincronizam
            automaticamente quando a conexão voltar.
          </div>
        )}

        {!selectedArea && (
          <section>
            <p className="mb-3 text-sm text-slate-400">Escolha a área que você está operando:</p>
            {openAreas.length === 0 && <p className="text-sm text-slate-500">Nenhuma área aberta no momento.</p>}
            <div className="grid gap-2 sm:grid-cols-2">
              {openAreas.map((a) => (
                <button
                  key={a.id}
                  type="button"
                  onClick={() => {
                    setSelectedAreaId(a.id)
                    setNextMatch('unasked')
                  }}
                  className="rounded-lg border border-slate-700 bg-slate-900 px-4 py-6 text-lg font-semibold text-white hover:bg-slate-800"
                >
                  {a.name}
                </button>
              ))}
            </div>
          </section>
        )}

        {selectedArea && scoreboard && (
          <section className="rounded-lg border border-slate-800 bg-slate-900 p-4">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-xl font-bold text-white">{selectedArea.name}</h2>
            </div>
            <ScoreboardPanel
              initial={scoreboard}
              onFinished={() => {
                setScoreboard(null)
                setNextMatch('unasked')
              }}
            />
          </section>
        )}

        {selectedArea && !scoreboard && (
          <section className="rounded-lg border border-slate-800 bg-slate-900 p-4">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-xl font-bold text-white">{selectedArea.name}</h2>
              <button
                type="button"
                onClick={() => setSelectedAreaId(null)}
                className="text-sm text-slate-400 hover:text-slate-200"
              >
                Trocar de área
              </button>
            </div>

            {error && <p className="mb-3 text-sm text-red-400">{error}</p>}

            {nextMatch === 'unasked' && (
              <p className="mb-4 text-sm text-slate-400">Toque no botão para buscar a próxima luta desta mesa.</p>
            )}
            {nextMatch === null && (
              <p className="mb-4 text-sm text-slate-400">Nenhuma luta disponível agora — mesa aguardando.</p>
            )}
            {nextMatch && nextMatch !== 'unasked' && (
              <div className="mb-4 rounded-lg border border-blue-800 bg-blue-950/40 p-4">
                <p className="text-xs uppercase tracking-wide text-blue-300">{divisionName(nextMatch.divisionId)}</p>
                <p className="mt-1 text-lg font-semibold text-white">
                  {athleteName(nextMatch.athleteAId)} <span className="text-slate-500">vs</span>{' '}
                  {athleteName(nextMatch.athleteBId)}
                </p>
                <p className="mt-1 text-xs text-slate-500">Luta #{nextMatch.matchNumber}</p>
                <button
                  type="button"
                  onClick={handleStartScoreboard}
                  disabled={loading}
                  className="mt-3 w-full rounded-lg bg-emerald-600 px-4 py-3 text-base font-bold text-white transition hover:bg-emerald-500 disabled:opacity-60"
                >
                  Iniciar placar
                </button>
              </div>
            )}

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={handleAskNext}
                disabled={loading}
                className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-500 disabled:opacity-60"
              >
                Buscar próxima luta
              </button>
              <button
                type="button"
                onClick={handleClose}
                disabled={loading}
                className="rounded-lg border border-amber-800 px-4 py-2 text-sm text-amber-300 hover:bg-amber-950 disabled:opacity-60"
              >
                Fechar esta área
              </button>
            </div>
          </section>
        )}
      </div>
    </main>
  )
}
