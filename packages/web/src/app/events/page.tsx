'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { apiFetch, isLoggedIn } from '../../lib/api'
import { EVENT_STATUS_LABELS, formatDate } from '../../lib/labels'

interface EventListItem {
  id: string
  name: string
  eventDate: string
  venue?: string
  status: string
}

export default function EventsPage() {
  const router = useRouter()
  const [events, setEvents] = useState<EventListItem[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const data = await apiFetch<EventListItem[]>('/events')
      setEvents(data)
    } catch {
      setError('Não foi possível carregar os eventos.')
    }
  }, [])

  useEffect(() => {
    if (!isLoggedIn()) {
      router.replace('/login')
      return
    }
    void load()
  }, [router, load])

  return (
    <main className="min-h-screen bg-slate-950 px-4 py-8 text-white">
      <div className="mx-auto max-w-3xl">
        <div className="mb-6 flex items-center justify-between gap-4">
          <div>
            <Link href="/athletes" className="mb-2 inline-block text-sm text-slate-400 hover:text-slate-200">
              ← Atletas
            </Link>
            <h1 className="text-2xl font-bold tracking-tight">Eventos</h1>
          </div>
          <Link
            href="/events/new"
            className="rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-blue-500"
          >
            + Criar evento
          </Link>
        </div>

        {error && (
          <div className="rounded-lg border border-red-800 bg-red-950 px-4 py-3 text-sm text-red-300">{error}</div>
        )}

        {!error && !events && <p className="text-slate-400">Carregando…</p>}

        {events && events.length === 0 && <p className="text-slate-400">Nenhum evento cadastrado.</p>}

        {events && events.length > 0 && (
          <ul className="space-y-2">
            {events.map((event) => (
              <li key={event.id}>
                <Link
                  href={`/events/${event.id}`}
                  className="flex items-center justify-between rounded-lg border border-slate-800 bg-slate-900 px-4 py-4 transition hover:border-slate-700 hover:bg-slate-800"
                >
                  <div>
                    <p className="text-lg font-semibold text-white">{event.name}</p>
                    <p className="text-sm text-slate-400">
                      {formatDate(event.eventDate)}
                      {event.venue ? ` · ${event.venue}` : ''}
                    </p>
                  </div>
                  <span className="rounded-full border border-slate-700 px-3 py-1 text-xs font-medium text-slate-300">
                    {EVENT_STATUS_LABELS[event.status] ?? event.status}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </main>
  )
}
