'use client'

// Mobile-first check-in station (Fase 5, extended with an operator panorama —
// see CLAUDE.md "Mobile Check-In" and "UI Principles": fast search, few
// clicks, large controls, mistake recovery). Search filters the full
// /athletes roster client-side by name/CPF/federationNumber/zempoNumber
// (see the offline-resilience note below) rather than inventing a new
// endpoint. QR/short-code scanning hardware is out of scope for this pass —
// the `method` enum reserves the values, but only staff-assisted search and
// staff-assisted list check-in exist today (both persisted as method
// 'staff_search' — same actor doing the same kind of identification, just via
// typed search or by browsing the roster below).
//
// Same-name disambiguation: two athletes can share a name (even a full
// name, in the same academy) — each result row shows an identifier
// resolved by resolveAthleteIdentity (see lib/athleteIdentity.ts), plus the
// division(s) the athlete is entered in for this event and their academy,
// so the operator isn't guessing which "Alice" to check in.
//
// Panorama (progress / pendentes / chegaram / filtros): a door operator
// needs to answer "quantos faltam?", "quem falta?" and "faltou alguém da
// minha academia?" without typing anything. Those answers are built from
// data this screen already loads — GET /events/:id/entries (the event
// roster, one row per division entry, uncapped — see EventEntryService) and
// GET /events/:id/checkin?status=active (who has arrived, also uncapped) —
// joined client-side with the athlete registry already in memory. No new
// server endpoint or server-side field was needed: entries already carries
// a server-resolved athleteName/athleteIdentity (EventEntryService's
// existing minimal-DTO precedent), which doubles as a fallback so the
// pendentes/chegaram lists stay correct even for an academy whose athlete
// count exceeds the /athletes page cap (see the cap-visibility note below).
// "Já pesou" is shown as a badge on the Chegaram tab (derived from each
// entry's status reaching weighed_in/confirmed) rather than a dedicated
// filter: weigh-in only happens after check-in (VALID_TRANSITIONS in
// EventEntryService), so nobody in Faltam is ever weighed, and a whole
// extra filter control for a badge-sized piece of information would be the
// "dense admin screen" CLAUDE.md tells us to avoid on an operation screen.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
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

// Minimal slice of EventEntry — enough to label which categories this
// athlete is entered in at this event, and to build the pendentes/chegaram
// panorama even for an athlete this screen's local /athletes cache doesn't
// have (see athleteName/athleteIdentity below — both resolved server-side
// by EventEntryService, never raw CPF/phone/guardian data).
interface EntryListItem {
  athleteId: string
  divisionId: string
  status: string
  athleteName?: string
  athleteIdentity?: string
}

interface AttendanceDTO {
  id: string
  athleteId: string
  method: string
  status: 'active' | 'revoked'
  checkedInAt: string
  entriesUpdated: number
}

// Common shape both a search result (AthleteListItem) and a roster row
// (built from entries, which may not have a matching /athletes record
// loaded) can be reduced to for the check-in action itself.
interface CheckInTarget {
  id: string
  fullName: string
}

interface RosterRow {
  athleteId: string
  displayName: string
  identityLabel: string
  clubName?: string
  divisionLabel: string
  divisionIds: string[]
  weighed: boolean
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
  const [athletesTotal, setAthletesTotal] = useState<number | null>(null)
  const [divisionsById, setDivisionsById] = useState<Map<string, DivisionListItem>>(new Map())
  const [entriesByAthleteId, setEntriesByAthleteId] = useState<Map<string, EntryListItem[]>>(new Map())
  const [attendance, setAttendance] = useState<AttendanceDTO[]>([])
  const [results, setResults] = useState<AthleteListItem[]>([])
  const [error, setError] = useState<string | null>(null)
  const [confirming, setConfirming] = useState<CheckInTarget | null>(null)
  const [success, setSuccess] = useState<{ athlete: CheckInTarget; attendance: AttendanceDTO | null } | null>(null)
  const [duplicate, setDuplicate] = useState<{ athlete: CheckInTarget; attendance: AttendanceDTO } | null>(null)
  const [canUndo, setCanUndo] = useState(false)
  const [tab, setTab] = useState<'faltam' | 'chegaram'>('faltam')
  const [clubFilter, setClubFilter] = useState('')
  const [divisionFilter, setDivisionFilter] = useState('')
  const searchInputRef = useRef<HTMLInputElement>(null)

