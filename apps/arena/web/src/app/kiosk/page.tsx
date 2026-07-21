'use client'

// Landing page for the Sensei Arena Electron launcher window (packages/desktop-runtime/
// src/kiosk.ts createLauncherWindow). Only the scoreboard/operate screens
// run fullscreen kiosk (CLAUDE.md decision: "gerenciamento de academia pode
// ser por navegador normal, apenas o placar e a gestão de placar em tela
// cheia") — this page's job is picking which one to open, reusing the same
// authenticated event/area APIs the rest of the app already uses. Opening a
// normal browser tab to this same URL still works (falls back to plain
// navigation instead of the Electron bridge), it just won't be fullscreen.
import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { apiFetch, isLoggedIn } from '../../lib/api'

interface EventListItem {
  id: string
  name: string
  status: string
}

interface AreaDTO {
  id: string
  name: string
  status: 'open' | 'closed'
}

const LIVE_STATUSES = new Set(['draft', 'registration', 'in_progress'])

function openScoreboard(url: string): void {
  if (window.senseiHubKiosk) {
    window.senseiHubKiosk.openScoreboard(url)
  } else {
    window.open(url, '_blank')
  }
}

function openInBrowser(url: string): void {
  if (window.senseiHubKiosk) {
    window.senseiHubKiosk.openInBrowser(url)
  } else {
    window.open(url, '_blank')
  }
}

export default function KioskLauncherPage() {
  const router = useRouter()
  const [events, setEvents] = useState<EventListItem[] | null>(null)
  const [areasByEvent, setAreasByEvent] = useState<Record<string, AreaDTO[]>>({})
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const allEvents = await apiFetch<EventListItem[]>('/events')
      const live = allEvents.filter((e) => LIVE_STATUSES.has(e.status))
      setEvents(live)

      const entries = await Promise.all(
        live.map(async (e) => [e.id, await apiFetch<AreaDTO[]>(`/events/${e.id}/areas`)] as const),
      )
      setAreasByEvent(Object.fromEntries(entries))
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
      <div className="mx-auto max-w-lg">
        <h1 className="mb-1 text-2xl font-bold tracking-tight">Sensei Arena</h1>
        <p className="mb-6 text-sm text-slate-400">Escolha o que abrir nesta tela.</p>

        <button
          onClick={() => openInBrowser(`${window.location.origin}/events`)}
          className="mb-8 w-full rounded-lg bg-blue-600 px-4 py-3 text-left text-sm font-semibold text-white transition hover:bg-blue-500"
        >
          Abrir gestão do campeonato
          <span className="block text-xs font-normal text-blue-200">Eventos, inscrições, divisões — no navegador</span>
        </button>

        {error && (
          <div className="mb-4 rounded-lg border border-red-800 bg-red-950 px-4 py-3 text-sm text-red-300">{error}</div>
        )}

        {events === null && !error && <p className="text-sm text-slate-500">Carregando eventos…</p>}

        {events !== null && events.length === 0 && (
          <p className="text-sm text-slate-500">Nenhum evento ativo no momento.</p>
        )}

        {events?.map((event) => {
          const areas = areasByEvent[event.id] ?? []
          return (
            <div key={event.id} className="mb-6 rounded-lg border border-slate-800 bg-slate-900 p-4">
              <p className="mb-3 font-semibold">{event.name}</p>

              <button
                onClick={() => openScoreboard(`${window.location.origin}/events/${event.id}/operate`)}
                className="mb-3 w-full rounded-lg bg-emerald-700 px-3 py-2.5 text-sm font-semibold text-white transition hover:bg-emerald-600"
              >
                Abrir operação de placar (tela cheia)
              </button>

              {areas.length > 0 && (
                <div className="space-y-2">
                  <p className="text-xs uppercase tracking-wide text-slate-500">Telas públicas por área</p>
                  {areas.map((area) => (
                    <button
                      key={area.id}
                      onClick={() => openScoreboard(`${window.location.origin}/display/areas/${area.id}`)}
                      className="w-full rounded-lg border border-slate-700 px-3 py-2 text-left text-sm text-slate-200 transition hover:border-slate-500"
                    >
                      Exibir placar — {area.name}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </main>
  )
}
