'use client'

// Expanded detail for one division leaf: edit/delete (moved here from the old
// flat DivisionRow), bracket generation/regeneration, and the roster of
// entries currently in this division — draggable to another division leaf,
// or moved via the row's ⋮ menu / right-click ("Alterar › Categoria"), see
// MoveEntryDialog.tsx. A division with exactly one active entry is NOT an
// error state: in judô, an athlete without an opponent wins the category —
// that's the normal outcome, not something to fix. The one-liner below is
// informational, not a warning, and the manager can move the athlete to
// another category any time if they'd rather give her a real fight.

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { apiFetch, ApiError } from '../../../../lib/api'
import { translateApiError, EVENT_ENTRY_STATUS_LABELS } from '../../../../lib/labels'
import type { DivisionLite } from './divisionGrouping'
import {
  EntryMoveButton,
  useEntryContextMenu,
  ENTRY_DRAG_MIME,
  type MoveEntryTarget,
} from './MoveEntryDialog'

export interface EntryLite {
  id: string
  divisionId: string
  confirmedDivisionId?: string
  status: string
  athleteName?: string
  athleteIdentity?: string
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
  entries,
  canManage,
  onDivisionSaved,
  onDivisionDeleted,
  onRequestMove,
}: {
  eventId: string
  division: DivisionLite
  entries: EntryLite[]
  canManage: boolean
  onDivisionSaved: () => void
  onDivisionDeleted: (id: string) => void
  onRequestMove: (entry: MoveEntryTarget, targetDivisionId?: string) => void
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

      {activeEntries.length === 1 && (
        <p className="mt-3 rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-slate-400">
          Só esta atleta na categoria — no judô, sem adversário é vitória (não é um problema a resolver). Se preferir
          dar luta a ela, mova-a para outra categoria pelo menu abaixo.
        </p>
      )}

      {activeEntries.length > 0 && (
        <ul className="mt-3 space-y-1.5">
          {activeEntries.map((e) => (
            <DivisionEntryRow
              key={e.id}
              entry={e}
              divisionId={division.id}
              canManage={canManage}
              onRequestMove={onRequestMove}
            />
          ))}
        </ul>
      )}

      {canManage && <BracketPanel eventId={eventId} divisionId={division.id} confirmedCount={confirmedCount} totalCount={totalCount} />}
    </div>
  )
}

// One athlete row inside a division's roster. Draggable to another division
// leaf (drag-and-drop is a mouse-only shortcut per CLAUDE.md's touch
// priority), with the ⋮ button as the always-visible primary path and a
// right-click menu as the desktop equivalent — all three open the same
// MoveEntryDialog. Only rendered inside the division-grouped view, which is
// why the "move" affordances only appear here, not in the entry's own
// division-agnostic actions (check-in/confirm/withdraw) in the flat
// "Inscrições" list further down the page.
function DivisionEntryRow({
  entry,
  divisionId,
  canManage,
  onRequestMove,
}: {
  entry: EntryLite
  divisionId: string
  canManage: boolean
  onRequestMove: (entry: MoveEntryTarget, targetDivisionId?: string) => void
}) {
  const label = entry.athleteName ?? entry.id

  function open() {
    onRequestMove({ id: entry.id, athleteName: label, currentDivisionId: divisionId })
  }

  const { onContextMenu, menu } = useEntryContextMenu(open)

  return (
    <>
      <li
        draggable={canManage}
        onDragStart={(e) => {
          e.dataTransfer.setData(ENTRY_DRAG_MIME, entry.id)
          e.dataTransfer.effectAllowed = 'move'
        }}
        onContextMenu={canManage ? onContextMenu : undefined}
        className={`flex items-center justify-between gap-2 rounded-lg border border-slate-800 bg-slate-900 px-3 py-1.5 text-sm ${canManage ? 'cursor-grab active:cursor-grabbing' : ''}`}
      >
        <span className="text-slate-200">
          {label}
          {entry.athleteIdentity && <span className="ml-2 text-xs text-slate-500">{entry.athleteIdentity}</span>}
        </span>
        <span className="flex items-center gap-2">
          <span className="text-xs text-slate-500">{EVENT_ENTRY_STATUS_LABELS[entry.status] ?? entry.status}</span>
          {canManage && <EntryMoveButton onOpenDialog={open} />}
        </span>
      </li>
      {canManage && menu}
    </>
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