  // Loaded once (not re-fetched per keystroke) and searched client-side —
  // deliberate for offline resilience: a fresh `?q=` request per search term
  // would almost never be a cache hit (Cache Storage keys are exact URLs),
  // so a door operator losing connectivity mid-shift couldn't find anyone
  // they hadn't already searched for. Loading the full roster once (while
  // online) primes the service worker's read cache (src/app/sw.ts) for the
  // whole list, and everything after that is a local, instant, offline-safe
  // filter — the CLAUDE.md "fast search" UI principle plus real offline use.
  // Divisions/entries/attendance are fetched the same way (also cached — see
  // src/app/sw.ts's read-cache regex, which already covers
  // /api/events/:id/{divisions,entries,checkin}) purely to label results and
  // build the panorama — nothing here asks the server for anything beyond
  // what this screen was already fetching.
  //
  // /athletes is paginated server-side (CompetitorService caps pageSize at
  // 100) — with more academy athletes than that, this screen's local search
  // index would silently miss some. `athletesTotal` (the server's real
  // count) vs `allAthletes.length` (what actually got loaded) is compared
  // below so the operator is told when that happens, instead of a search
  // just quietly coming up empty.
  const loadRoster = useCallback(async () => {
    try {
      const [attendanceData, athletesData, divisions, entries] = await Promise.all([
        apiFetch<AttendanceDTO[]>(`/events/${eventId}/checkin?status=active`),
        apiFetch<{ items: AthleteListItem[]; total: number }>('/athletes?pageSize=500'),
        apiFetch<DivisionListItem[]>(`/events/${eventId}/divisions`),
        apiFetch<EntryListItem[]>(`/events/${eventId}/entries`),
      ])
      setAttendance(attendanceData)
      setAllAthletes(athletesData.items)
      setAthletesTotal(athletesData.total)
      setDivisionsById(new Map(divisions.map((d) => [d.id, d])))
      const byAthlete = new Map<string, EntryListItem[]>()
      for (const entry of entries) {
        if (entry.status === 'withdrawn') continue
        const list = byAthlete.get(entry.athleteId) ?? []
        list.push(entry)
        byAthlete.set(entry.athleteId, list)
      }
      setEntriesByAthleteId(byAthlete)
    } catch {
      // non-fatal — the panorama is a convenience on top of the primary
      // search-and-confirm flow, which keeps working even if this fails
    }
  }, [eventId])

  useEffect(() => {
    if (!isLoggedIn()) {
      router.replace('/login')
      return
    }
    const role = getCurrentRole()
    setCanUndo(role !== null && hasMinRole(role as UserRole, 'event_manager'))
    void loadRoster()
    searchInputRef.current?.focus()
  }, [router, loadRoster])

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

  const athletesById = useMemo(() => new Map(allAthletes.map((a) => [a.id, a])), [allAthletes])
  const attendanceByAthleteId = useMemo(() => new Map(attendance.map((a) => [a.athleteId, a])), [attendance])

