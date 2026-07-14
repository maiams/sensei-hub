'use client'

import { useState } from 'react'
import { apiFetch, ApiError } from '../lib/api'
import { translateApiError } from '../lib/labels'

interface Row {
  label: string
  maxKg: string // kept as string while editing; '' means open/last category
}

interface WeightCategoryGridProps {
  groupKey: string
  gender: 'male' | 'female'
  initialCategories: Array<{ label: string; maxKg: number | null }>
  initialIsDefault: boolean
  canEdit: boolean
}

function toRows(categories: Array<{ label: string; maxKg: number | null }>): Row[] {
  return categories.map((c) => ({ label: c.label, maxKg: c.maxKg === null ? '' : String(c.maxKg) }))
}

export function WeightCategoryGrid({ groupKey, gender, initialCategories, initialIsDefault, canEdit }: WeightCategoryGridProps) {
  const [rows, setRows] = useState<Row[]>(toRows(initialCategories))
  const [isDefault, setIsDefault] = useState(initialIsDefault)
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
      const result = await apiFetch<{ categories: Array<{ label: string; maxKg: number | null }>; isDefault: boolean }>(
        `/weight-categories/${groupKey}/${gender}`,
        { method: 'PUT', body: JSON.stringify({ categories }) },
      )
      setRows(toRows(result.categories))
      setIsDefault(result.isDefault)
    } catch (err) {
      setError(err instanceof ApiError ? translateApiError(err.message) : 'Não foi possível salvar.')
    } finally {
      setLoading(false)
    }
  }

  async function handleReset() {
    setLoading(true)
    setError(null)
    try {
      const result = await apiFetch<{ categories: Array<{ label: string; maxKg: number | null }>; isDefault: boolean }>(
        `/weight-categories/${groupKey}/${gender}`,
        { method: 'DELETE' },
      )
      setRows(toRows(result.categories))
      setIsDefault(result.isDefault)
    } catch (err) {
      setError(err instanceof ApiError ? translateApiError(err.message) : 'Não foi possível restaurar o padrão.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900 p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="font-medium text-white">{gender === 'male' ? 'Masculino' : 'Feminino'}</h3>
        <span
          className={
            'rounded-full px-2 py-0.5 text-xs font-medium ' +
            (isDefault ? 'bg-slate-800 text-slate-400' : 'bg-blue-950 text-blue-300')
          }
        >
          {isDefault ? 'Padrão' : 'Personalizado'}
        </span>
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
          {!isDefault && (
            <button
              type="button"
              onClick={handleReset}
              disabled={loading}
              className="rounded-lg border border-slate-700 px-4 py-2 text-sm text-slate-300 transition hover:bg-slate-800 disabled:opacity-60"
            >
              Restaurar padrão
            </button>
          )}
        </div>
      )}

      {error && <p className="mt-2 text-sm text-red-400">{error}</p>}
    </div>
  )
}
