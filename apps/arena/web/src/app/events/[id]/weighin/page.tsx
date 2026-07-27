'use client'

// Dedicated weigh-in station (per CLAUDE.md diagnosis: weigh-in used to be a
// small widget buried inside a 52-row entries list — unworkable for an
// operator working a queue with the athlete standing right there). Mirrors
// the check-in station's mobile-first shape: big search, one athlete at a
// time, immediate over/under-limit feedback, confirm, auto-advance.
//
// PATCH .../entries/:eid/weighin is transition-based (checked_in ->
// weighed_in only — see EventEntryService.VALID_TRANSITIONS) so this screen
// only ever *records* a fresh weigh-in; there is no "correct a past weigh-in"
// endpoint on the event-entry flow to bypass (the general weight-record
// correction endpoint is a separate, higher-privilege, athlete-level flow —
// out of scope here). The event's overweightPolicy decides automatically
// whether an over-limit reading disqualifies or reallocates the entry to a
// sibling division — this screen just reports the outcome.

import { useCallback, useEffect, useRef, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { hasMinRole, type UserRole } from '@sensei-hub/shared'
import { apiFetch, ApiError, getCurrentRole, isLoggedIn } from '../../../../lib/api'
import { translateApiError } from '../../../../lib/labels'
import { enqueueOfflineWrite } from '../../../../lib/offlineQueue'

interface DivisionDTO {
  id: string
  name: string
  weightLimitKg: number | null
}

interface EntryDTO {
  id: string
  divisionId: string
  confirmedDivisionId?: string
  athleteId: string
  // Resolved server-side by GET /events/:id/entries — the athlete's display
  // name only, nothing else from the athlete registry. weigh_in_operator can
  // read this endpoint but not GET /athletes (full registry: CPF, phone,
  // guardian data), so this is the only source of the name on this screen.
  athleteName?: string
  status: string
  declaredWeightKg?: number
  confirmedWeightKg?: number
}

function weightLimitLabel(weightLimitKg: number | null): string {
  return weightLimitKg === null ? 'categoria aberta — sem limite' : `até ${weightLimitKg}kg`
}

export default function EventWeighInPage() {
  const router = useRouter()
  const params = useParams<{ id: string }>()
  const eventId = params.id

  const [divisions, setDivisions] = useState<DivisionDTO[]>([])
  const [entries, setEntries] = useState<EntryDTO[]>([])
  const [error, setError] = useState<string | null>(null)
  const [canConfirm, setCanConfirm] = useState(false)
  const [query, setQuery] = useState('')
  const [selectedEntryId, setSelectedEntryId] = useState<string | null>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)

  const load = useCallback(async () => {
    try {
      const [divisionsData, entriesData] = await Promise.all([
        apiFetch<DivisionDTO[]>(`/events/${eventId}/divisions`),
        apiFetch<EntryDTO[]>(`/events/${eventId}/entries`),
      ])
      setDivisions(divisionsData)
      setEntries(entriesData)
    } catch {
      setError('Não foi possível carregar a fila de pesagem.')
    }
  }, [eventId])

  useEffect(() => {
    if (!isLoggedIn()) {
      router.replace('/login')
      return
    }
    const role = getCurrentRole()
    if (role === null || !hasMinRole(role as UserRole, 'weigh_in_operator')) {
      router.replace(`/events/${eventId}`)
      return
    }
    // event_manager+ can always confirm; weigh_in_operator gets an explicit
    // exception on the server (see PATCH .../confirm) to close out its own
    // weigh-in flow, so it must see the confirm control too.
    setCanConfirm(hasMinRole(role as UserRole, 'event_manager') || role === 'weigh_in_operator')
    void load()
  }, [router, load, eventId])

  function divisionOf(entry: EntryDTO): DivisionDTO | undefined {
    return divisions.find((d) => d.id === (entry.confirmedDivisionId ?? entry.divisionId))
  }

  function athleteName(entry: EntryDTO): string {
    return entry.athleteName || entry.athleteId
  }

  const pending = entries.filter((e) => e.status === 'checked_in')
  const weighedCount = entries.filter((e) => e.confirmedWeightKg !== undefined).length

  const queryLower = query.trim().toLowerCase()
  const visiblePending =
    queryLower === ''
      ? pending
      : pending.filter((e) => athleteName(e).toLowerCase().includes(queryLower))

  const selectedEntry = selectedEntryId ? entries.find((e) => e.id === selectedEntryId) ?? null : null

  function selectNext() {
    setSelectedEntryId(null)
    setQuery('')
    searchInputRef.current?.focus()
  }

  return (
    <main className="min-h-screen bg-slate-950 px-4 py-6 text-white">
      <div className="mx-auto max-w-xl space-y-5">
        <Link href={`/events/${eventId}`} className="inline-block text-sm text-slate-400 hover:text-slate-200">
          ← Voltar ao evento
        </Link>

        <div className="flex items-center justify-between">
          <h1 className="text-3xl font-bold tracking-tight">Pesagem</h1>
          <span className="rounded-full border border-slate-700 px-3 py-1 text-sm text-slate-300">
            faltam {pending.length} · pesadas {weighedCount}
          </span>
        </div>

        {error && <p className="text-sm text-red-400">{error}</p>}

        {selectedEntry ? (
          <WeighStation
            eventId={eventId}
            entry={selectedEntry}
            division={divisionOf(selectedEntry)}
            allDivisions={divisions}
            athleteName={athleteName(selectedEntry)}
            canConfirm={canConfirm}
            onDone={() => {
              void load()
              selectNext()
            }}
            onCancel={() => setSelectedEntryId(null)}
          />
        ) : (
          <>
            <input
              ref={searchInputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar na fila por nome…"
              autoComplete="off"
              className="w-full rounded-xl border border-slate-700 bg-slate-900 px-5 py-4 text-lg text-white placeholder-slate-500 focus:border-blue-600 focus:outline-none"
            />

            {pending.length === 0 && (
              <p className="text-sm text-slate-500">
                Nenhuma atleta aguardando pesagem — o check-in precisa ser feito antes de pesar.
              </p>
            )}
            {pending.length > 0 && visiblePending.length === 0 && (
              <p className="text-sm text-slate-500">Nenhuma atleta na fila com esse nome.</p>
            )}

            <div className="space-y-2">
              {visiblePending.map((entry) => {
                const division = divisionOf(entry)
                return (
                  <button
                    key={entry.id}
                    type="button"
                    onClick={() => setSelectedEntryId(entry.id)}
                    className="flex w-full items-center justify-between gap-3 rounded-xl border border-slate-800 bg-slate-900 p-4 text-left hover:border-slate-700"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-lg font-semibold text-white">{athleteName(entry)}</p>
                      <p className="truncate text-sm text-slate-500">
                        {division?.name ?? entry.divisionId} · {weightLimitLabel(division?.weightLimitKg ?? null)}
                      </p>
                    </div>
                    <span className="shrink-0 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white">Pesar</span>
                  </button>
                )
              })}
            </div>
          </>
        )}
      </div>
    </main>
  )
}

function WeighStation({
  eventId,
  entry,
  division,
  allDivisions,
  athleteName,
  canConfirm,
  onDone,
  onCancel,
}: {
  eventId: string
  entry: EntryDTO
  division: DivisionDTO | undefined
  allDivisions: DivisionDTO[]
  athleteName: string
  canConfirm: boolean
  onDone: () => void
  onCancel: () => void
}) {
  const [weightValue, setWeightValue] = useState(entry.declaredWeightKg ? String(entry.declaredWeightKg) : '')
  const [readingScale, setReadingScale] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<{
    outcome: 'ok' | 'reallocated' | 'disqualified'
    entry: EntryDTO
    offline: boolean
  } | null>(null)
  const [confirmDivisionId, setConfirmDivisionId] = useState('')
  const [confirmLoading, setConfirmLoading] = useState(false)
  const [confirmError, setConfirmError] = useState<string | null>(null)
  const [confirmed, setConfirmed] = useState(false)

  const parsedWeight = Number(weightValue.replace(',', '.'))
  const hasValidWeight = weightValue.trim() !== '' && !Number.isNaN(parsedWeight) && parsedWeight > 0
  const limitKg = division?.weightLimitKg ?? null
  const overLimit = hasValidWeight && limitKg !== null && parsedWeight > limitKg

  async function handleReadScale() {
    setReadingScale(true)
    try {
      const reading = await apiFetch<{ connected: boolean; reading: { weightKg: number } | null }>('/scale/reading')
      if (reading.reading) setWeightValue(String(reading.reading.weightKg))
      // No reading / disconnected: leave the field as-is — manual entry is
      // never blocked by hardware (CLAUDE.md integration rule).
    } catch {
      // hardware failure must never block manual entry — fail silently
    } finally {
      setReadingScale(false)
    }
  }

  async function handleConfirmWeight() {
    if (!hasValidWeight) return
    setLoading(true)
    setError(null)
    try {
      const updated = await apiFetch<EntryDTO & { outcome: 'ok' | 'reallocated' | 'disqualified' }>(
        `/events/${eventId}/entries/${entry.id}/weighin`,
        { method: 'PATCH', body: JSON.stringify({ weightKg: parsedWeight }) },
      )
      setResult({ outcome: updated.outcome, entry: updated, offline: false })
      setConfirmDivisionId(updated.confirmedDivisionId ?? updated.divisionId)
    } catch (err) {
      if (!(err instanceof ApiError)) {
        // Network down, not a business-rule rejection — queue it so the
        // operator isn't blocked by bad gym WiFi (CLAUDE.md resilience).
        await enqueueOfflineWrite({
          path: `/events/${eventId}/entries/${entry.id}/weighin`,
          method: 'PATCH',
          body: { weightKg: parsedWeight },
          description: `Pesagem: ${athleteName} (${parsedWeight}kg)`,
        })
        setResult({ outcome: 'ok', entry, offline: true })
      } else {
        setError(translateApiError(err.message))
      }
    } finally {
      setLoading(false)
    }
  }

  async function handleConfirmDivision() {
    if (!confirmDivisionId) return
    setConfirmLoading(true)
    setConfirmError(null)
    try {
      await apiFetch(`/events/${eventId}/entries/${entry.id}/confirm`, {
        method: 'PATCH',
        body: JSON.stringify({ confirmedDivisionId: confirmDivisionId }),
      })
      setConfirmed(true)
    } catch (err) {
      setConfirmError(err instanceof ApiError ? translateApiError(err.message) : 'Não foi possível confirmar a categoria.')
    } finally {
      setConfirmLoading(false)
    }
  }

  if (result) {
    return (
      <div className="space-y-3 rounded-xl border-2 border-emerald-700 bg-emerald-950/40 p-5">
        <p className="text-xl font-bold text-emerald-300">{athleteName}</p>
        {result.offline ? (
          <p className="text-sm text-amber-400">
            Sem conexão — pesagem salva neste aparelho, vai sincronizar automaticamente. A confirmação de categoria
            fica disponível depois da sincronização.
          </p>
        ) : (
          <>
            <p className="text-sm text-emerald-400">Peso registrado: {result.entry.confirmedWeightKg}kg</p>
            {result.outcome === 'reallocated' && (
              <p className="text-sm text-amber-400">
                Peso acima do limite: atleta realocada automaticamente para a categoria correta.
              </p>
            )}
            {result.outcome === 'disqualified' && (
              <p className="text-sm text-red-400">Peso acima do limite: atleta desclassificada desta divisão.</p>
            )}

            {result.outcome !== 'disqualified' &&
              (canConfirm ? (
                confirmed ? (
                  <p className="text-sm text-emerald-400">Categoria confirmada.</p>
                ) : (
                  <div className="space-y-2 border-t border-emerald-800 pt-3">
                    <p className="text-sm text-slate-300">Confirmar categoria agora:</p>
                    <div className="flex flex-wrap items-center gap-2">
                      <select
                        value={confirmDivisionId}
                        onChange={(e) => setConfirmDivisionId(e.target.value)}
                        className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white"
                      >
                        {allDivisions.map((d) => (
                          <option key={d.id} value={d.id}>
                            {d.name}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        onClick={handleConfirmDivision}
                        disabled={confirmLoading}
                        className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-500 disabled:opacity-60"
                      >
                        Confirmar nesta divisão
                      </button>
                    </div>
                    {confirmError && <p className="text-sm text-red-400">{confirmError}</p>}
                  </div>
                )
              ) : (
                <p className="text-sm text-slate-400">Aguardando confirmação da categoria por um gestor do evento.</p>
              ))}
          </>
        )}

        <button
          type="button"
          onClick={onDone}
          className="w-full rounded-lg bg-emerald-700 px-4 py-3 text-base font-bold text-white hover:bg-emerald-600"
        >
          Próxima atleta →
        </button>
      </div>
    )
  }

  return (
    <div className="space-y-4 rounded-xl border border-slate-800 bg-slate-900 p-5">
      <div>
        <p className="text-2xl font-bold text-white">{athleteName}</p>
        <p className="text-sm text-slate-400">
          {division?.name ?? entry.divisionId} · {weightLimitLabel(limitKg)}
        </p>
        {entry.declaredWeightKg !== undefined && (
          <p className="text-xs text-slate-500">Peso declarado na inscrição: {entry.declaredWeightKg}kg</p>
        )}
      </div>

      <div>
        <label className="mb-1 block text-xs text-slate-500">Peso (kg)</label>
        <div className="flex items-center gap-2">
          <input
            type="number"
            step="0.1"
            autoFocus
            value={weightValue}
            onChange={(e) => setWeightValue(e.target.value)}
            placeholder="kg"
            className="w-32 rounded-xl border border-slate-700 bg-slate-800 px-4 py-3 text-2xl text-white placeholder-slate-500 focus:border-blue-600 focus:outline-none"
          />
          <button
            type="button"
            onClick={handleReadScale}
            disabled={readingScale}
            title="Ler peso da balança conectada (só preenche — confirme manualmente)"
            className="rounded-lg border border-slate-700 px-3 py-2 text-sm text-slate-300 hover:bg-slate-800 disabled:opacity-60"
          >
            {readingScale ? 'Lendo…' : '⚖ Ler balança'}
          </button>
        </div>
        {hasValidWeight && (
          <p className={`mt-2 text-sm font-medium ${overLimit ? 'text-red-400' : 'text-emerald-400'}`}>
            {limitKg === null
              ? 'Categoria aberta — sem limite de peso.'
              : overLimit
                ? `Acima do limite (${limitKg}kg) — a política do evento decide o resultado ao confirmar.`
                : `Dentro do limite (até ${limitKg}kg).`}
          </p>
        )}
      </div>

      {error && <p className="text-sm text-red-400">{error}</p>}

      <div className="flex gap-2">
        <button
          type="button"
          onClick={handleConfirmWeight}
          disabled={!hasValidWeight || loading}
          className="flex-1 rounded-lg bg-blue-600 px-4 py-3 text-base font-bold text-white hover:bg-blue-500 disabled:opacity-60"
        >
          {loading ? 'Salvando…' : 'Confirmar peso'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-lg border border-slate-700 px-4 py-3 text-sm text-slate-300 hover:bg-slate-800"
        >
          Cancelar
        </button>
      </div>
    </div>
  )
}
