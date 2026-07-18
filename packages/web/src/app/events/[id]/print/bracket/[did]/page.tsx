'use client'

// Printable bracket sheet (staff+): the division's matches grouped by round,
// with names and results filled in where already decided. Table layout
// instead of the graphical tree — legible, printer-friendly, and format-
// agnostic (elimination and rodízio share it).

import { useCallback, useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { apiFetch, isLoggedIn } from '../../../../../../lib/api'

interface EventDTO {
  id: string
  name: string
  eventDate: string
}
interface DivisionDTO {
  id: string
  name: string
}
interface MatchDTO {
  id: string
  matchNumber: number
  round: number
  stage: 'round' | 'bronze' | 'repechage' | 'repechage_round2'
  athleteAId: string | null
  athleteBId: string | null
  byeAthleteId: string | null
  result: { winnerId: string; isWalkover: boolean; method?: string } | null
}
interface AthleteListItem {
  id: string
  fullName: string
  clubName?: string
}

const STAGE_LABELS: Record<MatchDTO['stage'], string> = {
  round: 'Rodada',
  bronze: 'Bronze',
  repechage: 'Repescagem',
  repechage_round2: 'Repescagem — 2ª rodada',
}

export default function PrintBracketPage() {
  const router = useRouter()
  const params = useParams<{ id: string; did: string }>()
  const { id: eventId, did: divisionId } = params

  const [event, setEvent] = useState<EventDTO | null>(null)
  const [division, setDivision] = useState<DivisionDTO | null>(null)
  const [matches, setMatches] = useState<MatchDTO[]>([])
  const [athletes, setAthletes] = useState<Record<string, AthleteListItem>>({})
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const [eventData, divisionsData, matchesData, athletesData] = await Promise.all([
        apiFetch<EventDTO>(`/events/${eventId}`),
        apiFetch<DivisionDTO[]>(`/events/${eventId}/divisions`),
        apiFetch<MatchDTO[]>(`/events/${eventId}/divisions/${divisionId}/matches`),
        apiFetch<{ items: AthleteListItem[] }>('/athletes?pageSize=500'),
      ])
      setEvent(eventData)
      setDivision(divisionsData.find((d) => d.id === divisionId) ?? null)
      setMatches(matchesData)
      const map: Record<string, AthleteListItem> = {}
      for (const a of athletesData.items) map[a.id] = a
      setAthletes(map)
    } catch {
      setError('Não foi possível carregar a chave (existe bracket gerado para esta divisão?).')
    }
  }, [eventId, divisionId])

  useEffect(() => {
    if (!isLoggedIn()) {
      router.replace('/login')
      return
    }
    void load()
  }, [router, load])

  if (error) return <main className="p-8 text-red-700">{error}</main>
  if (!event) return <main className="p-8 text-slate-500">Carregando…</main>

  function name(athleteId: string | null): string {
    if (!athleteId) return '—'
    const a = athletes[athleteId]
    return a ? a.fullName + (a.clubName ? ` (${a.clubName})` : '') : athleteId
  }

  const groups = new Map<string, MatchDTO[]>()
  for (const match of [...matches].sort((a, b) => a.matchNumber - b.matchNumber)) {
    const key = match.stage === 'round' ? `Rodada ${match.round}` : STAGE_LABELS[match.stage]
    const list = groups.get(key) ?? []
    list.push(match)
    groups.set(key, list)
  }

  return (
    <main className="mx-auto max-w-3xl bg-white p-8 text-slate-950 print:p-0">
      <div className="mb-6 flex items-center justify-between print:hidden">
        <button onClick={() => router.back()} className="text-sm text-slate-500 underline">
          ← Voltar
        </button>
        <button
          onClick={() => window.print()}
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white"
        >
          Imprimir
        </button>
      </div>

      <h1 className="text-2xl font-bold">Chave — {division?.name ?? divisionId}</h1>
      <p className="mb-6 text-sm text-slate-600">
        {event.name} · {event.eventDate}
      </p>

      {[...groups.entries()].map(([label, groupMatches]) => (
        <section key={label} className="mb-6 break-inside-avoid">
          <h2 className="mb-2 border-b-2 border-slate-900 pb-1 text-lg font-bold">{label}</h2>
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-slate-400 text-left text-xs uppercase text-slate-600">
                <th className="w-14 py-1 pr-2">Luta</th>
                <th className="py-1 pr-2">Branco</th>
                <th className="py-1 pr-2">Azul</th>
                <th className="w-52 py-1">Vencedor</th>
              </tr>
            </thead>
            <tbody>
              {groupMatches.map((m) => {
                const isBye = m.byeAthleteId !== null && (m.athleteAId === null || m.athleteBId === null)
                return (
                  <tr key={m.id} className="border-b border-slate-300">
                    <td className="py-2 pr-2 font-mono">#{m.matchNumber}</td>
                    <td className="py-2 pr-2">{name(m.athleteAId ?? m.byeAthleteId)}</td>
                    <td className="py-2 pr-2">{isBye ? 'BYE' : name(m.athleteBId)}</td>
                    <td className="py-2">
                      {m.result
                        ? `${name(m.result.winnerId).split(' (')[0]}${m.result.isWalkover ? ' (W.O.)' : m.result.method ? ` (${m.result.method})` : ''}`
                        : '____________'}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </section>
      ))}
      {matches.length === 0 && <p className="text-slate-500">Nenhuma chave gerada para esta divisão.</p>}
    </main>
  )
}
