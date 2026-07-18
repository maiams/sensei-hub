'use client'

// PUBLIC venue board — what each mat is fighting right now plus the upcoming
// queue with athlete rest countdowns. No auth, no controls; polls the public
// endpoint (5s) since this data changes slowly compared to the live
// scoreboard. Names are privacy-filtered server-side.

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import type { ScoreboardDTO } from '../../../../components/ScoreboardPanel'

interface DisplaySide {
  displayName: string
  clubName: string | null
  restingUntil: string | null
}

interface EventDisplayDTO {
  event: { id: string; name: string; eventDate: string }
  areas: Array<{ id: string; name: string; status: 'open' | 'closed'; scoreboard: ScoreboardDTO | null }>
  upcoming: Array<{
    matchId: string
    matchNumber: number
    divisionName: string
    athleteA: DisplaySide
    athleteB: DisplaySide
  }>
}

export default function EventBoardPage() {
  const params = useParams<{ id: string }>()
  const eventId = params.id

  const [data, setData] = useState<EventDisplayDTO | null>(null)
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])

  useEffect(() => {
    let cancelled = false
    async function poll() {
      try {
        const res = await fetch(`/api/public/events/${eventId}/display`)
        if (res.ok && !cancelled) setData((await res.json()) as EventDisplayDTO)
      } catch {
        // keep last known state — gym WiFi
      }
    }
    void poll()
    const t = setInterval(poll, 5000)
    return () => {
      cancelled = true
      clearInterval(t)
    }
  }, [eventId])

  if (!data) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-black text-white">
        <p className="text-3xl text-slate-500">Carregando…</p>
      </main>
    )
  }

  function restLabel(side: DisplaySide): string | null {
    if (!side.restingUntil) return null
    const remaining = new Date(side.restingUntil).getTime() - now
    if (remaining <= 0) return null
    const m = Math.floor(remaining / 60000)
    const s = Math.floor((remaining % 60000) / 1000)
    return `descansando ${m}:${String(s).padStart(2, '0')}`
  }

  return (
    <main className="min-h-screen bg-black px-6 py-6 text-white">
      <h1 className="mb-6 text-4xl font-bold">{data.event.name}</h1>

      {/* mats */}
      <div className="mb-8 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {data.areas.map((area) => (
          <Link
            key={area.id}
            href={`/display/areas/${area.id}`}
            className="rounded-xl border border-slate-800 bg-slate-950 p-5 hover:border-slate-600"
          >
            <div className="mb-2 flex items-center justify-between">
              <p className="text-2xl font-bold">{area.name}</p>
              {area.status === 'closed' && (
                <span className="rounded-full bg-red-950 px-3 py-1 text-sm text-red-300">Fechada</span>
              )}
            </div>
            {area.scoreboard && area.scoreboard.status === 'active' ? (
              <div>
                <p className="text-sm uppercase tracking-wide text-blue-300">{area.scoreboard.divisionName}</p>
                <p className="mt-1 truncate text-xl font-semibold">
                  {area.scoreboard.sides.A.displayName}
                  <span className="mx-2 text-slate-500">vs</span>
                  {area.scoreboard.sides.B.displayName}
                </p>
                {area.scoreboard.phase === 'golden_score' && (
                  <p className="mt-1 text-sm font-bold text-amber-400">GOLDEN SCORE</p>
                )}
              </div>
            ) : (
              <p className="text-lg text-slate-500">— livre —</p>
            )}
          </Link>
        ))}
        {data.areas.length === 0 && <p className="text-slate-500">Nenhuma área configurada.</p>}
      </div>

      {/* upcoming queue */}
      <h2 className="mb-3 text-2xl font-semibold text-slate-300">Próximas lutas</h2>
      <div className="space-y-2">
        {data.upcoming.length === 0 && <p className="text-lg text-slate-500">Nenhuma luta na fila.</p>}
        {data.upcoming.map((m) => {
          const restA = restLabel(m.athleteA)
          const restB = restLabel(m.athleteB)
          return (
            <div key={m.matchId} className="flex flex-wrap items-center gap-x-6 gap-y-1 rounded-lg bg-slate-950 px-5 py-3">
              <span className="w-16 shrink-0 font-mono text-xl text-slate-500 tabular-nums">#{m.matchNumber}</span>
              <span className="min-w-0 flex-1 truncate text-xl">
                {m.athleteA.displayName}
                {restA && <span className="ml-2 text-sm text-amber-400">({restA})</span>}
                <span className="mx-3 text-slate-600">vs</span>
                {m.athleteB.displayName}
                {restB && <span className="ml-2 text-sm text-amber-400">({restB})</span>}
              </span>
              <span className="shrink-0 text-base text-blue-300">{m.divisionName}</span>
            </div>
          )
        })}
      </div>
    </main>
  )
}