  // The event roster: one row per athlete with a live (non-withdrawn) entry
  // in this event, regardless of whether that athlete happens to be in the
  // capped /athletes page — the name/identity fall back to what
  // GET /entries already resolved server-side.
  const roster = useMemo<RosterRow[]>(() => {
    const rows: RosterRow[] = []
    for (const [athleteId, entries] of entriesByAthleteId) {
      const athlete = athletesById.get(athleteId)
      const first = entries[0]
      const identityLabel = athlete ? resolveAthleteIdentity(athlete).label : (first?.athleteIdentity ?? '—')
      const divisionNames = entries
        .map((e) => divisionsById.get(e.divisionId)?.name)
        .filter((n): n is string => Boolean(n))
      rows.push({
        athleteId,
        displayName: athlete?.preferredName || athlete?.fullName || first?.athleteName || athleteId,
        identityLabel,
        ...(athlete?.clubName !== undefined ? { clubName: athlete.clubName } : {}),
        divisionLabel: divisionNames.length > 0 ? divisionNames.join(' · ') : 'Sem divisão',
        divisionIds: entries.map((e) => e.divisionId),
        weighed: entries.some((e) => e.status === 'weighed_in' || e.status === 'confirmed'),
      })
    }
    return rows
  }, [entriesByAthleteId, athletesById, divisionsById])

