'use client'

// Mobile-first check-in station (Fase 5). Optimized for a phone/tablet at
// the door: big search box, big touch-target results, one tap to confirm —
// per CLAUDE.md "Mobile Check-In" and "UI Principles" (fast search, few
// clicks, large controls, mistake recovery). Search filters the full
// /athletes roster client-side by name/CPF/federationNumber/zempoNumber
// (see the offline-resilience note below) rather than inventing a new
// endpoint. QR/short-code scanning hardware is out of scope for this pass —
// the `method` enum reserves the values, but only staff-assisted search
// exists today.
//
// Same-name disambiguation: two athletes can share a name (even a full
// name, in the same academy) — each result row shows an identifier
// resolved by resolveAthleteIdentity (see lib/athleteIdentity.ts), plus the
// division(s) the athlete is entered in for this event and their academy,
// so the operator isn't guessing which "Alice" to check in.

import { useCallback, useEffect, useRef, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { hasMinRole, type UserRole } from '@sensei-hub/shared'
import { apiFetch, ApiError, getCurrentRole, isLoggedIn } from '../../../../lib/api'
import { translateApiError } from '../../../../lib/labels'
import { enqueueOfflineWrite } from '../../../../lib/offlineQueue'
import { resolveAthleteIdentity } from '../../../../lib/athleteIdentity'

interface AthleteListItem {
  id: string
  fullName: string
  preferredName?: string
  clubName?: string
  cpf?: string
  federationNumber?: string
  zempoNumber?: string
  birthDate: string
}

interface DivisionListItem {
  id: string
  name: string
}

// Minimal slice of EventEntry — just enough to label which categories this
// athlete is entered in at this event. withdrawn entries are excluded: an
// operator at the door doesn't need to see a category the athlete pulled
// out of.
interface EntryListItem {
  athleteId: string
  divisionId: string
  status: string
}

interface AttendanceDTO {
  id: string
  athleteId: string
  method: string
  status: 'active' | 'revoked'
  checkedInAt: string
  entriesUpdated: number
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
}

export default function EventCheckInPage() {
  const router = useRouter()
  const params = useParams<{ id: string }>()
  const eventId = params.id

  const [query, setQuery] = useState('')
  const [allAthletes, setAllAthletes] = useState<AthleteListItem[]>([])
  const [divisionsById, setDivisionsById] = useState<Map<string, DivisionListItem>>(new Map())
  const [entriesByAthleteId, setEntriesByAthleteId] = useState<Map<string, EntryListItem[]>>(new Map())
  const [results, setResults] = useState<AthleteListItem[]>([])
  const [error, setError] = useState<string | null>(null)
  const [confirming, setConfirming] = useState<AthleteListItem | null>(null)
  const [success, setSuccess] = useState<{ athlete: AthleteListItem; attendance: AttendanceDTO | null } | null>(null)
  const [duplicate, setDuplicate] = useState<{ athlete: AthleteListItem; attendance: AttendanceDTO } | null>(null)
  const [recent, setRecent] = useState<Array<AttendanceDTO & { athleteName: string }>>([])
  const [canUndo, setCanUndo] = useState(false)
  const searchInputRef = useRef<HTMLInputElement>(null)

  // Loaded once (not re-fetched per keystroke) and searched client-side —
  // deliberate for offline resilience: a fresh `?q=` request per search term
  // would almost never be a cache hit (Cache Storage keys are exact URLs),
  // so a door operator losing connectivity mid-shift couldn't find anyone
  // they hadn't already searched for. Loading the full roster once (while
  // online) primes the service worker's read cache (src/app/sw.ts) for the
  // whole list, and everything after that is a local, instant, offline-safe
  // filter — the CLAUDE.md "fast search" UI principle plus real offline use.
  // Divisions/entries are fetched the same way (also cached — see
  // src/app/sw.ts's read-cache regex, which already covers
  // /api/events/:id/{divisions,entries}) purely to label each result with
  // its category — nothing here asks the server for anything beyond what
  // /athletes was already returning for this same screen.
  const loadRecent = useCallback(async () => {
    try {
      const [attendance, athletesData, divisions, entries] = await Promise.all([
        apiFetch<AttendanceDTO[]>(`/events/${eventId}/checkin?status=active`),
        apiFetch<{ items: AthleteListItem[] }>('/athletes?pageSize=500'),
        apiFetch<DivisionListItem[]>(`/events/${eventId}/divisions`),
        apiFetch<EntryListItem[]>(`/events/${eventId}/entries`),
      ])
      setAllAthletes(athletesData.items)
      setDivisionsById(new Map(divisions.map((d) => [d.id, d])))
      const byAthlete = new Map<string, EntryListItem[]>()
      for (const entry of entries) {
        if (entry.status === 'withdrawn') continue
        const list = byAthlete.get(entry.athleteId) ?? []
        list.push(entry)
        byAthlete.set(entry.athleteId, list)
      }
      setEntriesByAthleteId(byAthlete)
      const athleteById = new Map(athletesData.items.map((a) => [a.id, a]))
      const withNames = attendance
        .slice(0, 8)
        .map((a) => ({ ...a, athleteName: athleteById.get(a.athleteId)?.fullName ?? a.athleteId }))
      setRecent(withNames)
    } catch {
      // non-fatal — the recent list is a convenience, not the primary flow
    }
  }, [eventId])

  useEffect(() => {
    if (!isLoggedIn()) {
      router.replace('/login')
      return
    }
    const role = getCurrentRole()
    setCanUndo(role !== null && hasMinRole(role as UserRole, 'event_manager'))
    void loadRecent()
    searchInputRef.current?.focus()
  }, [router, loadRecent])

  useEffect(() => {
    const term = query.trim()
    if (term.length < 2) {
      setResults([])
      return
    }
    // Local filter over `allAthletes` (loaded once) — instant, no debounce
    // needed since there's no network round-trip to throttle.
    const normalized = term
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
    setResults(
      allAthletes
        .filter((a) => {
          const name = a.fullName
            .toLowerCase()
            .normalize('NFD')
            .replace(/[̀-ͯ]/g, '')
          return (
            name.includes(normalized) ||
            a.cpf === term ||
            a.federationNumber === term ||
            a.zempoNumber === term
          )
        })
        .slice(0, 20),
    )
  }, [query, allAthletes])

  // Names in this event are common enough that two athletes can share one
  // (see CLAUDE.md context: "duas Alices" from the same academy) — the
  // identifier + category + academy below are what actually tells the
  // operator apart which row to tap.
  const categoryLabelFor = useCallback(
    (athleteId: string): string | null => {
      const entries = entriesByAthleteId.get(athleteId)
      if (!entries || entries.length === 0) return null
      const names = entries.map((e) => divisionsById.get(e.divisionId)?.name).filter((n): n is string => Boolean(n))
      return names.length > 0 ? names.join(' · ') : null
    },
    [entriesByAthleteId, divisionsById],
  )

  async function handleConfirmCheckIn(athlete: AthleteListItem) {
    setError(null)
    setDuplicate(null)
    try {
      const attendance = await apiFetch<AttendanceDTO>(`/events/${eventId}/checkin`, {
        method: 'POST',
        body: JSON.stringify({ athleteId: athlete.id, method: 'staff_search' }),
      })
      setSuccess({ athlete, attendance })
      setConfirming(null)
      setQuery('')
      setResults([])
      void loadRecent()
      searchInputRef.current?.focus()
      setTimeout(() => setSuccess(null), 3500)
    } catch (err) {
      if (err instanceof ApiError && err.status === 409 && err.details) {
        setDuplicate({ athlete, attendance: err.details as AttendanceDTO })
        setConfirming(null)
      } else if (!(err instanceof ApiError)) {
        // fetch() itself failed (no ApiError was thrown) — the network is
        // down, not a business-rule rejection. Queue it: the operator at
        // the door shouldn't be blocked by bad gym WiFi (CLAUDE.md —
        // Offline and Resilience: "safe retry", "no silent data loss").
        await enqueueOfflineWrite({
          path: `/events/${eventId}/checkin`,
          method: 'POST',
          body: { athleteId: athlete.id, method: 'staff_search' },
          description: `Check-in: ${athlete.fullName}`,
        })
        setSuccess({ athlete, attendance: null })
        setConfirming(null)
        setQuery('')
        setResults([])
        searchInputRef.current?.focus()
        setTimeout(() => setSuccess(null), 3500)
      } else {
        setError(translateApiError(err.message))
      }
    }
  }

  async function handleUndo(attendanceId: string) {
    const reason = window.prompt('Motivo para desfazer o check-in:')
    if (!reason || reason.trim().length < 3) return
    try {
      await apiFetch(`/events/${eventId}/checkin/${attendanceId}`, {
        method: 'DELETE',
        body: JSON.stringify({ reason }),
      })
      setDuplicate(null)
      void loadRecent()
    } catch (err) {
      setError(err instanceof ApiError ? translateApiError(err.message) : 'Não foi possível desfazer o check-in.')
    }
  }

  return (
    <main className="min-h-screen bg-slate-950 px-4 py-6 text-white">
      <div className="mx-auto max-w-xl space-y-5">
        <Link href={`/events/${eventId}`} className="inline-block text-sm text-slate-400 hover:text-slate-200">
          ← Voltar ao evento
        </Link>

        <h1 className="text-3xl font-bold tracking-tight">Check-in</h1>

        {success && (
          <div className="rounded-xl border-2 border-emerald-700 bg-emerald-950/60 p-5 text-center">
            <p className="text-2xl font-bold text-emerald-300">✓ {success.athlete.fullName}</p>
            {success.attendance ? (
              <p className="mt-1 text-sm text-emerald-400">
                Check-in feito às {formatTime(success.attendance.checkedInAt)}
                {success.attendance.entriesUpdated > 0 &&
                  ` · ${success.attendance.entriesUpdated} inscrição(ões) avançada(s)`}
              </p>
            ) : (
              <p className="mt-1 text-sm text-amber-400">
                Sem conexão — salvo neste aparelho, vai sincronizar automaticamente.
              </p>
            )}
          </div>
        )}

        {duplicate && (
          <div className="rounded-xl border-2 border-amber-700 bg-amber-950/60 p-5">
            <p className="text-xl font-bold text-amber-300">{duplicate.athlete.fullName} já fez check-in</p>
            <p className="mt-1 text-sm text-amber-400">às {formatTime(duplicate.attendance.checkedInAt)}</p>
            {canUndo && (
              <button
                type="button"
                onClick={() => handleUndo(duplicate.attendance.id)}
                className="mt-3 rounded-lg border border-amber-600 px-4 py-2.5 text-sm font-semibold text-amber-300 hover:bg-amber-900"
              >
                Desfazer este check-in
              </button>
            )}
            <button
              type="button"
              onClick={() => setDuplicate(null)}
              className="mt-3 ml-2 rounded-lg border border-slate-700 px-4 py-2.5 text-sm text-slate-300 hover:bg-slate-800"
            >
              Fechar
            </button>
          </div>
        )}

        <div>
          <input
            ref={searchInputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar por nome, CPF ou número de federação…"
            autoComplete="off"
            className="w-full rounded-xl border border-slate-700 bg-slate-900 px-5 py-4 text-lg text-white placeholder-slate-500 focus:border-blue-600 focus:outline-none"
          />
        </div>

        {error && <p className="text-sm text-red-400">{error}</p>}

        {query.trim().length >= 2 && results.length === 0 && (
          <p className="text-sm text-slate-500">Nenhuma atleta encontrada.</p>
        )}

        <div className="space-y-2">
          {results.map((athlete) => {
            const identity = resolveAthleteIdentity(athlete)
            const category = categoryLabelFor(athlete.id)
            return (
            <div key={athlete.id} className="rounded-xl border border-slate-800 bg-slate-900 p-4">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-lg font-semibold text-white">
                    {athlete.preferredName || athlete.fullName}
                  </p>
                  <p className="truncate text-xs text-slate-400">
                    {identity.label}
                    {athlete.clubName && <> · {athlete.clubName}</>}
                  </p>
                  <p className="truncate text-xs text-slate-600">{category ?? 'Sem inscrição em divisão'}</p>
                </div>
                {confirming?.id === athlete.id ? (
                  <div className="flex shrink-0 gap-2">
                    <button
                      type="button"
                      onClick={() => handleConfirmCheckIn(athlete)}
                      className="rounded-lg bg-emerald-600 px-5 py-3 text-base font-bold text-white hover:bg-emerald-500"
                    >
                      Confirmar
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirming(null)}
                      className="rounded-lg border border-slate-700 px-4 py-3 text-sm text-slate-300 hover:bg-slate-800"
                    >
                      Cancelar
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setConfirming(athlete)}
                    className="shrink-0 rounded-lg bg-blue-600 px-5 py-3 text-base font-semibold text-white hover:bg-blue-500"
                  >
                    Check-in
                  </button>
                )}
              </div>
            </div>
            )
          })}
        </div>

        {recent.length > 0 && query.trim().length < 2 && (
          <section className="pt-4">
            <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">
              Check-ins recentes
            </h2>
            <div className="space-y-1.5">
              {recent.map((r) => (
                <div
                  key={r.id}
                  className="flex items-center justify-between rounded-lg border border-slate-800 bg-slate-900/60 px-4 py-2.5"
                >
                  <span className="truncate text-sm text-slate-300">{r.athleteName}</span>
                  <div className="flex shrink-0 items-center gap-3">
                    <span className="text-xs text-slate-500">{formatTime(r.checkedInAt)}</span>
                    {canUndo && (
                      <button
                        type="button"
                        onClick={() => handleUndo(r.id)}
                        className="text-xs text-red-400 hover:text-red-300"
                      >
                        desfazer
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
    </main>
  )
}
