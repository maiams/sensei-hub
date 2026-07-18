'use client'

import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { hasMinRole, type UserRole } from '@sensei-hub/shared'
import { apiFetch, ApiError, getAccessToken, getCurrentRole, isLoggedIn } from '../../../lib/api'
import { enqueueOfflineWrite } from '../../../lib/offlineQueue'
import {
  EVENT_ENTRY_STATUS_LABELS,
  EVENT_STATUS_LABELS,
  EVENT_STATUS_OPTIONS,
  OVERWEIGHT_POLICY_LABELS,
  OVERWEIGHT_POLICY_OPTIONS,
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
  overweightPolicy: string
  publicHideNamesUnderAge?: number | null
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
  const [canCloseArea, setCanCloseArea] = useState(false)
  const [entriesRefreshKey, setEntriesRefreshKey] = useState(0)

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

  const handleImported = useCallback(async () => {
    await load()
    setEntriesRefreshKey((k) => k + 1)
  }, [load])

  useEffect(() => {
    if (!isLoggedIn()) {
      router.replace('/login')
      return
    }
    const role = getCurrentRole()
    setCanManage(role !== null && hasMinRole(role as UserRole, 'event_manager'))
    setCanOperate(role !== null && hasMinRole(role as UserRole, 'staff'))
    setCanWeighIn(role !== null && hasMinRole(role as UserRole, 'weigh_in_operator'))
    setCanCloseArea(role !== null && hasMinRole(role as UserRole, 'scoreboard_operator'))
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

        <AreasSection
          eventId={eventId}
          divisions={divisions}
          canManage={canManage}
          canCloseArea={canCloseArea}
        />

        {canManage && <ImportSection eventId={eventId} onImported={handleImported} />}

        <EntriesSection
          eventId={eventId}
          divisions={divisions}
          canManage={canManage}
          canOperate={canOperate}
          canWeighIn={canWeighIn}
          refreshKey={entriesRefreshKey}
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
  const [overweightPolicy, setOverweightPolicy] = useState(event.overweightPolicy)
  const [hideUnderAge, setHideUnderAge] = useState(
    event.publicHideNamesUnderAge === null || event.publicHideNamesUnderAge === undefined
      ? ''
      : String(event.publicHideNamesUnderAge),
  )
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSave() {
    setLoading(true)
    setError(null)
    try {
      await apiFetch(`/events/${event.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          name,
          eventDate,
          venue: venue || undefined,
          status,
          overweightPolicy,
          publicHideNamesUnderAge: hideUnderAge.trim() === '' ? null : Number(hideUnderAge),
        }),
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
        <p className="mt-1 text-sm text-slate-500">
          Peso acima do limite: {OVERWEIGHT_POLICY_LABELS[event.overweightPolicy] ?? event.overweightPolicy}
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
        <div className="sm:col-span-2">
          <label className="mb-1 block text-xs text-slate-500">Peso acima do limite da categoria</label>
          <select
            value={overweightPolicy}
            onChange={(e) => setOverweightPolicy(e.target.value)}
            className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-white"
          >
            {OVERWEIGHT_POLICY_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
        <div className="sm:col-span-2">
          <label className="mb-1 block text-xs text-slate-500">
            Ocultar nome de menores de (anos) em telas públicas
          </label>
          <input
            type="number"
            min="1"
            max="21"
            value={hideUnderAge}
            onChange={(e) => setHideUnderAge(e.target.value)}
            placeholder="vazio = mostrar nomes completos"
            className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-white placeholder-slate-500"
          />
          <p className="mt-1 text-xs text-slate-500">
            Atletas abaixo dessa idade aparecem como &quot;Nome S.&quot; no telão e no placar público. Operadores sempre
            veem o nome completo.
          </p>
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
        <div className="flex gap-2">
          <Link
            href={`/events/${eventId}/print/weighin`}
            className="rounded-lg border border-slate-700 px-3 py-2 text-sm text-slate-300 hover:bg-slate-800"
          >
            Ficha de pesagem
          </Link>
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
            {' · '}
            <Link href={`/events/${eventId}/print/bracket/${division.id}`} className="underline decoration-dotted hover:text-slate-300">
              chave
            </Link>
            {' · '}
            <Link href={`/events/${eventId}/print/results/${division.id}`} className="underline decoration-dotted hover:text-slate-300">
              resultado
            </Link>
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

interface AreaDTO {
  id: string
  name: string
  allowedDivisionIds: string[] | null
  status: 'open' | 'closed'
  closedReason?: string
}

interface UnroutableMatchDTO {
  id: string
  matchNumber: number
  divisionId: string
}

function AreasSection({
  eventId,
  divisions,
  canManage,
  canCloseArea,
}: {
  eventId: string
  divisions: DivisionDTO[]
  canManage: boolean
  canCloseArea: boolean
}) {
  const [areas, setAreas] = useState<AreaDTO[] | null>(null)
  const [unroutable, setUnroutable] = useState<UnroutableMatchDTO[]>([])
  const [error, setError] = useState<string | null>(null)
  const [addingArea, setAddingArea] = useState(false)

  const load = useCallback(async () => {
    try {
      const [areasData, unroutableData] = await Promise.all([
        apiFetch<AreaDTO[]>(`/events/${eventId}/areas`),
        apiFetch<UnroutableMatchDTO[]>(`/events/${eventId}/areas/unroutable-matches`),
      ])
      setAreas(areasData)
      setUnroutable(unroutableData)
    } catch {
      setError('Não foi possível carregar as áreas.')
    }
  }, [eventId])

  useEffect(() => {
    void load()
  }, [load])

  function divisionName(id: string): string {
    return divisions.find((d) => d.id === id)?.name ?? id
  }

  return (
    <section>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-lg font-semibold text-white">Áreas (mesas)</h2>
        <div className="flex gap-2">
          <Link
            href={`/display/events/${eventId}`}
            target="_blank"
            className="rounded-lg border border-slate-700 px-3 py-2 text-sm text-slate-300 hover:bg-slate-800"
          >
            Telão do evento
          </Link>
          {canCloseArea && (
            <Link
              href={`/events/${eventId}/operate`}
              className="rounded-lg border border-slate-700 px-3 py-2 text-sm text-slate-300 hover:bg-slate-800"
            >
              Operar mesa
            </Link>
          )}
          {canManage && !addingArea && (
            <button
              type="button"
              onClick={() => setAddingArea(true)}
              className="rounded-lg bg-blue-600 px-3 py-2 text-sm font-semibold text-white transition hover:bg-blue-500"
            >
              + Criar área
            </button>
          )}
        </div>
      </div>

      {error && <p className="mb-3 text-sm text-red-400">{error}</p>}

      {unroutable.length > 0 && (
        <p className="mb-3 rounded-lg border border-amber-800 bg-amber-950/40 px-3 py-2 text-sm text-amber-300">
          {unroutable.length} luta(s) sem área disponível no momento — reabra a área correspondente ou libere a
          divisão em outra área aberta.
        </p>
      )}

      {areas === null && <p className="text-sm text-slate-400">Carregando…</p>}
      {areas && areas.length === 0 && !addingArea && <p className="text-sm text-slate-500">Nenhuma área criada ainda.</p>}

      <div className="space-y-2">
        {areas?.map((a) => (
          <AreaRow
            key={a.id}
            eventId={eventId}
            area={a}
            divisions={divisions}
            canManage={canManage}
            canCloseArea={canCloseArea}
            divisionName={divisionName}
            onChanged={load}
          />
        ))}
      </div>

      {canManage && addingArea && (
        <NewAreaForm eventId={eventId} divisions={divisions} onDone={() => setAddingArea(false)} onCreated={load} />
      )}
    </section>
  )
}

function AreaRow({
  eventId,
  area,
  divisions,
  canManage,
  canCloseArea,
  divisionName,
  onChanged,
}: {
  eventId: string
  area: AreaDTO
  divisions: DivisionDTO[]
  canManage: boolean
  canCloseArea: boolean
  divisionName: (id: string) => string
  onChanged: () => void
}) {
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(area.name)
  const [anyDivision, setAnyDivision] = useState(area.allowedDivisionIds === null)
  const [selectedDivisionIds, setSelectedDivisionIds] = useState<string[]>(area.allowedDivisionIds ?? [])
  const [showClose, setShowClose] = useState(false)
  const [closeReason, setCloseReason] = useState('')
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

  async function handleSave() {
    await run(() =>
      apiFetch(`/events/${eventId}/areas/${area.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ name, allowedDivisionIds: anyDivision ? null : selectedDivisionIds }),
      }),
    )
    setEditing(false)
  }

  async function handleDelete() {
    if (!window.confirm(`Apagar a área "${area.name}"?`)) return
    await run(() => apiFetch(`/events/${eventId}/areas/${area.id}`, { method: 'DELETE' }))
  }

  async function handleClose() {
    await run(() =>
      apiFetch(`/events/${eventId}/areas/${area.id}/close`, {
        method: 'PATCH',
        body: JSON.stringify({ reason: closeReason }),
      }),
    )
    setShowClose(false)
  }

  async function handleReopen() {
    await run(() => apiFetch(`/events/${eventId}/areas/${area.id}/reopen`, { method: 'PATCH' }))
  }

  function toggleDivision(id: string) {
    setSelectedDivisionIds((current) => (current.includes(id) ? current.filter((d) => d !== id) : [...current, id]))
  }

  if (editing) {
    return (
      <div className="rounded-lg border border-slate-800 bg-slate-900 p-4">
        <div className="mb-3">
          <label className="mb-1 block text-xs text-slate-500">Nome</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white"
          />
        </div>
        <div className="mb-3">
          <label className="flex items-center gap-2 text-sm text-slate-300">
            <input type="checkbox" checked={anyDivision} onChange={(e) => setAnyDivision(e.target.checked)} />
            Aceita qualquer divisão
          </label>
          {!anyDivision && (
            <div className="mt-2 space-y-1 rounded-lg border border-slate-800 bg-slate-950 p-2">
              {divisions.length === 0 && <p className="text-xs text-slate-500">Nenhuma divisão criada ainda.</p>}
              {divisions.map((d) => (
                <label key={d.id} className="flex items-center gap-2 text-sm text-slate-300">
                  <input
                    type="checkbox"
                    checked={selectedDivisionIds.includes(d.id)}
                    onChange={() => toggleDivision(d.id)}
                  />
                  {d.name}
                </label>
              ))}
            </div>
          )}
        </div>
        {error && <p className="mb-2 text-sm text-red-400">{error}</p>}
        <div className="flex gap-2">
          <button
            type="button"
            onClick={handleSave}
            disabled={loading}
            className="rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-blue-500 disabled:opacity-60"
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

  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="font-medium text-white">{area.name}</p>
          <p className="text-sm text-slate-500">
            {area.allowedDivisionIds === null
              ? 'Aceita qualquer divisão'
              : area.allowedDivisionIds.length === 0
                ? 'Nenhuma divisão permitida'
                : area.allowedDivisionIds.map(divisionName).join(', ')}
          </p>
          {area.status === 'closed' && area.closedReason && (
            <p className="text-sm text-amber-400">Fechada: {area.closedReason}</p>
          )}
        </div>
        <span
          className={`rounded-full border px-3 py-1 text-xs font-medium ${
            area.status === 'open' ? 'border-emerald-800 text-emerald-300' : 'border-slate-700 text-slate-400'
          }`}
        >
          {area.status === 'open' ? 'Aberta' : 'Fechada'}
        </span>
      </div>

      {error && <p className="mt-2 text-sm text-red-400">{error}</p>}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {canManage && (
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="rounded-lg border border-slate-700 px-3 py-1.5 text-sm text-slate-300 hover:bg-slate-800"
          >
            Editar
          </button>
        )}
        {canManage && (
          <button
            type="button"
            onClick={handleDelete}
            disabled={loading}
            className="rounded-lg border border-red-900 px-3 py-1.5 text-sm text-red-400 hover:bg-red-950 disabled:opacity-60"
          >
            Apagar
          </button>
        )}

        {canCloseArea && area.status === 'open' && !showClose && (
          <button
            type="button"
            onClick={() => setShowClose(true)}
            className="rounded-lg border border-amber-800 px-3 py-1.5 text-sm text-amber-300 hover:bg-amber-950"
          >
            Fechar
          </button>
        )}
        {canCloseArea && showClose && (
          <div className="flex items-center gap-2">
            <input
              autoFocus
              value={closeReason}
              onChange={(e) => setCloseReason(e.target.value)}
              placeholder="Motivo (ex: almoço)"
              className="w-48 rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-sm text-white placeholder-slate-500"
            />
            <button
              type="button"
              onClick={handleClose}
              disabled={loading || closeReason.trim().length < 3}
              className="rounded-lg bg-amber-700 px-3 py-1.5 text-sm font-semibold text-white hover:bg-amber-600 disabled:opacity-60"
            >
              Confirmar
            </button>
            <button
              type="button"
              onClick={() => setShowClose(false)}
              className="text-sm text-slate-400 hover:text-slate-200"
            >
              Cancelar
            </button>
          </div>
        )}

        {canManage && area.status === 'closed' && (
          <button
            type="button"
            onClick={handleReopen}
            disabled={loading}
            className="rounded-lg border border-emerald-800 px-3 py-1.5 text-sm text-emerald-300 hover:bg-emerald-950 disabled:opacity-60"
          >
            Reabrir
          </button>
        )}
      </div>
    </div>
  )
}

function NewAreaForm({
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
  const [name, setName] = useState('')
  const [anyDivision, setAnyDivision] = useState(true)
  const [selectedDivisionIds, setSelectedDivisionIds] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function toggleDivision(id: string) {
    setSelectedDivisionIds((current) => (current.includes(id) ? current.filter((d) => d !== id) : [...current, id]))
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setLoading(true)
    setError(null)
    try {
      await apiFetch(`/events/${eventId}/areas`, {
        method: 'POST',
        body: JSON.stringify({ name, allowedDivisionIds: anyDivision ? undefined : selectedDivisionIds }),
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
      <div className="mb-3">
        <label className="mb-1 block text-xs text-slate-500">Nome</label>
        <input
          required
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Ex: Mesa 1"
          className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white placeholder-slate-500"
        />
      </div>
      <div className="mb-3">
        <label className="flex items-center gap-2 text-sm text-slate-300">
          <input type="checkbox" checked={anyDivision} onChange={(e) => setAnyDivision(e.target.checked)} />
          Aceita qualquer divisão
        </label>
        {!anyDivision && (
          <div className="mt-2 space-y-1 rounded-lg border border-slate-800 bg-slate-950 p-2">
            {divisions.length === 0 && <p className="text-xs text-slate-500">Nenhuma divisão criada ainda.</p>}
            {divisions.map((d) => (
              <label key={d.id} className="flex items-center gap-2 text-sm text-slate-300">
                <input
                  type="checkbox"
                  checked={selectedDivisionIds.includes(d.id)}
                  onChange={() => toggleDivision(d.id)}
                />
                {d.name}
              </label>
            ))}
          </div>
        )}
      </div>
      {error && <p className="mb-2 text-sm text-red-400">{error}</p>}
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={loading}
          className="rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-blue-500 disabled:opacity-60"
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

interface ImportRowErrorDTO {
  row: number
  field?: string
  message: string
}

interface ImportJobDTO {
  id: string
  filename: string
  importedAt: string
  totalRows: number
  successCount: number
  errorCount: number
  errors: ImportRowErrorDTO[]
}

function ImportSection({ eventId, onImported }: { eventId: string; onImported: () => Promise<void> }) {
  const [jobs, setJobs] = useState<ImportJobDTO[] | null>(null)
  const [file, setFile] = useState<File | null>(null)
  const [uploading, setUploading] = useState(false)
  const [downloading, setDownloading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [expandedJobId, setExpandedJobId] = useState<string | null>(null)

  const loadJobs = useCallback(async () => {
    try {
      const data = await apiFetch<ImportJobDTO[]>(`/events/${eventId}/import/jobs`)
      setJobs(data)
    } catch {
      setJobs([])
    }
  }, [eventId])

  useEffect(() => {
    void loadJobs()
  }, [loadJobs])

  async function handleDownloadTemplate() {
    setDownloading(true)
    setError(null)
    try {
      const token = getAccessToken()
      const res = await fetch(`/api/events/${eventId}/import/template`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      })
      if (!res.ok) throw new Error()
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = 'modelo-importacao-atletas.xlsx'
      a.click()
      URL.revokeObjectURL(url)
    } catch {
      setError('Não foi possível baixar o modelo.')
    } finally {
      setDownloading(false)
    }
  }

  async function handleUpload() {
    if (!file) return
    setUploading(true)
    setError(null)
    try {
      const formData = new FormData()
      formData.append('file', file)
      const job = await apiFetch<ImportJobDTO>(`/events/${eventId}/import`, { method: 'POST', body: formData })
      setFile(null)
      setExpandedJobId(job.id)
      await loadJobs()
      await onImported()
    } catch (err) {
      setError(err instanceof ApiError ? translateApiError(err.message) : 'Não foi possível importar a planilha.')
    } finally {
      setUploading(false)
    }
  }

  return (
    <section>
      <h2 className="mb-3 text-lg font-semibold text-white">Importar planilha de atletas</h2>

      <div className="rounded-lg border border-slate-800 bg-slate-900 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={handleDownloadTemplate}
            disabled={downloading}
            className="rounded-lg border border-slate-700 px-3 py-2 text-sm text-slate-300 hover:bg-slate-800 disabled:opacity-60"
          >
            Baixar modelo (.xlsx)
          </button>
          <input
            type="file"
            accept=".xlsx"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="text-sm text-slate-300 file:mr-3 file:rounded-lg file:border-0 file:bg-slate-800 file:px-3 file:py-1.5 file:text-sm file:text-slate-300"
          />
          <button
            type="button"
            onClick={handleUpload}
            disabled={!file || uploading}
            className="rounded-lg bg-blue-600 px-3 py-2 text-sm font-semibold text-white transition hover:bg-blue-500 disabled:opacity-60"
          >
            {uploading ? 'Importando…' : 'Importar'}
          </button>
        </div>

        {error && <p className="mt-3 text-sm text-red-400">{error}</p>}

        {jobs && jobs.length > 0 && (
          <ul className="mt-4 space-y-2">
            {jobs.map((job) => (
              <li key={job.id} className="rounded-lg border border-slate-800 bg-slate-950 p-3">
                <button
                  type="button"
                  onClick={() => setExpandedJobId((id) => (id === job.id ? null : job.id))}
                  className="flex w-full flex-wrap items-center justify-between gap-2 text-left"
                >
                  <span className="text-sm text-white">{job.filename}</span>
                  <span className="text-xs text-slate-400">
                    {new Date(job.importedAt).toLocaleString('pt-BR')} · {job.successCount}/{job.totalRows} importadas
                    {job.errorCount > 0 ? ` · ${job.errorCount} erro(s)` : ''}
                  </span>
                </button>

                {expandedJobId === job.id && job.errors.length > 0 && (
                  <div className="mt-3 overflow-x-auto">
                    <table className="w-full text-left text-xs">
                      <thead className="text-slate-500">
                        <tr>
                          <th className="py-1 pr-3">Linha</th>
                          <th className="py-1 pr-3">Campo</th>
                          <th className="py-1">Erro</th>
                        </tr>
                      </thead>
                      <tbody className="text-slate-300">
                        {job.errors.map((e, i) => (
                          <tr key={i} className="border-t border-slate-800">
                            <td className="py-1 pr-3">{e.row}</td>
                            <td className="py-1 pr-3">{e.field ?? '—'}</td>
                            <td className="py-1">{e.message}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
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
  disqualifiedReason?: string
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
  refreshKey,
}: {
  eventId: string
  divisions: DivisionDTO[]
  canManage: boolean
  canOperate: boolean
  canWeighIn: boolean
  refreshKey: number
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
  }, [load, refreshKey])

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
        {canOperate && (
          <Link
            href={`/events/${eventId}/checkin`}
            className="mr-2 rounded-lg border border-slate-700 px-3 py-2 text-sm text-slate-300 hover:bg-slate-800"
          >
            Check-in
          </Link>
        )}
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
  const [readingScale, setReadingScale] = useState(false)
  const [showWithdraw, setShowWithdraw] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [weighInOutcome, setWeighInOutcome] = useState<string | null>(null)

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

  // Weigh-in gets its own error handling (rather than the shared `run()`
  // helper) so a network failure can be queued for later sync instead of
  // just showing an error — see lib/offlineQueue.ts for why weigh-in
  // specifically is one of the two flows that queue.
  const handleWeighIn = async () => {
    setLoading(true)
    setError(null)
    try {
      const result = await apiFetch<{ outcome: 'ok' | 'reallocated' | 'disqualified' }>(
        `/events/${eventId}/entries/${entry.id}/weighin`,
        { method: 'PATCH', body: JSON.stringify({ weightKg: Number(weighInValue) }) },
      )
      if (result.outcome === 'reallocated') {
        setWeighInOutcome('Peso acima do limite: atleta realocada automaticamente para a categoria correta.')
      } else if (result.outcome === 'disqualified') {
        setWeighInOutcome('Peso acima do limite: atleta desclassificada desta divisão.')
      } else {
        setWeighInOutcome(null)
      }
      onChanged()
      setShowWeighIn(false)
    } catch (err) {
      if (!(err instanceof ApiError)) {
        await enqueueOfflineWrite({
          path: `/events/${eventId}/entries/${entry.id}/weighin`,
          method: 'PATCH',
          body: { weightKg: Number(weighInValue) },
          description: `Pesagem: ${athleteName} (${weighInValue}kg)`,
        })
        setWeighInOutcome('Sem conexão — pesagem salva neste aparelho, vai sincronizar automaticamente.')
        setShowWeighIn(false)
      } else {
        setError(translateApiError(err.message))
      }
    } finally {
      setLoading(false)
    }
  }

  const handleReadScale = async () => {
    setReadingScale(true)
    try {
      const result = await apiFetch<{ connected: boolean; reading: { weightKg: number } | null }>('/scale/reading')
      if (result.reading) {
        setWeighInValue(String(result.reading.weightKg))
      }
      // Disconnected/no reading: leave the field as-is — manual entry never blocked (CLAUDE.md).
    } catch {
      // hardware failure must never block manual entry — fail silently, operator keeps typing
    } finally {
      setReadingScale(false)
    }
  }

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
      {entry.disqualifiedReason && (
        <p className="mt-1 text-sm text-red-400">Desclassificada: {entry.disqualifiedReason}</p>
      )}
      {weighInOutcome && <p className="mt-2 text-sm text-amber-400">{weighInOutcome}</p>}

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
              onClick={handleReadScale}
              disabled={readingScale}
              title="Ler peso da balança conectada"
              className="rounded-lg border border-slate-700 px-3 py-1.5 text-sm text-slate-300 hover:bg-slate-800 disabled:opacity-60"
            >
              {readingScale ? 'Lendo…' : '⚖ Ler balança'}
            </button>
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

        {canManage && entry.status !== 'withdrawn' && entry.status !== 'disqualified' && !showWithdraw && (
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
