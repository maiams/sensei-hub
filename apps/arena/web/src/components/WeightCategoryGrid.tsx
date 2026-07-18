'use client'

// Controlled weight-category grid for one division group. All edits flow up
// to the page's draft state (single "Salvar alterações" bar in
// /settings/divisions) — this component has no save of its own. Structural
// actions (delete group, restore from preset) stay immediate and are handled
// by the parent via callbacks.

export interface GroupDraft {
  id: string
  label: string
  categories: Array<{ label: string; maxKg: string }> // maxKg as string while editing; '' = open/last category
  canRestoreFromPreset: boolean
}

interface WeightCategoryGridProps {
  group: GroupDraft
  canEdit: boolean
  onChange: (updated: GroupDraft) => void
  onDelete: () => void
  onRestore: () => void
}

export function WeightCategoryGrid({ group, canEdit, onChange, onDelete, onRestore }: WeightCategoryGridProps) {
  function updateRow(index: number, field: 'label' | 'maxKg', value: string) {
    onChange({
      ...group,
      categories: group.categories.map((c, i) => (i === index ? { ...c, [field]: value } : c)),
    })
  }

  function addRow() {
    onChange({ ...group, categories: [...group.categories, { label: '', maxKg: '' }] })
  }

  function removeRow(index: number) {
    onChange({ ...group, categories: group.categories.filter((_, i) => i !== index) })
  }

  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900 p-4">
      <div className="mb-3 flex items-center gap-2">
        <input
          type="text"
          value={group.label}
          disabled={!canEdit}
          onChange={(e) => onChange({ ...group, label: e.target.value })}
          placeholder="Nome do grupo"
          className="flex-1 rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm font-medium text-white placeholder-slate-500 disabled:opacity-60"
        />
        {group.canRestoreFromPreset && (
          <span className="shrink-0 rounded-full bg-blue-950 px-2 py-0.5 text-xs font-medium text-blue-300">
            do padrão FPJ
          </span>
        )}
      </div>

      <div className="space-y-2">
        {group.categories.map((row, i) => (
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
          {group.canRestoreFromPreset && (
            <button
              type="button"
              onClick={onRestore}
              className="rounded-lg border border-slate-700 px-4 py-2 text-sm text-slate-300 transition hover:bg-slate-800"
            >
              Restaurar valores da FPJ
            </button>
          )}
          <button
            type="button"
            onClick={onDelete}
            className="ml-auto rounded-lg border border-red-900 px-4 py-2 text-sm text-red-400 transition hover:bg-red-950"
          >
            Apagar grupo
          </button>
        </div>
      )}
    </div>
  )
}
