'use client'

// Single implementation shared by every "move to another category" trigger
// on the event page — the row menu button (always visible, the primary path
// on tablets, since check-in/secretaria run on touch devices — see
// CLAUDE.md), the right-click menu (desktop shortcut to the same action),
// and drag-and-drop between divisions all end up here. Moving is allowed at
// any point (not just the narrow weighed_in window `confirm` allows — see
// EventEntryService.moveEntry) — but never silently: whenever the origin or
// destination division already has an active bracket, this dialog shows
// exactly what will be archived *before* the operator confirms, and demands
// a reason, mirroring the server-side rule.

import { useEffect, useState } from 'react'
import { apiFetch, ApiError } from '../../../../lib/api'
import { translateApiError } from '../../../../lib/labels'

// Native HTML5 drag-and-drop data key used to identify a dragged entry —
// scoped to this app (not a generic MIME type) so drops from unrelated drag
// sources are ignored.
export const ENTRY_DRAG_MIME = 'application/x-arena-entry-id'

export interface MoveEntryTarget {
  id: string
  athleteName: string
  currentDivisionId: string // effective division: confirmedDivisionId ?? divisionId
}

export interface DivisionOption {
  id: string
  name: string
}

interface BracketPreview {
  version: number
  matchesWithResult: number
}

// Best-effort preview: a 404 (no active bracket) is the expected common case,
// not an error. Any other failure is treated the same as "nothing to warn
// about" — the server re-validates and enforces the reason requirement
// authoritatively regardless of what this preview could fetch, so a failed
// preview never lets a destructive move through silently.
async function loadBracketPreview(eventId: string, divisionId: string): Promise<BracketPreview | null> {
  let bracket: { version: number }
  try {
    bracket = await apiFetch<{ version: number }>(`/events/${eventId}/divisions/${divisionId}/bracket`)
  } catch {
    return null
  }
  let matchesWithResult = 0
  try {
    const matches = await apiFetch<{ result: unknown }[]>(`/events/${eventId}/divisions/${divisionId}/matches`)
    matchesWithResult = matches.filter((m) => m.result != null).length
  } catch {
    // matches are just extra detail for the warning message
  }
  return { version: bracket.version, matchesWithResult }
}