  const clubOptions = useMemo(() => {
    const set = new Set<string>()
    for (const r of roster) {
      if (r.clubName) set.add(r.clubName)
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'pt-BR'))
  }, [roster])

  const divisionOptions = useMemo(() => {
    const ids = new Set<string>()
    for (const entries of entriesByAthleteId.values()) {
      for (const e of entries) ids.add(e.divisionId)
    }
    return Array.from(ids)
      .map((id) => divisionsById.get(id))
      .filter((d): d is DivisionListItem => Boolean(d))
      .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'))
  }, [entriesByAthleteId, divisionsById])

  const filteredRoster = useMemo(
    () =>
      roster.filter(
        (r) =>
          (clubFilter === '' || r.clubName === clubFilter) &&
          (divisionFilter === '' || r.divisionIds.includes(divisionFilter)),
      ),
    [roster, clubFilter, divisionFilter],
  )

  const pendingList = useMemo(
    () =>
      filteredRoster
        .filter((r) => !attendanceByAthleteId.has(r.athleteId))
        .sort((a, b) => a.displayName.localeCompare(b.displayName, 'pt-BR')),
    [filteredRoster, attendanceByAthleteId],
  )

  const arrivedList = useMemo(() => {
    return filteredRoster
      .filter((r) => attendanceByAthleteId.has(r.athleteId))
      .map((r) => ({ row: r, attendance: attendanceByAthleteId.get(r.athleteId)! }))
      .sort((a, b) => new Date(b.attendance.checkedInAt).getTime() - new Date(a.attendance.checkedInAt).getTime())
  }, [filteredRoster, attendanceByAthleteId])

  const totalArrivedUnfiltered = useMemo(
    () => roster.filter((r) => attendanceByAthleteId.has(r.athleteId)).length,
    [roster, attendanceByAthleteId],
  )
  const filtersActive = clubFilter !== '' || divisionFilter !== ''

  async function handleConfirmCheckIn(target: CheckInTarget) {
    setError(null)
    setDuplicate(null)
    try {
      const attendanceRecord = await apiFetch<AttendanceDTO>(`/events/${eventId}/checkin`, {
        method: 'POST',
        body: JSON.stringify({ athleteId: target.id, method: 'staff_search' }),
      })
      setSuccess({ athlete: target, attendance: attendanceRecord })
      setConfirming(null)
      setQuery('')
      setResults([])
      void loadRoster()
      searchInputRef.current?.focus()
      setTimeout(() => setSuccess(null), 3500)
    } catch (err) {
      if (err instanceof ApiError && err.status === 409 && err.details) {
        setDuplicate({ athlete: target, attendance: err.details as AttendanceDTO })
        setConfirming(null)
      } else if (!(err instanceof ApiError)) {
        // fetch() itself failed (no ApiError was thrown) — the network is
        // down, not a business-rule rejection. Queue it: the operator at
        // the door shouldn't be blocked by bad gym WiFi (CLAUDE.md —
        // Offline and Resilience: "safe retry", "no silent data loss").
        await enqueueOfflineWrite({
          path: `/events/${eventId}/checkin`,
          method: 'POST',
          body: { athleteId: target.id, method: 'staff_search' },
          description: `Check-in: ${target.fullName}`,
        })
        setSuccess({ athlete: target, attendance: null })
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
      void loadRoster()
    } catch (err) {
      setError(err instanceof ApiError ? translateApiError(err.message) : 'Não foi possível desfazer o check-in.')
    }
  }

  const browsing = query.trim().length < 2

  return (
    <main className="min-h-screen bg-slate-950 px-4 py-6 text-white">
      <div className="mx-auto max-w-xl space-y-5">
        <Link href={`/events/${eventId}`} className="inline-block text-sm text-slate-400 hover:text-slate-200">
          ← Voltar ao evento
        </Link>

        <h1 className="text-3xl font-bold tracking-tight">Check-in</h1>

        {roster.length > 0 && (
          <div className="rounded-xl border border-slate-800 bg-slate-900 p-4">
            <div className="flex items-baseline justify-between gap-3">
              <p className="text-2xl font-bold text-white">
                {arrivedList.length} de {filteredRoster.length} chegaram
              </p>
              <p className="shrink-0 text-sm font-semibold text-amber-400">faltam {pendingList.length}</p>
            </div>
            <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-slate-800">
              <div
                className="h-full rounded-full bg-emerald-600"
                style={{
                  width: `${filteredRoster.length > 0 ? Math.round((arrivedList.length / filteredRoster.length) * 100) : 0}%`,
                }}
              />
            </div>
            {filtersActive && (
              <p className="mt-2 text-xs text-slate-500">
                Evento todo: {totalArrivedUnfiltered} de {roster.length} chegaram
              </p>
            )}
          </div>
        )}

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
          {athletesTotal !== null && athletesTotal > allAthletes.length && (
            <p className="mt-2 text-xs text-amber-400">
              Busca cobre {allAthletes.length} de {athletesTotal} atletas da academia. Se não encontrar por nome, veja
              a lista de pendentes abaixo — ela cobre todas as inscrições deste evento.
            </p>
          )}
        </div>

        {error && <p className="text-sm text-red-400">{error}</p>}

        {!browsing && (
          <>
            {results.length === 0 && <p className="text-sm text-slate-500">Nenhuma atleta encontrada.</p>}
            <div className="space-y-2">
              {results.map((athlete) => {
                const identity = resolveAthleteIdentity(athlete)
                const category = categoryLabelFor(athlete.id)
                const target: CheckInTarget = { id: athlete.id, fullName: athlete.preferredName || athlete.fullName }
                return (
                  <CheckInRow
                    key={athlete.id}
                    target={target}
                    line1={`${identity.label}${athlete.clubName ? ` · ${athlete.clubName}` : ''}`}
                    line2={category ?? 'Sem inscrição em divisão'}
                    armed={confirming?.id === athlete.id}
                    onArm={() => setConfirming(target)}
                    onConfirm={() => handleConfirmCheckIn(target)}
                    onCancel={() => setConfirming(null)}
                  />
                )
              })}
            </div>
          </>
        )}

        {browsing && roster.length === 0 && (
          <p className="text-sm text-slate-500">Nenhuma atleta inscrita neste evento ainda.</p>
        )}

        {browsing && roster.length > 0 && (
          <>
            <div className="flex flex-wrap gap-2">
              <select
                value={clubFilter}
                onChange={(e) => setClubFilter(e.target.value)}
                className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-2.5 text-sm text-white"
              >
                <option value="">Todas as academias</option>
                {clubOptions.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
              <select
                value={divisionFilter}
                onChange={(e) => setDivisionFilter(e.target.value)}
                className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-2.5 text-sm text-white"
              >
                <option value="">Todas as divisões</option>
                {divisionOptions.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setTab('faltam')}
                className={`flex-1 rounded-lg px-4 py-3 text-base font-semibold ${
                  tab === 'faltam' ? 'bg-blue-600 text-white' : 'border border-slate-700 text-slate-300'
                }`}
              >
                Faltam ({pendingList.length})
              </button>
              <button
                type="button"
                onClick={() => setTab('chegaram')}
                className={`flex-1 rounded-lg px-4 py-3 text-base font-semibold ${
                  tab === 'chegaram' ? 'bg-blue-600 text-white' : 'border border-slate-700 text-slate-300'
                }`}
              >
                Chegaram ({arrivedList.length})
              </button>
            </div>

            {tab === 'faltam' && (
              <div className="space-y-2">
                {pendingList.length === 0 && (
                  <p className="text-sm text-slate-500">
                    {filtersActive ? 'Ninguém pendente com esse filtro.' : 'Todo mundo já chegou.'}
                  </p>
                )}
                {pendingList.map((r) => {
                  const target: CheckInTarget = { id: r.athleteId, fullName: r.displayName }
                  return (
                    <CheckInRow
                      key={r.athleteId}
                      target={target}
                      line1={`${r.identityLabel}${r.clubName ? ` · ${r.clubName}` : ''}`}
                      line2={r.divisionLabel}
                      armed={confirming?.id === r.athleteId}
                      onArm={() => setConfirming(target)}
                      onConfirm={() => handleConfirmCheckIn(target)}
                      onCancel={() => setConfirming(null)}
                    />
                  )
                })}
              </div>
            )}

            {tab === 'chegaram' && (
              <div className="space-y-2">
                {arrivedList.length === 0 && (
                  <p className="text-sm text-slate-500">
                    {filtersActive ? 'Ninguém chegou com esse filtro ainda.' : 'Ninguém chegou ainda.'}
                  </p>
                )}
                {arrivedList.map(({ row, attendance: a }) => (
                  <div key={row.athleteId} className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-base font-semibold text-white">{row.displayName}</p>
                        <p className="truncate text-xs text-slate-400">
                          {row.identityLabel}
                          {row.clubName && <> · {row.clubName}</>}
                        </p>
                        <p className="truncate text-xs text-slate-600">{row.divisionLabel}</p>
                      </div>
                      <div className="flex shrink-0 flex-col items-end gap-1.5">
                        <span className="text-xs text-slate-500">{formatTime(a.checkedInAt)}</span>
                        {row.weighed && (
                          <span className="rounded-full border border-emerald-700 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-400">
                            pesado
                          </span>
                        )}
                        {canUndo && (
                          <button
                            type="button"
                            onClick={() => handleUndo(a.id)}
                            className="text-xs text-red-400 hover:text-red-300"
                          >
                            desfazer
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </main>
  )
}

// Shared row for both the search results and the "Faltam" roster list — one
// tap arms the row (per CLAUDE.md "mistake recovery": no accidental
// check-in from a single fat-finger tap), a second tap on "Confirmar"
// commits it. Large touch targets throughout (mobile-first, per CLAUDE.md
// UI principles).
function CheckInRow({
  target,
  line1,
  line2,
  armed,
  onArm,
  onConfirm,
  onCancel,
}: {
  target: CheckInTarget
  line1: string
  line2?: string
  armed: boolean
  onArm: () => void
  onConfirm: () => void
  onCancel: () => void
}) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900 p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-lg font-semibold text-white">{target.fullName}</p>
          <p className="truncate text-xs text-slate-400">{line1}</p>
          {line2 && <p className="truncate text-xs text-slate-600">{line2}</p>}
        </div>
        {armed ? (
          <div className="flex shrink-0 gap-2">
            <button
              type="button"
              onClick={onConfirm}
              className="rounded-lg bg-emerald-600 px-5 py-3 text-base font-bold text-white hover:bg-emerald-500"
            >
              Confirmar
            </button>
            <button
              type="button"
              onClick={onCancel}
              className="rounded-lg border border-slate-700 px-4 py-3 text-sm text-slate-300 hover:bg-slate-800"
            >
              Cancelar
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={onArm}
            className="shrink-0 rounded-lg bg-blue-600 px-5 py-3 text-base font-semibold text-white hover:bg-blue-500"
          >
            Check-in
          </button>
        )}
      </div>
    </div>
  )
}
