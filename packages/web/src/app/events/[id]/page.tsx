'use client'

import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { hasMinRole, type UserRole } from '@sensei-hub/shared'
import { apiFetch, ApiError, getCurrentRole, isLoggedIn } from '../../../lib/api'
import {
  EVENT_ENTRY_STATUS_LABELS,
  EVENT_STATUS_LABELS,
  EVENT_STATUS_OPTIONS,
  formatDate,
  translateApiError,
} from '../../../lib/labels'

interface EventDTO {
  id: string
  name: string
  description?: string
  eventDate: string
  venue?: string
  status: string
}

interface DivisionDTO {
  id: string
  name: string
  minAge: number | null
  maxAge: number | null
  weightLimitKg: number | null
  sourceTemplateKey?: string
}

function ageRangeLabel(minAge: number | null, maxAge: number | null): string {
  if (minAge === null && maxAge === null) return 'sem restrição de idade'
  if (maxAge === null) return `${minAge}+ anos`
  if (minAge === null) return `até ${maxAge} anos`
  return `${minAge}–${maxAge} anos`
}

function weightLabel(weightLimitKg: number | null): string {
  return weightLimitKg === null ? 'aberta' : `até ${weightLimitKg}kg`
}

export default function EventDetailPage() {
  const router = useRouter()
  const params = useParams<{ id: string }>()
  const eventId = params.id

  const [event, setEvent] = useState<EventDTO | null>(null)
  const [divisions, setDivisions] = useState<DivisionDTO[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [canManage, setCanManage] = useState(false)
  const [canOperate, setCanOperate] = useState(false)
  const [canWeighIn, setCanWeighIn] = useState(false)

  const load = useCallback(async () => {
    try {
      const [eventData, divisionsData] = await Promise.all([
        apiFetch<EventDTO>(`/events/${eventId}`),
        apiFetch<DivisionDTO[]>(`/events/${eventId}/divisions`),
      ])
      setEvent(eventData)
      setDivisions(divisionsData)
    } catch {
      setError('Não foi possível carregar o evento.')
    }
  }, [eventId])

  useEffect(() => {
    if (!isLoggedIn()) {
      router.replace('/login')
      return
    }
    const role = getCurrentRole()
    setCanManage(role !== null && hasMinRole(role as UserRole, 'event_manager'))
    setCanOperate(role !== null && hasMinRole(role as UserRole, 'staff'))
    setCanWeighIn(role !== null && hasMinRole(role as UserRole, 'weigh_in_operator'))
    void load()
  }, [router, load])

  if (error) {
    return (
      <main className="min-h-screen bg-slate-950 px-4 py-8 text-white">
        <p className="text-red-300">{error}</p>
      </main>
    )
  }

  if (!event || !divisions) {
    return (
      <main className="min-h-screen bg-slate-950 px-4 py-8 text-white">
        <p className="text-slate-400">Carregando…</p>
      </main>
    )
  }

  return (
    <main className="min-h-screen bg-slate-950 px-4 py-8 text-white">
      <div className="mx-auto max-w-3xl space-y-8">
        <Link href="/events" className="inline-block text-sm text-slate-400 hover:text-slate-200">
          ← Voltar
        </Link>

        <EventHeader event={event} canManage={canManage} onChanged={load} />

        <DivisionsSection eventId={eventId} divisions={divisions} canManage={canManage} onChanged={load} />

        <EntriesSection
          eventId={eventId}
          divisions={divisions}
          canManage={canManage}
          canOperate={canOperate}
          canWeighIn={canWeighIn}
        />
      </div>
    </main>
  )
}

function EventHeader({ event, canManage, onChanged }: { event: EventDTO; canManage: boolean; onChanged: () => void }) {
  const [name, setName] = useState(event.name)
  const [eventDate, setEventDate] = useState(event.eventDate)
  const [venue, setVenue] = useState(event.venue ?? '')
  const [status, setStatus] = useState(event.status)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSave() {
    setLoading(true)
    setError(null)
    try {
      await apiFetch(`/events/${event.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ name, eventDate, venue: venue || undefined, status }),
      })
      onChanged()
    } catch (err) {
      setError(err instanceof ApiError ? translateApiError(err.message) : 'Não foi possível salvar.')
    } finally {
      setLoading(false)
    }
  }

  if (!canManage) {
    return (
      <section className="rounded-lg border border-slate-800 bg-slate-900 p-4">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold tracking-tight">{event.name}</h1>
          <span className="rounded-full border border-slate-700 px-3 py-1 text-xs font-medium text-slate-300">
            {EVENT_STATUS_LABELS[event.status] ?? event.status}
          </span>
        </div>
        <p className="mt-1 text-sm text-slate-400">
          {formatDate(event.eventDate)}
          {event.venue ? ` · ${event.venue}` : ''}
        </p>
      </section>
    )
  }

  return (
    <section className="rounded-lg border border-slate-800 bg-slate-900 p-4">
      <div className="mb-4 grid gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label className="mb-1 block text-xs text-slate-500">Nome</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-white"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs text-slate-500">Data</label>
          <input
            type="date"
            value={eventDate}
            onChange={(e) => setEventDate(e.target.value)}
            className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-white"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs text-slate-500">Local</label>
          <input
            value={venue}
            onChange={(e) => setVenue(e.target.value)}
            className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-white"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs text-slate-500">Status</label>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-white"
          >
            {EVENT_STATUS_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
      </div>
      {error && <p className="mb-3 text-sm text-red-400">{error}</p>}
      <button
        type="button"
        onClick={handleSave}
        disabled={loading}
        className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-500 disabled:opacity-60"
      >
        Salvar
      </button>
    </section>
  )
}

function DivisionsSection({
  eventId,
  divisions,
  canManage,
  onChanged,
}: {
  eventId: string
  divisions: DivisionDTO[]
  canManage: boolean
  onChanged: () => void
}) {
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [addingDivision, setAddingDivision] = useState(false)

  async function handleImport() {
    setLoading(true)
    setError(null)
    try {
      await apiFetch(`/events/${eventId}/divisions/import-from-templates`, { method: 'POST', body: JSON.stringify({}) })
      onChanged()
    } catch (err) {
      setError(err instanceof ApiError ? translateApiError(err.message) : 'Não foi possível importar.')
    } finally {
      setLoading(false)
    }
  }

  async function handleDelete(divisionId: string, name: string) {
    if (!window.confirm(`Apagar a divisão "${name}"?`)) return
    setError(null)
    try {
      await apiFetch(`/events/${eventId}/divisions/${divisionId}`, { method: 'DELETE' })
      onChanged()
    } catch (err) {
      setError(err instanceof ApiError ? translateApiError(err.message) : 'Não foi possível apagar.')
    }
  }

  return (
    <section>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-lg font-semibold text-white">Divisões</h2>
        {canManage && (
          <div className="flex gap-2">
            <button
              type="button"
              onClick={handleImport}
              disabled={loading}
              className="rounded-lg border border-slate-700 px-3 py-2 text-sm text-slate-300 hover:bg-slate-800 disabled:opacity-60"
            >
              Importar do padrão da academia
            </button>
            <button
              type="button"
              onClick={() => setAddingDivision(true)}
              className="rounded-lg bg-blue-600 px-3 py-2 text-sm font-semibold text-white transition hover:bg-blue-500"
            >
              + Criar divisão
            </button>
          </div>
        )}
      </div>

      {error && <p className="mb-3 text-sm text-red-400">{error}</p>}

      {divisions.length === 0 && !addingDivision && (
        <p className="text-sm text-slate-500">
          Nenhuma divisão ainda. Importe do padrão da academia ou crie manualmente.
        </p>
      )}

      <div className="space-y-2">
        {divisions.map((d) => (
          <DivisionRow key={d.id} eventId={eventId} division={d} canManage={canManage} onChanged={onChanged} onDelete={handleDelete} />
        ))}
      </div>

      {canManage && addingDivision && (
        <NewDivisionForm eventId={eventId} onDone={() => setAddingDivision(false)} onCreated={onChanged} />
      )}
    </section>
  )
}

function DivisionRow({
  eventId,
  division,
  canManage,
  onChanged,
  onDelete,
}: {
  eventId: string
  division: DivisionDTO
  canManage: boolean
  onChanged: () => void
  onDelete: (id: string, name: string) => void
}) {
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(division.name)
  const [minAge, setMinAge] = useState(division.minAge?.toString() ?? '')
  const [maxAge, setMaxAge] = useState(division.maxAge?.toString() ?? '')
  const [weightLimitKg, setWeightLimitKg] = useState(division.weightLimitKg?.toString() ?? '')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSave() {
    setLoading(true)
    setError(null)
    try {
      await apiFetch(`/events/${eventId}/divisions/${division.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          name,
          minAge: minAge.trim() === '' ? null : Number(minAge),
          maxAge: maxAge.trim() === '' ? null : Number(maxAge),
          weightLimitKg: weightLimitKg.trim() === '' ? null : Number(weightLimitKg),
        }),
      })
      setEditing(false)
      onChanged()
    } catch (err) {
      setError(err instanceof ApiError ? translateApiError(err.message) : 'Não foi possível salvar.')
    } finally {
      setLoading(false)
    }
  }

  if (!editing) {
    return (
      <div className="flex items-center justify-between rounded-lg border border-slate-800 bg-slate-900 px-4 py-3">
        <div>
          <p className="font-medium text-white">{division.name}</p>
          <p className="text-sm text-slate-500">
            {ageRangeLabel(division.minAge, division.maxAge)} · {weightLabel(division.weightLimitKg)}
            {division.sourceTemplateKey ? ' · do padrão' : ''}
          </p>
        </div>
        {canManage && (
          <div className="flex shrink-0 gap-2">
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="rounded-lg border border-slate-700 px-3 py-1.5 text-sm text-slate-300 hover:bg-slate-800"
            >
              Editar
            </button>
            <button
              type="button"
              onClick={() => onDelete(division.id, division.name)}
              className="rounded-lg border border-red-900 px-3 py-1.5 text-sm text-red-400 hover:bg-red-950"
            >
              Apagar
            </button>
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900 p-4">
      <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <div className="col-span-2">
          <label className="mb-1 block text-xs text-slate-500">Nome</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs text-slate-500">Idade mín.</label>
          <input
            type="number"
            value={minAge}
            onChange={(e) => setMinAge(e.target.value)}
            placeholder="—"
            className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white placeholder-slate-500"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs text-slate-500">Idade máx.</label>
          <input
            type="number"
            value={maxAge}
            onChange={(e) => setMaxAge(e.target.value)}
            placeholder="sem limite"
            className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white placeholder-slate-500"
          />
        </div>
        <div className="col-span-2 sm:col-span-1">
          <label className="mb-1 block text-xs text-slate-500">Peso limite (kg)</label>
          <input
            type="number"
            value={weightLimitKg}
            onChange={(e) => setWeightLimitKg(e.target.value)}
            placeholder="aberta"
            className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white placeholder-slate-500"
          />
        </div>
      </div>
      {error && <p className="mb-2 text-sm text-red-400">{error}</p>}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={handleSave}
          disabled={loading}
          className="rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-semibold text-white transition hover:bg-blue-500 disabled:opacity-60"
        >
          Salvar
        </button>
        <button
          type="button"
          onClick={() => setEditing(false)}
          className="rounded-lg border border-slate-700 px-3 py-1.5 text-sm text-slate-300 hover:bg-slate-800"
        >
          Cancelar
        </button>
      </div>
    </div>
  )
}

function NewDivisionForm({ eventId, onDone, onCreated }: { eventId: string; onDone: () => void; onCreated: () => void }) {
  const [name, setName] = useState('')
  const [minAge, setMinAge] = useState('')
  const [maxAge, setMaxAge] = useState('')
  const [weightLimitKg, setWeightLimitKg] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setLoading(true)
    setError(null)
    try {
      await apiFetch(`/events/${eventId}/divisions`, {
        method: 'POST',
        body: JSON.stringify({
          name,
          minAge: minAge.trim() === '' ? undefined : Number(minAge),
          maxAge: maxAge.trim() === '' ? undefined : Number(maxAge),
          weightLimitKg: weightLimitKg.trim() === '' ? undefined : Number(weightLimitKg),
        }),
      })
      onCreated()
      onDone()
    } catch (err) {
      setError(err instanceof ApiError ? translateApiError(err.message) : 'Não foi possível criar.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="mt-3 rounded-lg border border-slate-800 bg-slate-900 p-4">
      <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <div className="col-span-2">
          <label className="mb-1 block text-xs text-slate-500">Nome</label>
          <input
            required
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Ex: Adulto Masculino -90kg"
            className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white placeholder-slate-500"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs text-slate-500">Idade mín.</label>
          <input
            type="number"
            value={minAge}
            onChange={(e) => setMinAge(e.target.value)}
            placeholder="—"
            className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white placeholder-slate-500"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs text-slate-500">Idade máx.</label>
          <input
            type="number"
            value={maxAge}
            onChange={(e) => setMaxAge(e.target.value)}
            placeholder="sem limite"
            className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white placeholder-slate-500"
          />
        </div>
        <div className="col-span-2 sm:col-span-1">
          <label className="mb-1 block text-xs text-slate-500">Peso limite (kg)</label>
          <input
            type="number"
            value={weightLimitKg}
            onChange={(e) => setWeightLimitKg(e.target.value)}
            placeholder="aberta"
            className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white placeholder-slate-500"
          />
        </div>
      </div>
      {error && <p className="mb-2 text-sm text-red-400">{error}</p>}
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={loading}
          className="rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-semibold text-white transition hover:bg-blue-500 disabled:opacity-60"
        >
          Criar
        </button>
        <button
          type="button"
          onClick={onDone}
          className="rounded-lg border border-slate-700 px-3 py-1.5 text-sm text-slate-300 hover:bg-slate-800"
        >
          Cancelar
        </button>
      </div>
    </form>
  )
}

interface EntryDTO {
  id: string
  divisionId: string
  athleteId: string
  status: string
  confirmedDivisionId?: string
  declaredWeightKg?: number
  confirmedWeightKg?: number
  withdrawnReason?: string
}

interface AthleteListItem {
  id: string
  fullName: string
  preferredName?: string
}

function EntriesSection({
  eventId,
  divisions,
  canManage,
  canOperate,
  canWeighIn,
}: {
  eventId: string
  divisions: DivisionDTO[]
  canManage: boolean
  canOperate: boolean
  canWeighIn: boolean
}) {
  const [entries, setEntries] = useState<EntryDTO[] | null>(null)
  const [athletes, setAthletes] = useState<Record<string, AthleteListItem>>({})
  const [error, setError] = useState<string | null>(null)
  const [showRegisterForm, setShowRegisterForm] = useState(false)

  const load = useCallback(async () => {
    try {
      const [entriesData, athletesData] = await Promise.all([
        apiFetch<EntryDTO[]>(`/events/${eventId}/entries`),
        apiFetch<{ items: AthleteListItem[] }>('/athletes?pageSize=100'),
      ])
      setEntries(entriesData)
      const map: Record<string, AthleteListItem> = {}
      for (const a of athletesData.items) map[a.id] = a
      setAthletes(map)
    } catch {
      setError('Não foi possível carregar as inscrições.')
    }
  }, [eventId])

  useEffect(() => {
    void load()
  }, [load])

  const divisionById: Record<string, DivisionDTO> = {}
  for (const d of divisions) divisionById[d.id] = d

  function athleteName(athleteId: string): string {
    const athlete = athletes[athleteId]
    if (!athlete) return athleteId
    return athlete.preferredName || athlete.fullName
  }

  return (
    <section>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-lg font-semibold text-white">Inscrições</h2>
        {canOperate && divisions.length > 0 && (
          <button
            type="button"
            onClick={() => setShowRegisterForm((v) => !v)}
            className="rounded-lg bg-blue-600 px-3 py-2 text-sm font-semibold text-white transition hover:bg-blue-500"
          >
            + Inscrever atleta
          </button>
        )}
      </div>

      {error && <p className="mb-3 text-sm text-red-400">{error}</p>}

      {divisions.length === 0 && <p className="text-sm text-slate-500">Crie ao menos uma divisão para inscrever atletas.</p>}

      {canOperate && showRegisterForm && (
        <RegisterEntryForm
          eventId={eventId}
          divisions={divisions}
          onDone={() => setShowRegisterForm(false)}
          onCreated={load}
        />
      )}

      {!entries && <p className="mt-3 text-sm text-slate-400">Carregando…</p>}

      {entries && entries.length === 0 && <p className="mt-3 text-sm text-slate-500">Nenhuma inscrição ainda.</p>}

      {entries && entries.length > 0 && (
        <ul className="mt-3 space-y-2">
          {entries.map((entry) => (
            <EntryRow
              key={entry.id}
              eventId={eventId}
              entry={entry}
              divisionName={
                divisionById[entry.confirmedDivisionId ?? entry.divisionId]?.name ?? entry.divisionId
              }
              athleteName={athleteName(entry.athleteId)}
              divisions={divisions}
              canManage={canManage}
              canOperate={canOperate}
              canWeighIn={canWeighIn}
              onChanged={load}
            />
          ))}
        </ul>
      )}
    </section>
  )
}

function RegisterEntryForm({
  eventId,
  divisions,
  onDone,
  onCreated,
}: {
  eventId: string
  divisions: DivisionDTO[]
  onDone: () => void
  onCreated: () => void
}) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<AthleteListItem[]>([])
  const [selected, setSelected] = useState<AthleteListItem | null>(null)
  const [divisionId, setDivisionId] = useState(divisions[0]?.id ?? '')
  const [declaredWeightKg, setDeclaredWeightKg] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSearch(value: string) {
    setQuery(value)
    setSelected(null)
    if (value.trim().length < 2) {
      setResults([])
      return
    }
    try {
      const data = await apiFetch<{ items: AthleteListItem[] }>(`/athletes?q=${encodeURIComponent(value)}`)
      setResults(data.items)
    } catch {
      setResults([])
    }
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!selected) {
      setError('Selecione uma atleta na busca.')
      return
    }
    setLoading(true)
    setError(null)
    try {
      await apiFetch(`/events/${eventId}/entries`, {
        method: 'POST',
        body: JSON.stringify({
          divisionId,
          athleteId: selected.id,
          declaredWeightKg: declaredWeightKg.trim() === '' ? undefined : Number(declaredWeightKg),
        }),
      })
      onCreated()
      onDone()
    } catch (err) {
      setError(err instanceof ApiError ? translateApiError(err.message) : 'Não foi possível inscrever.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="mb-3 rounded-lg border border-slate-800 bg-slate-900 p-4">
      <div className="mb-3">
        <label className="mb-1 block text-xs text-slate-500">Atleta</label>
        {selected ? (
          <div className="flex items-center justify-between rounded-lg border border-slate-700 bg-slate-800 px-3 py-2">
            <span className="text-white">{selected.preferredName || selected.fullName}</span>
            <button type="button" onClick={() => setSelected(null)} className="text-sm text-slate-400 hover:text-slate-200">
              Trocar
            </button>
          </div>
        ) : (
          <div className="relative">
            <input
              value={query}
              onChange={(e) => void handleSearch(e.target.value)}
              placeholder="Buscar por nome…"
              className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-white placeholder-slate-500"
            />
            {results.length > 0 && (
              <ul className="absolute z-10 mt-1 w-full rounded-lg border border-slate-700 bg-slate-800 shadow-lg">
                {results.map((a) => (
                  <li key={a.id}>
                    <button
                      type="button"
                      onClick={() => {
                        setSelected(a)
                        setResults([])
                      }}
                      className="block w-full px-3 py-2 text-left text-white hover:bg-slate-700"
                    >
                      {a.preferredName || a.fullName}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>

      <div className="mb-3 grid grid-cols-2 gap-2">
        <div>
          <label className="mb-1 block text-xs text-slate-500">Divisão</label>
          <select
            value={divisionId}
            onChange={(e) => setDivisionId(e.target.value)}
            className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-white"
          >
            {divisions.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs text-slate-500">Peso declarado (kg)</label>
          <input
            type="number"
            value={declaredWeightKg}
            onChange={(e) => setDeclaredWeightKg(e.target.value)}
            placeholder="opcional"
            className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-white placeholder-slate-500"
          />
        </div>
      </div>

      {error && <p className="mb-2 text-sm text-red-400">{error}</p>}

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={loading}
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-500 disabled:opacity-60"
        >
          Inscrever
        </button>
        <button
          type="button"
          onClick={onDone}
          className="rounded-lg border border-slate-700 px-3 py-2 text-sm text-slate-300 hover:bg-slate-800"
        >
          Cancelar
        </button>
      </div>
    </form>
  )
}

function EntryRow({
  eventId,
  entry,
  divisionName,
  athleteName,
  divisions,
  canManage,
  canOperate,
  canWeighIn,
  onChanged,
}: {
  eventId: string
  entry: EntryDTO
  divisionName: string
  athleteName: string
  divisions: DivisionDTO[]
  canManage: boolean
  canOperate: boolean
  canWeighIn: boolean
  onChanged: () => void
}) {
  const [weighInValue, setWeighInValue] = useState('')
  const [confirmDivisionId, setConfirmDivisionId] = useState(entry.divisionId)
  const [withdrawReason, setWithdrawReason] = useState('')
  const [showWeighIn, setShowWeighIn] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)
  const [showWithdraw, setShowWithdraw] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function run(action: () => Promise<unknown>) {
    setLoading(true)
    setError(null)
    try {
      await action()
      onChanged()
    } catch (err) {
      setError(err instanceof ApiError ? translateApiError(err.message) : 'Não foi possível concluir a ação.')
    } finally {
      setLoading(false)
    }
  }

  const handleCheckIn = () =>
    run(() => apiFetch(`/events/${eventId}/entries/${entry.id}/checkin`, { method: 'PATCH' }))

  const handleWeighIn = () =>
    run(() =>
      apiFetch(`/events/${eventId}/entries/${entry.id}/weighin`, {
        method: 'PATCH',
        body: JSON.stringify({ weightKg: Number(weighInValue) }),
      }),
    ).then(() => setShowWeighIn(false))

  const handleConfirm = () =>
    run(() =>
      apiFetch(`/events/${eventId}/entries/${entry.id}/confirm`, {
        method: 'PATCH',
        body: JSON.stringify({ confirmedDivisionId: confirmDivisionId }),
      }),
    ).then(() => setShowConfirm(false))

  const handleWithdraw = () =>
    run(() =>
      apiFetch(`/events/${eventId}/entries/${entry.id}/withdraw`, {
        method: 'PATCH',
        body: JSON.stringify({ reason: withdrawReason }),
      }),
    ).then(() => setShowWithdraw(false))

  return (
    <li className="rounded-lg border border-slate-800 bg-slate-900 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="font-medium text-white">{athleteName}</p>
          <p className="text-sm text-slate-500">{divisionName}</p>
        </div>
        <span className="rounded-full border border-slate-700 px-3 py-1 text-xs font-medium text-slate-300">
          {EVENT_ENTRY_STATUS_LABELS[entry.status] ?? entry.status}
        </span>
      </div>

      {entry.confirmedWeightKg !== undefined && (
        <p className="mt-1 text-sm text-slate-400">Pesagem: {entry.confirmedWeightKg}kg</p>
      )}
      {entry.withdrawnReason && <p className="mt-1 text-sm text-amber-400">Retirada: {entry.withdrawnReason}</p>}

      {error && <p className="mt-2 text-sm text-red-400">{error}</p>}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {canOperate && entry.status === 'registered' && (
          <button
            type="button"
            onClick={handleCheckIn}
            disabled={loading}
            className="rounded-lg border border-slate-700 px-3 py-1.5 text-sm text-slate-300 hover:bg-slate-800 disabled:opacity-60"
          >
            Check-in
          </button>
        )}

        {canWeighIn && entry.status === 'checked_in' && !showWeighIn && (
          <button
            type="button"
            onClick={() => setShowWeighIn(true)}
            className="rounded-lg border border-slate-700 px-3 py-1.5 text-sm text-slate-300 hover:bg-slate-800"
          >
            Registrar pesagem
          </button>
        )}
        {canWeighIn && showWeighIn && (
          <div className="flex items-center gap-2">
            <input
              type="number"
              autoFocus
              value={weighInValue}
              onChange={(e) => setWeighInValue(e.target.value)}
              placeholder="kg"
              className="w-24 rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-sm text-white placeholder-slate-500"
            />
            <button
              type="button"
              onClick={handleWeighIn}
              disabled={loading}
              className="rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-blue-500 disabled:opacity-60"
            >
              Confirmar peso
            </button>
            <button
              type="button"
              onClick={() => setShowWeighIn(false)}
              className="text-sm text-slate-400 hover:text-slate-200"
            >
              Cancelar
            </button>
          </div>
        )}

        {canManage && entry.status === 'weighed_in' && !showConfirm && (
          <button
            type="button"
            onClick={() => setShowConfirm(true)}
            className="rounded-lg border border-slate-700 px-3 py-1.5 text-sm text-slate-300 hover:bg-slate-800"
          >
            Confirmar
          </button>
        )}
        {canManage && showConfirm && (
          <div className="flex items-center gap-2">
            <select
              value={confirmDivisionId}
              onChange={(e) => setConfirmDivisionId(e.target.value)}
              className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-sm text-white"
            >
              {divisions.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={handleConfirm}
              disabled={loading}
              className="rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-blue-500 disabled:opacity-60"
            >
              Confirmar nesta divisão
            </button>
            <button
              type="button"
              onClick={() => setShowConfirm(false)}
              className="text-sm text-slate-400 hover:text-slate-200"
            >
              Cancelar
            </button>
          </div>
        )}

        {canManage && entry.status !== 'withdrawn' && !showWithdraw && (
          <button
            type="button"
            onClick={() => setShowWithdraw(true)}
            className="rounded-lg border border-red-900 px-3 py-1.5 text-sm text-red-400 hover:bg-red-950"
          >
            Retirar
          </button>
        )}
        {canManage && showWithdraw && (
          <div className="flex items-center gap-2">
            <input
              autoFocus
              value={withdrawReason}
              onChange={(e) => setWithdrawReason(e.target.value)}
              placeholder="Motivo"
              className="w-40 rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-sm text-white placeholder-slate-500"
            />
            <button
              type="button"
              onClick={handleWithdraw}
              disabled={loading || withdrawReason.trim().length < 3}
              className="rounded-lg bg-red-700 px-3 py-1.5 text-sm font-semibold text-white hover:bg-red-600 disabled:opacity-60"
            >
              Confirmar retirada
            </button>
            <button
              type="button"
              onClick={() => setShowWithdraw(false)}
              className="text-sm text-slate-400 hover:text-slate-200"
            >
              Cancelar
            </button>
          </div>
        )}
      </div>
    </li>
  )
}
