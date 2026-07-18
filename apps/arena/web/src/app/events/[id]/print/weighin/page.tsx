'use client'

// Printable weigh-in sheets (staff+): one section per division listing the
// registered athletes with a blank weight/signature line — the paper fallback
// when the mat loses power or connectivity. White-on-black inverted for
// paper; the print button hides itself via @media print.

import { useCallback, useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { apiFetch, isLoggedIn } from '../../../../../lib/api'

interface EventDTO {
  id: string
  name: string
  eventDate: string
}
interface DivisionDTO {
  id: string
  name: string
}
interface EntryDTO {
  id: string
  athleteId: string
  divisionId: string
  confirmedDivisionId?: string
  status: string
}
interface AthleteListItem {
  id: string
  fullName: string
  clubName?: string
}

export default function PrintWeighinPage() {
  const router = useRouter()
  const params = useParams<{ id: string }>()
  const eventId = params.id

  const [event, setEvent] = useState<EventDTO | null>(null)
  const [divisions, setDivisions] = useState<DivisionDTO[]>([])
  const [entries, setEntries] = useState<EntryDTO[]>([])
  const [athletes, setAthletes] = useState<Record<string, AthleteListItem>>({})
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const [eventData, divisionsData, entriesData, athletesData] = await Promise.all([
        apiFetch<EventDTO>(`/events/${eventId}`),
        apiFetch<DivisionDTO[]>(`/events/${eventId}/divisions`),
        apiFetch<EntryDTO[]>(`/events/${eventId}/entries`),
        apiFetch<{ items: AthleteListItem[] }>('/athletes?pageSize=500'),
      ])
      setEvent(eventData)
      setDivisions(divisionsData)
      setEntries(entriesData)
      const map: Record<string, AthleteListItem> = {}
      for (const a of athletesData.items) map[a.id] = a
      setAthletes(map)
    } catch {
      setError('Não foi possível carregar os dados para impressão.')
    }
  }, [eventId])

  useEffect(() => {
    if (!isLoggedIn()) {
      router.replace('/login')
      return
    }
    void load()
  }, [router, load])

  if (error) return <main className="p-8 text-red-700">{error}</main>
  if (!event) return <main className="p-8 text-slate-500">Carregando…</main>

  const activeEntries = entries.filter((e) => !['withdrawn', 'disqualified'].includes(e.status))
  const byDivision = new Map<string, EntryDTO[]>()
  for (const entry of activeEntries) {
    const divisionId = entry.confirmedDivisionId ?? entry.divisionId
    const list = byDivision.get(divisionId) ?? []
    list.push(entry)
    byDivision.set(divisionId, list)
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

      <h1 className="text-2xl font-bold">Ficha de pesagem — {event.name}</h1>
      <p className="mb-6 text-sm text-slate-600">{event.eventDate}</p>

      {divisions
        .filter((d) => (byDivision.get(d.id) ?? []).length > 0)
        .map((division) => (
          <section key={division.id} className="mb-8 break-inside-avoid">
            <h2 className="mb-2 border-b-2 border-slate-900 pb-1 text-lg font-bold">{division.name}</h2>
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-slate-400 text-left text-xs uppercase text-slate-600">
                  <th className="py-1 pr-2">Atleta</th>
                  <th className="py-1 pr-2">Agremiação</th>
                  <th className="w-28 py-1 pr-2">Peso (kg)</th>
                  <th className="w-36 py-1">Assinatura</th>
                </tr>
              </thead>
              <tbody>
                {(byDivision.get(division.id) ?? []).map((entry) => {
                  const athlete = athletes[entry.athleteId]
                  return (
                    <tr key={entry.id} className="border-b border-slate-300">
                      <td className="py-2 pr-2">{athlete?.fullName ?? entry.athleteId}</td>
                      <td className="py-2 pr-2">{athlete?.clubName ?? ''}</td>
                      <td className="py-2 pr-2 font-mono">______</td>
                      <td className="py-2">____________</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </section>
        ))}
    </main>
  )
}
