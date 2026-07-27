'use client'

// Expanded detail for one division leaf: edit/delete (moved here from the old
// flat DivisionRow), bracket generation/regeneration, and — when the
// division has exactly one active entry and nobody to fight — a way for the
// manager to resolve it (move to another division, per CLAUDE.md "Athlete
// moved to another category" edge case).

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { apiFetch, ApiError } from '../../../../lib/api'
import { translateApiError } from '../../../../lib/labels'
import type { DivisionLite } from './divisionGrouping'

export interface EntryLite {
  id: string
  divisionId: string
  confirmedDivisionId?: string
  status: string
}

interface BracketDTO {
  id: string
  format: 'elimination' | 'rodizio'
  size?: number
  repechageType?: string
  status: 'active' | 'archived'
  version: number
  createdAt: string
}

const BRACKET_FORMAT_OPTIONS = [
  { value: 'elimination', label: 'Eliminação simples' },
  { value: 'rodizio', label: 'Rodízio' },
] as const

const REPECHAGE_OPTIONS = [
  { value: 'nenhuma', label: 'Sem repescagem' },
  { value: 'simples', label: 'Repescagem simples' },
  { value: 'normal', label: 'Repescagem normal' },
  { value: 'dupla', label: 'Repescagem dupla' },
  { value: 'finalistas', label: 'Repescagem de finalistas' },
]

function minAthletesFor(format: string): number {
  return format === 'rodizio' ? 3 : 2
}
function maxAthletesFor(format: string): number | null {
  return format === 'rodizio' ? 6 : null
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('pt-BR')
}

export function DivisionDetail({
  eventId,
  division,
  allDivisions,
  entries,
  canManage,
  onDivisionSaved,
  onDivisionDeleted,
  onEntriesChanged,
}: {
  eventId: string
  division: DivisionLite
  allDivisions: DivisionLite[]
  entries: EntryLite[]
  canManage: boolean
  onDivisionSaved: () => void
  onDivisionDeleted: (id: string) => void
  onEntriesChanged: () => void
}) {
  const [editing, setEditing] = useState(false)

  const activeEntries = entries.filter(
    (e) =>
      (e.confirmedDivisionId ?? e.divisionId) === division.id &&
      e.status !== 'withdrawn' &&
      e.status !== 'disqualified',
  )
  const confirmedCount = activeEntries.filter((e) => e.status === 'confirmed').length
  const totalCount = entries.filter((e) => (e.confirmedDivisionId ?? e.divisionId) === division.id).length

  return (
    <div className="rounded-lg border border-slate-800 bg-slate-950 p-3">
      {editing ? (
        <EditDivisionForm
          eventId={eventId}
          division={division}
          onDone={() => setEditing(false)}
          onSaved={() => {
            setEditing(false)
            onDivisionSaved()
          }}
        />
      ) : (
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="text-sm text-slate-400">
            {totalCount} inscrição(ões) · {confirmedCount} confirmada(s)
            {' · '}
            <Link href={`/events/${eventId}/print/bracket/${division.id}`} className="underline decoration-dotted hover:text-slate-300">
              folha da chave
            </Link>
            {' · '}
            <Link href={`/events/${eventId}/print/results/${division.id}`} className="underline decoration-dotted hover:text-slate-300">
              resultado
            </Link>
          </div>
          {canManage && (
            <div className="flex shrink-0 gap-2">
              <button
                type="button"
                onClick={() => setEditing(true)}
                className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-800"
              >
                Editar
              </button>
              <button
                type="button"
                onClick={() => onDivisionDeleted(division.id)}
                className="rounded-lg border border-red-900 px-3 py-1.5 text-xs text-red-400 hover:bg-red-950"
              >
                Apagar
              </button>
            </div>
          )}
        </div>
      )}

      {activeEntries.length === 1 && canManage && (
        <SingletonResolver
          eventId={eventId}
          entry={activeEntries[0]!}
          allDivisions={allDivisions}
          currentDivisionId={division.id}
          onResolved={onEntriesChanged}
        />
      )}

      {canManage && <BracketPanel eventId={eventId} divisionId={division.id} confirmedCount={confirmedCount} totalCount={totalCount} />}
    </div>
  )
}

function EditDivisionForm({
  eventId,
  division,
  onDone,
  onSaved,
}: {
  eventId: string
  division: DivisionLite
  onDone: () => void
  onSaved: () => void
}) {
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
      onSaved()
    } catch (err) {
      setError(err instanceof ApiError ? translateApiError(err.message) : 'Não foi possível salvar.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div>
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
          onClick={onDone}
          className="rounded-lg border border-slate-700 px-3 py-1.5 text-sm text-slate-300 hover:bg-slate-800"
        >
          Cancelar
        </button>
      </div>
    </div>
  )
}