export function MoveEntryDialog({
  eventId,
  entry,
  divisions,
  initialTargetDivisionId,
  onClose,
  onMoved,
}: {
  eventId: string
  entry: MoveEntryTarget
  divisions: DivisionOption[]
  initialTargetDivisionId?: string | undefined
  onClose: () => void
  onMoved: () => void
}) {
  const options = divisions.filter((d) => d.id !== entry.currentDivisionId)
  const [targetId, setTargetId] = useState(initialTargetDivisionId ?? options[0]?.id ?? '')
  const [originPreview, setOriginPreview] = useState<BracketPreview | null | undefined>(undefined)
  const [targetPreview, setTargetPreview] = useState<BracketPreview | null | undefined>(undefined)
  const [reason, setReason] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setOriginPreview(undefined)
    void loadBracketPreview(eventId, entry.currentDivisionId).then((p) => {
      if (!cancelled) setOriginPreview(p)
    })
    return () => {
      cancelled = true
    }
  }, [eventId, entry.currentDivisionId])

  useEffect(() => {
    if (!targetId) {
      setTargetPreview(null)
      return
    }
    let cancelled = false
    setTargetPreview(undefined)
    void loadBracketPreview(eventId, targetId).then((p) => {
      if (!cancelled) setTargetPreview(p)
    })
    return () => {
      cancelled = true
    }
  }, [eventId, targetId])

  const loadingPreview = originPreview === undefined || targetPreview === undefined
  const destructive = Boolean(originPreview || targetPreview)
  const targetName = divisions.find((d) => d.id === targetId)?.name ?? ''

  async function handleSubmit() {
    if (!targetId) return
    if (destructive && reason.trim().length < 3) {
      setError('Informe o motivo (mínimo 3 caracteres) — esta movimentação vai invalidar uma chave já gerada.')
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      await apiFetch(`/events/${eventId}/entries/${entry.id}/move`, {
        method: 'PATCH',
        body: JSON.stringify({ targetDivisionId: targetId, reason: reason.trim() || undefined }),
      })
      onMoved()
      onClose()
    } catch (err) {
      setError(err instanceof ApiError ? translateApiError(err.message) : 'Não foi possível mover a inscrição.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div
        className="w-full max-w-md rounded-lg border border-slate-700 bg-slate-900 p-4 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-lg font-semibold text-white">Mover para outra categoria</h3>
        <p className="mt-1 text-sm text-slate-400">{entry.athleteName}</p>

        <div className="mt-3">
          <label className="mb-1 block text-xs text-slate-500">Categoria de destino</label>
          <select
            value={targetId}
            onChange={(e) => setTargetId(e.target.value)}
            className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white"
          >
            {options.length === 0 && <option value="">Nenhuma outra categoria disponível</option>}
            {options.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </div>

        {loadingPreview && <p className="mt-3 text-sm text-slate-500">Verificando chaves…</p>}

        {!loadingPreview && originPreview && (
          <p className="mt-3 rounded-lg border border-amber-800 bg-amber-950/30 px-3 py-2 text-sm text-amber-300">
            A categoria de origem já tem uma chave gerada (versão {originPreview.version}
            {originPreview.matchesWithResult > 0 ? `, ${originPreview.matchesWithResult} luta(s) já com resultado` : ''}) — mover
            esta atleta vai arquivar essa chave; será preciso gerá-la de novo.
          </p>
        )}

        {!loadingPreview && targetPreview && (
          <p className="mt-2 rounded-lg border border-amber-800 bg-amber-950/30 px-3 py-2 text-sm text-amber-300">
            &quot;{targetName}&quot; também já tem uma chave gerada (versão {targetPreview.version}
            {targetPreview.matchesWithResult > 0 ? `, ${targetPreview.matchesWithResult} luta(s) já com resultado` : ''}) — mover
            esta atleta para lá também vai arquivar essa chave.
          </p>
        )}

        {!loadingPreview && destructive && (
          <div className="mt-3">
            <label className="mb-1 block text-xs text-slate-500">Motivo (obrigatório)</label>
            <input
              autoFocus
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Ex: pedido do treinador para dar luta à atleta"
              className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white placeholder-slate-500"
            />
          </div>
        )}

        {error && <p className="mt-3 text-sm text-red-400">{error}</p>}

        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-slate-700 px-3 py-2 text-sm text-slate-300 hover:bg-slate-800"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={() => void handleSubmit()}
            disabled={!targetId || submitting || loadingPreview}
            className={`rounded-lg px-3 py-2 text-sm font-semibold text-white disabled:opacity-60 ${
              destructive ? 'bg-amber-700 hover:bg-amber-600' : 'bg-blue-600 hover:bg-blue-500'
            }`}
          >
            {submitting ? 'Movendo…' : destructive ? 'Mover e arquivar chave(s)' : 'Mover'}
          </button>
        </div>
      </div>
    </div>
  )
}

// Always-visible "⋮" button — the primary path on touch devices, where
// right-click doesn't exist. Opens the move dialog directly (one tap): with
// a single action available today there is no value in an intermediate menu
// here, and CLAUDE.md prioritizes few-clicks flows for tablets.
export function EntryMoveButton({ onOpenDialog, title = 'Alterar categoria' }: { onOpenDialog: () => void; title?: string }) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation()
        onOpenDialog()
      }}
      title={title}
      aria-label={title}
      className="rounded-lg border border-slate-700 px-2.5 py-1.5 text-sm text-slate-300 hover:bg-slate-800"
    >
      ⋮
    </button>
  )
}

// Desktop right-click shortcut to the same action, surfaced as an explicit
// "Alterar › Categoria" menu (mouse-only — the ⋮ button above is what makes
// the same action reachable on touch). A hook rather than a wrapping
// component so callers can spread `onContextMenu` directly onto their own
// row element (an <li>, a <div>, ...) instead of nesting an extra element
// inside it, which would be invalid DOM when the row is a direct child of a
// <ul>/<table>. Render the returned `menu` node as a sibling next to the row
// (e.g. inside a React.Fragment) — it's `fixed`-positioned, so it never
// affects layout regardless of where it's mounted.
export function useEntryContextMenu(onOpenDialog: () => void) {
  const [menuPos, setMenuPos] = useState<{ x: number; y: number } | null>(null)

  useEffect(() => {
    if (!menuPos) return
    function close() {
      setMenuPos(null)
    }
    window.addEventListener('click', close)
    window.addEventListener('resize', close)
    return () => {
      window.removeEventListener('click', close)
      window.removeEventListener('resize', close)
    }
  }, [menuPos])

  function onContextMenu(e: { preventDefault: () => void; clientX: number; clientY: number }) {
    e.preventDefault()
    setMenuPos({ x: e.clientX, y: e.clientY })
  }

  const menu = menuPos ? (
    <div
      className="fixed z-40 min-w-[11rem] rounded-lg border border-slate-700 bg-slate-800 py-1 shadow-xl"
      style={{ left: menuPos.x, top: menuPos.y }}
      onClick={(e) => e.stopPropagation()}
    >
      <p className="px-3 py-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Alterar</p>
      <button
        type="button"
        onClick={() => {
          setMenuPos(null)
          onOpenDialog()
        }}
        className="block w-full px-3 py-1.5 text-left text-sm text-slate-200 hover:bg-slate-700"
      >
        Categoria…
      </button>
    </div>
  ) : null

  return { onContextMenu, menu }
}
