'use client'

// Printable final results (staff+): the division's podium/standings from the
// rankings route (only available once the bracket is fully decided).

import { useCallback, useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { apiFetch, ApiError, isLoggedIn } from '../../../../../../lib/api'
import { translateApiError } from '../../../../../../lib/labels'

interface EventDTO {
  id: string
  name: string
  eventDate: string
}
interface DivisionDTO {
  id: string
  name: string
}
interface RankingRow {
  place: number
  athleteId: string
  fullName: string
  clubName: string | null
}

export default function PrintResultsPage() {
  const router = useRouter()
  const params = useParams<{ id: string; did: string }>()
  const { id: eventId, did: divisionId } = params

  const [event, setEvent] = useState<EventDTO | null>(null)
  const [division, setDivision] = useState<DivisionDTO | null>(null)
  const [rankings, setRankings] = useState<RankingRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const [eventData, divisionsData, rankingsData] = await Promise.all([
        apiFetch<EventDTO>(`/events/${eventId}`),
        apiFetch<DivisionDTO[]>(`/events/${eventId}/divisions`),
        apiFetch<RankingRow[]>(`/events/${eventId}/divisions/${divisionId}/rankings`),
      ])
      setEvent(eventData)
      setDivision(divisionsData.find((d) => d.id === divisionId) ?? null)
      setRankings(rankingsData)
    } catch (err) {
      setError(
        err instanceof ApiError
          ? translateApiError(err.message)
          : 'Não foi possível carregar os resultados desta divisão.',
      )
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
  if (!event || !rankings) return <main className="p-8 text-slate-500">Carregando…</main>

  return (
    <main className="mx-auto max-w-2xl bg-white p-8 text-slate-950 print:p-0">
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

      <h1 className="text-2xl font-bold">Resultado final — {division?.name ?? divisionId}</h1>
      <p className="mb-6 text-sm text-slate-600">
        {event.name} · {event.eventDate}
      </p>

      <table className="w-full border-collapse">
        <thead>
          <tr className="border-b-2 border-slate-900 text-left text-xs uppercase text-slate-600">
            <th className="w-24 py-2 pr-2">Colocação</th>
            <th className="py-2 pr-2">Atleta</th>
            <th className="py-2">Agremiação</th>
          </tr>
        </thead>
        <tbody>
          {rankings.map((row) => (
            <tr key={`${row.place}-${row.athleteId}`} className="border-b border-slate-300">
              <td className="py-3 pr-2 text-xl font-bold">{row.place}º</td>
              <td className="py-3 pr-2 text-lg">{row.fullName}</td>
              <td className="py-3 text-slate-600">{row.clubName ?? ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  )
}
