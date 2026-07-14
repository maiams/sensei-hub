'use client'

import { useState } from 'react'
import { apiFetch, ApiError } from '../lib/api'
import { translateApiError } from '../lib/labels'

interface Row {
  label: string
  maxKg: string // kept as string while editing; '' means open/last category
}

interface WeightCategoryGridProps {
  templateKey: string
  groupId: string
  initialLabel: string
  initialCategories: Array<{ label: string; maxKg: number | null }>
  canRestoreFromPreset: boolean
  canEdit: boolean
  onDeleted: () => void
}

function toRows(categories: Array<{ label: string; maxKg: number | null }>): Row[] {
  return categories.map((c) => ({ label: c.label, maxKg: c.maxKg === null ? '' : String(c.maxKg) }))
}

export function WeightCategoryGrid({
  templateKey,
  groupId,
  initialLabel,
  initialCategories,
  canRestoreFromPreset,
  canEdit,
  onDeleted,
}: WeightCategoryGridProps) {
  const [label, setLabel] = useState(initialLabel)
  const [rows, setRows] = useState<Row[]>(toRows(initialCategories))
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function updateRow(index: number, field: keyof Row, value: string) {
    setRows((prev) => prev.map((r, i) => (i === index ? { ...r, [field]: value } : r)))
  }

  function addRow() {
    setRows((prev) => [...prev, { label: '', maxKg: '' }])
  }

  function removeRow(index: number) {
    setRows((prev) => prev.filter((_, i) => i !== index))
  }

  async function handleSave() {
    setLoading(true)
    setError(null)
    try {
      const categories = rows.map((r) => ({
        label: r.label.trim(),
        maxKg: r.maxKg.trim() === '' ? null : Number(r.maxKg),
      }))
      const result = await apiFetch<{ label: string; categories: Array<{ label: string; maxKg: number | null }> }>(
        `/division-templates/${templateKey}/groups/${groupId}`,
        { method: 'PATCH', body: JSON.stringify({ label, categories }) },
      )
      setLabel(result.label)
      setRows(toRows(result.categories))
    } catch (err) {
      setError(err instanceof ApiError ? translateApiError(err.message) : 'Não foi possível salvar.')
    } finally {
      setLoading(false)
    }
  }

  async function handleRestore() {
    setLoading(true)
    setError(null)
    try {
      const result = await apiFetch<{ categories: Array<{ label: string; maxKg: number | null }> }>(
        `/division-templates/${templateKey}/groups/${groupId}/restore`,
        { method: 'POST' },
      )
      setRows(toRows(result.categories))
    } catch (err) {
      setError(err instanceof ApiError ? translateApiError(err.message) : 'Não foi possível restaurar.')
    } finally {
      setLoading(false)
    }
  }

  async function handleDelete() {
    if (!window.confirm(`Apagar o grupo "${label}"?`)) return
    setLoading(true)
    setError(null)
    try {
      await apiFetch(`/division-templates/${templateKey}/groups/${groupId}`, { method: 'DELETE' })
      onDeleted()
    } catch (err) {
      setError(err instanceof ApiError ? translateApiError(err.message) : 'Não foi possível apagar o grupo.')
      setLoading(false)
    }
  }

  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900 p-4">
      <div className="mb-3 flex items-center gap-2">
        <input
          type="text"
          value={label}
          disabled={!canEdit}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="Nome do grupo"
          className="flex-1 rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm font-medium text-white placeholder-slate-500 disabled:opacity-60"
        />
        {canRestoreFromPreset && (
          <span className="shrink-0 rounded-full bg-blue-950 px-2 py-0.5 text-xs font-medium text-blue-300">
            do padrão FPJ
          </span>
        )}
      </div>

      <div className="space-y-2">
        {rows.map((row, i) => (
          <div key={i} className="flex items-center gap-2">
            <input
              type="text"
              placeholder="Nome da categoria"
              value={row.label}
              disabled={!canEdit}
              onChange={(e) => updateRow(i, 'label', e.target.value)}
              className="flex-1 rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white placeholder-slate-500 disabled:opacity-60"
            />
            <input
              type="number"
              min="0"
              max="300"
              step="0.1"
              placeholder="até (kg) — vazio = aberta"
              value={row.maxKg}
              disabled={!canEdit}
              onChange={(e) => updateRow(i, 'maxKg', e.target.value)}
              className="w-44 rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white placeholder-slate-500 disabled:opacity-60"
            />
            {canEdit && (
              <button
                type="button"
                onClick={() => removeRow(i)}
                aria-label="Remover categoria"
                className="rounded-lg border border-slate-700 px-2 py-2 text-sm text-slate-400 hover:bg-slate-800 hover:text-red-400"
              >
                ✕
              </button>
            )}
          </div>
        ))}
      </div>

      {canEdit && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={addRow}
            className="rounded-lg border border-slate-700 px-3 py-2 text-sm text-slate-300 hover:bg-slate-800"
          >
            + Categoria
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={loading}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-500 disabled:opacity-60"
          >
            Salvar
          </button>
          {canRestoreFromPreset && (
            <button
              type="button"
              onClick={handleRestore}
              disabled={loading}
              className="rounded-lg border border-slate-700 px-4 py-2 text-sm text-slate-300 transition hover:bg-slate-800 disabled:opacity-60"
            >
              Restaurar valores da FPJ
            </button>
          )}
          <button
            type="button"
            onClick={handleDelete}
            disabled={loading}
            className="ml-auto rounded-lg border border-red-900 px-4 py-2 text-sm text-red-400 transition hover:bg-red-950 disabled:opacity-60"
          >
            Apagar grupo
          </button>
        </div>
      )}

      {error && <p className="mt-2 text-sm text-red-400">{error}</p>}
    </div>
  )
}
