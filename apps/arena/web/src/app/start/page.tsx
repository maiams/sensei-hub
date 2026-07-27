'use client'

// Post-login landing for roles that don't have (and shouldn't get) permission
// to list every event: scoreboard_operator and weigh_in_operator. GET
// /api/events/active is the one read they're allowed that answers "which
// event is live right now" without exposing drafts/cancelled/past events —
// see apps/arena/server/src/routes/events.ts. With exactly one event running
// (the normal case for a single-academy tournament) we forward straight to
// the operator's screen; with zero or several we show just enough to unblock
// them, never the full event registry.

import { Suspense, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { apiFetch, ApiError, clearTokens, isLoggedIn } from '../../lib/api'
import { translateApiError } from '../../lib/labels'

interface ActiveEventDTO {
  id: string
  name: string
}

function destinationFor(intent: string | null, eventId: string): string {
  if (intent === 'operate') return `/events/${eventId}/operate`
  if (intent === 'weighin') return `/events/${eventId}/weighin`
  return `/events/${eventId}`
}

function StartInner() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const intent = searchParams.get('intent')
  const [events, setEvents] = useState<ActiveEventDTO[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!isLoggedIn()) {
      router.replace('/login')
      return
    }
    apiFetch<ActiveEventDTO[]>('/events/active')
      .then((data) => {
        if (data.length === 1) {
          router.replace(destinationFor(intent, data[0]!.id))
          return
        }
        setEvents(data)
      })
      .catch((err) => {
        setError(err instanceof ApiError ? translateApiError(err.message) : 'Não foi possível verificar os eventos em andamento.')
      })
  }, [router, intent])

  if (error) {
    return (
      <main className="min-h-screen bg-slate-950 px-4 py-8 text-white">
        <div className="mx-auto max-w-md space-y-4 text-center">
          <p className="text-red-300">{error}</p>
          <button
            type="button"
            onClick={() => {
              clearTokens()
              router.replace('/login')
            }}
            className="rounded-lg border border-slate-700 px-4 py-2 text-sm text-slate-300 hover:bg-slate-800"
          >
            Sair
          </button>
        </div>
      </main>
    )
  }

  if (events === null) {
    return (
      <main className="min-h-screen bg-slate-950 px-4 py-8 text-white">
        <p className="text-center text-slate-400">Carregando…</p>
      </main>
    )
  }

  if (events.length === 0) {
    return (
      <main className="min-h-screen bg-slate-950 px-4 py-8 text-white">
        <div className="mx-auto max-w-md space-y-3 text-center">
          <p className="text-lg font-semibold text-white">Nenhum evento em andamento agora.</p>
          <p className="text-sm text-slate-400">
            Fale com o gestor do evento para colocar a competição em andamento antes de operar a mesa.
          </p>
        </div>
      </main>
    )
  }

  return (
    <main className="min-h-screen bg-slate-950 px-4 py-8 text-white">
      <div className="mx-auto max-w-md space-y-4">
        <p className="text-slate-400">Mais de um evento em andamento — escolha qual:</p>
        <ul className="space-y-2">
          {events.map((event) => (
            <li key={event.id}>
              <Link
                href={destinationFor(intent, event.id)}
                className="block rounded-lg border border-slate-800 bg-slate-900 px-4 py-4 text-lg font-semibold text-white transition hover:border-slate-700 hover:bg-slate-800"
              >
                {event.name}
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </main>
  )
}

export default function StartPage() {
  return (
    <Suspense
      fallback={
        <main className="min-h-screen bg-slate-950 px-4 py-8 text-white">
          <p className="text-center text-slate-400">Carregando…</p>
        </main>
      }
    >
      <StartInner />
    </Suspense>
  )
}