// The manager's decision point for a division that has exactly one athlete
// and therefore no possible opponent. Moving the entry to another division
// only works while the API allows it: EventEntryService's state machine
// only permits the (weighed_in -> confirmed) transition that the /confirm
// endpoint uses, so re-targeting confirmedDivisionId is only possible before
// the entry has already been confirmed. Once confirmed, the only state-machine
// legal move is to withdraw (with an audited reason) and re-register.
function SingletonResolver({
  eventId,
  entry,
  allDivisions,
  currentDivisionId,
  onResolved,
}: {
  eventId: string
  entry: EntryLite
  allDivisions: DivisionLite[]
  currentDivisionId: string
  onResolved: () => void
}) {
  const [targetId, setTargetId] = useState('')
  const [showWithdraw, setShowWithdraw] = useState(false)
  const [withdrawReason, setWithdrawReason] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const otherDivisions = allDivisions.filter((d) => d.id !== currentDivisionId)

  async function handleMove() {
    if (!targetId) return
    setLoading(true)
    setError(null)
    try {
      await apiFetch(`/events/${eventId}/entries/${entry.id}/confirm`, {
        method: 'PATCH',
        body: JSON.stringify({ confirmedDivisionId: targetId }),
      })
      onResolved()
    } catch (err) {
      setError(err instanceof ApiError ? translateApiError(err.message) : 'Não foi possível mover a inscrição.')
    } finally {
      setLoading(false)
    }
  }

  async function handleWithdraw() {
    setLoading(true)
    setError(null)
    try {
      await apiFetch(`/events/${eventId}/entries/${entry.id}/withdraw`, {
        method: 'PATCH',
        body: JSON.stringify({ reason: withdrawReason }),
      })
      onResolved()
    } catch (err) {
      setError(err instanceof ApiError ? translateApiError(err.message) : 'Não foi possível retirar a inscrição.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="mt-3 rounded-lg border border-amber-800 bg-amber-950/30 p-3">
      <p className="text-sm font-medium text-amber-300">Só 1 atleta nesta divisão — sem adversário.</p>

      {entry.status === 'weighed_in' && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <select
            value={targetId}
            onChange={(e) => setTargetId(e.target.value)}
            className="rounded-lg border border-amber-800 bg-slate-900 px-3 py-1.5 text-sm text-white"
          >
            <option value="">Mover para…</option>
            {otherDivisions.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={handleMove}
            disabled={!targetId || loading}
            className="rounded-lg bg-amber-700 px-3 py-1.5 text-sm font-semibold text-white hover:bg-amber-600 disabled:opacity-60"
          >
            Mover e confirmar nesta divisão
          </button>
        </div>
      )}

      {entry.status === 'confirmed' && (
        <>
          <p className="mt-1 text-xs text-amber-400">
            Esta inscrição já foi confirmada nesta divisão. O remanejamento direto só é possível antes da confirmação
            (logo após a pesagem) — para mudar de categoria agora, retire a inscrição com um motivo e inscreva a
            atleta novamente na divisão correta.
          </p>
          {!showWithdraw ? (
            <button
              type="button"
              onClick={() => setShowWithdraw(true)}
              className="mt-2 rounded-lg border border-red-900 px-3 py-1.5 text-xs text-red-400 hover:bg-red-950"
            >
              Retirar inscrição
            </button>
          ) : (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <input
                autoFocus
                value={withdrawReason}
                onChange={(e) => setWithdrawReason(e.target.value)}
                placeholder="Motivo (ex: única inscrita na categoria)"
                className="w-64 rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 text-sm text-white placeholder-slate-500"
              />
              <button
                type="button"
                onClick={handleWithdraw}
                disabled={loading || withdrawReason.trim().length < 3}
                className="rounded-lg bg-red-700 px-3 py-1.5 text-sm font-semibold text-white hover:bg-red-600 disabled:opacity-60"
              >
                Confirmar retirada
              </button>
              <button type="button" onClick={() => setShowWithdraw(false)} className="text-sm text-slate-400 hover:text-slate-200">
                Cancelar
              </button>
            </div>
          )}
        </>
      )}

      {(entry.status === 'registered' || entry.status === 'checked_in') && (
        <p className="mt-1 text-xs text-amber-400">
          Esta atleta ainda não foi pesada. O remanejamento para outra divisão fica disponível assim que a pesagem for
          feita, no passo de confirmação de categoria.
        </p>
      )}

      {error && <p className="mt-2 text-xs text-red-400">{error}</p>}
    </div>
  )
}

function BracketPanel({
  eventId,
  divisionId,
  confirmedCount,
  totalCount,
}: {
  eventId: string
  divisionId: string
  confirmedCount: number
  totalCount: number
}) {
  const [bracket, setBracket] = useState<BracketDTO | null | undefined>(undefined) // undefined = loading
  const [format, setFormat] = useState<'elimination' | 'rodizio'>('elimination')
  const [repechageType, setRepechageType] = useState('nenhuma')
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showRegenConfirm, setShowRegenConfirm] = useState(false)

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const b = await apiFetch<BracketDTO>(`/events/${eventId}/divisions/${divisionId}/bracket`)
        if (!cancelled) setBracket(b)
      } catch (err) {
        if (!cancelled) {
          if (err instanceof ApiError && err.status === 404) setBracket(null)
          else setBracket(null)
        }
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [eventId, divisionId])

  const min = minAthletesFor(format)
  const max = maxAthletesFor(format)
  let blockReason: string | null = null
  if (totalCount === 0) blockReason = 'Nenhuma inscrição nesta divisão ainda.'
  else if (confirmedCount === 0) blockReason = `Faltam confirmar ${totalCount} inscrição(ões) nesta divisão antes de gerar a chave.`
  else if (confirmedCount < min) blockReason = `Só ${confirmedCount} atleta(s) confirmada(s) — mínimo de ${min} para este formato.`
  else if (max !== null && confirmedCount > max) blockReason = `${confirmedCount} atletas confirmadas — o rodízio aceita no máximo ${max}. Use eliminação simples.`

  async function generate(force: boolean) {
    setGenerating(true)
    setError(null)
    try {
      const body: Record<string, unknown> = { format, force: force || undefined }
      if (format === 'elimination') body['repechageType'] = repechageType
      const b = await apiFetch<BracketDTO>(`/events/${eventId}/divisions/${divisionId}/bracket`, {
        method: 'POST',
        body: JSON.stringify(body),
      })
      setBracket(b)
      setShowRegenConfirm(false)
    } catch (err) {
      setError(err instanceof ApiError ? translateApiError(err.message) : 'Não foi possível gerar a chave.')
    } finally {
      setGenerating(false)
    }
  }

  return (
    <div className="mt-3 rounded-lg border border-slate-800 bg-slate-900 p-3">
      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Chave</p>

      {bracket === undefined && <p className="text-sm text-slate-500">Carregando…</p>}

      {bracket === null && <p className="mb-2 text-sm text-slate-400">Nenhuma chave gerada ainda para esta divisão.</p>}

      {bracket && (
        <p className="mb-2 text-sm text-slate-300">
          Chave ativa: {BRACKET_FORMAT_OPTIONS.find((o) => o.value === bracket.format)?.label ?? bracket.format}
          {bracket.size ? ` (Chave-${bracket.size})` : ''} · versão {bracket.version} · gerada em{' '}
          {formatDateTime(bracket.createdAt)}
        </p>
      )}

      {blockReason && <p className="mb-2 text-sm text-amber-400">{blockReason}</p>}

      <div className="flex flex-wrap items-center gap-2">
        <select
          value={format}
          onChange={(e) => setFormat(e.target.value as 'elimination' | 'rodizio')}
          className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-sm text-white"
        >
          {BRACKET_FORMAT_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        {format === 'elimination' && (
          <select
            value={repechageType}
            onChange={(e) => setRepechageType(e.target.value)}
            className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-sm text-white"
          >
            {REPECHAGE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        )}

        {!bracket && (
          <button
            type="button"
            onClick={() => void generate(false)}
            disabled={generating || blockReason !== null}
            className="rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-blue-500 disabled:opacity-60"
          >
            {generating ? 'Gerando…' : 'Gerar chave'}
          </button>
        )}

        {bracket && !showRegenConfirm && (
          <button
            type="button"
            onClick={() => setShowRegenConfirm(true)}
            disabled={generating}
            className="rounded-lg border border-amber-700 px-3 py-1.5 text-sm text-amber-300 hover:bg-amber-950 disabled:opacity-60"
          >
            Regerar chave
          </button>
        )}
      </div>

      {bracket && showRegenConfirm && (
        <div className="mt-3 rounded-lg border border-amber-800 bg-amber-950/40 p-3">
          <p className="text-sm text-amber-300">
            Isso vai arquivar a chave atual (versão {bracket.version}) e gerar uma nova no lugar. Resultados já
            registrados nesta chave deixam de valer para a classificação e esta ação não pode ser desfeita
            automaticamente.
          </p>
          {blockReason && <p className="mt-2 text-sm text-amber-400">{blockReason}</p>}
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              onClick={() => void generate(true)}
              disabled={generating || blockReason !== null}
              className="rounded-lg bg-amber-700 px-3 py-1.5 text-sm font-semibold text-white hover:bg-amber-600 disabled:opacity-60"
            >
              {generating ? 'Regerando…' : 'Sim, regerar'}
            </button>
            <button
              type="button"
              onClick={() => setShowRegenConfirm(false)}
              className="rounded-lg border border-slate-700 px-3 py-1.5 text-sm text-slate-300 hover:bg-slate-800"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}

      {error && <p className="mt-2 text-sm text-red-400">{error}</p>}
    </div>
  )
}
