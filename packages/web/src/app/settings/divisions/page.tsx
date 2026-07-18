'use client'

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { hasMinRole, type MatchRules, type UserRole } from '@sensei-hub/shared'
import { apiFetch, ApiError, getCurrentRole, isLoggedIn } from '../../../lib/api'
import { translateApiError } from '../../../lib/labels'
import { WeightCategoryGrid, type GroupDraft } from '../../../components/WeightCategoryGrid'

interface GroupDTO {
  id: string
  label: string
  order: number
  categories: Array<{ label: string; maxKg: number | null }>
  canRestoreFromPreset: boolean
}

interface TemplateDTO {
  id: string
  key: string
  label: string
  minAge: number | null
  maxAge: number | null
  matchRules: MatchRules
  order: number
  groups: GroupDTO[]
}

// Everything editable lives in the draft as strings (numbers parsed on save),
// so dirty detection is a plain structural comparison against the last
// server snapshot converted through the same normalization.
interface RulesDraft {
  matchDurationMin: string
  goldenScoreEnabled: boolean
  goldenScoreLimitMin: string // '' = sem limite
  osaekomiYuko: string
  osaekomiWazaari: string
  osaekomiIppon: string
}

interface TemplateDraft {
  id: string
  key: string
  label: string
  minAge: string
  maxAge: string
  rules: RulesDraft
  groups: GroupDraft[]
}

function minutesLabel(seconds: number): string {
  const min = seconds / 60
  return Number.isInteger(min) ? String(min) : String(Math.round(min * 10) / 10)
}

function toRulesDraft(rules: MatchRules): RulesDraft {
  return {
    matchDurationMin: minutesLabel(rules.matchDurationSeconds),
    goldenScoreEnabled: rules.goldenScoreEnabled,
    goldenScoreLimitMin: rules.goldenScoreDurationSeconds === null ? '' : minutesLabel(rules.goldenScoreDurationSeconds),
    osaekomiYuko: String(rules.osaekomiYukoSeconds),
    osaekomiWazaari: String(rules.osaekomiWazaariSeconds),
    osaekomiIppon: String(rules.osaekomiIpponSeconds),
  }
}

function toDraft(templates: TemplateDTO[]): TemplateDraft[] {
  return templates.map((t) => ({
    id: t.id,
    key: t.key,
    label: t.label,
    minAge: t.minAge === null ? '' : String(t.minAge),
    maxAge: t.maxAge === null ? '' : String(t.maxAge),
    rules: toRulesDraft(t.matchRules),
    groups: t.groups.map((g) => ({
      id: g.id,
      label: g.label,
      categories: g.categories.map((c) => ({ label: c.label, maxKg: c.maxKg === null ? '' : String(c.maxKg) })),
      canRestoreFromPreset: g.canRestoreFromPreset,
    })),
  }))
}

function parseRules(rules: RulesDraft): MatchRules {
  return {
    matchDurationSeconds: Math.round(Number(rules.matchDurationMin) * 60),
    goldenScoreEnabled: rules.goldenScoreEnabled,
    goldenScoreDurationSeconds: rules.goldenScoreLimitMin.trim() === '' ? null : Math.round(Number(rules.goldenScoreLimitMin) * 60),
    osaekomiYukoSeconds: Number(rules.osaekomiYuko),
    osaekomiWazaariSeconds: Number(rules.osaekomiWazaari),
    osaekomiIpponSeconds: Number(rules.osaekomiIppon),
  }
}

export default function DivisionsSettingsPage() {
  const router = useRouter()
  const [serverDraft, setServerDraft] = useState<TemplateDraft[] | null>(null)
  const [draft, setDraft] = useState<TemplateDraft[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [canEdit, setCanEdit] = useState(false)

  const dirty = useMemo(
    () => serverDraft !== null && draft !== null && JSON.stringify(serverDraft) !== JSON.stringify(draft),
    [serverDraft, draft],
  )
  const dirtyRef = useRef(dirty)
  dirtyRef.current = dirty

  const load = useCallback(async () => {
    try {
      const data = await apiFetch<TemplateDTO[]>('/division-templates')
      const normalized = toDraft(data)
      setServerDraft(normalized)
      setDraft(structuredClone(normalized))
    } catch {
      setError('Não foi possível carregar as divisões.')
    }
  }, [])

  useEffect(() => {
    if (!isLoggedIn()) {
      router.replace('/login')
      return
    }
    const role = getCurrentRole()
    setCanEdit(role !== null && hasMinRole(role as UserRole, 'academy_admin'))
    void load()
  }, [router, load])

  // Warn on tab close / reload with unsaved edits.
  useEffect(() => {
    function onBeforeUnload(e: BeforeUnloadEvent) {
      if (dirtyRef.current) {
        e.preventDefault()
      }
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [])

  function updateTemplate(index: number, updated: TemplateDraft) {
    setDraft((prev) => (prev ? prev.map((t, i) => (i === index ? updated : t)) : prev))
  }

  // Structural actions reload the whole screen; with pending edits, make the
  // person explicitly accept losing them first.
  function confirmDiscardIfDirty(): boolean {
    if (!dirty) return true
    return window.confirm('Você tem alterações não salvas. Esta ação recarrega a tela e as descarta. Continuar?')
  }

  async function runStructuralAction(action: () => Promise<unknown>, failMessage: string) {
    if (!confirmDiscardIfDirty()) return
    setError(null)
    try {
      await action()
      await load()
    } catch (err) {
      setError(err instanceof ApiError ? translateApiError(err.message) : failMessage)
    }
  }

  async function handleSaveAll() {
    if (!serverDraft || !draft) return
    setSaving(true)
    setError(null)
    const serverByKey = new Map(serverDraft.map((t) => [t.key, t]))
    try {
      for (const template of draft) {
        const original = serverByKey.get(template.key)
        if (!original) continue

        const headerChanged =
          template.label !== original.label ||
          template.minAge !== original.minAge ||
          template.maxAge !== original.maxAge ||
          JSON.stringify(template.rules) !== JSON.stringify(original.rules)
        if (headerChanged) {
          try {
            await apiFetch(`/division-templates/${template.key}`, {
              method: 'PATCH',
              body: JSON.stringify({
                label: template.label,
                minAge: template.minAge.trim() === '' ? null : Number(template.minAge),
                maxAge: template.maxAge.trim() === '' ? null : Number(template.maxAge),
                matchRules: parseRules(template.rules),
              }),
            })
          } catch (err) {
            throw new SaveItemError(`divisão "${template.label}"`, err)
          }
        }

        const originalGroups = new Map(original.groups.map((g) => [g.id, g]))
        for (const group of template.groups) {
          const originalGroup = originalGroups.get(group.id)
          if (!originalGroup) continue
          if (JSON.stringify(group) === JSON.stringify(originalGroup)) continue
          try {
            await apiFetch(`/division-templates/${template.key}/groups/${group.id}`, {
              method: 'PATCH',
              body: JSON.stringify({
                label: group.label,
                categories: group.categories.map((c) => ({
                  label: c.label.trim(),
                  maxKg: c.maxKg.trim() === '' ? null : Number(c.maxKg),
                })),
              }),
            })
          } catch (err) {
            throw new SaveItemError(`grupo "${group.label}" (divisão "${template.label}")`, err)
          }
        }
      }
      await load()
    } catch (err) {
      if (err instanceof SaveItemError) {
        const detail = err.cause instanceof ApiError ? translateApiError(err.cause.message) : 'erro inesperado'
        setError(`Falha ao salvar ${err.itemDescription}: ${detail}. As demais alterações continuam pendentes abaixo.`)
      } else {
        setError('Não foi possível salvar as alterações.')
      }
    } finally {
      setSaving(false)
    }
  }

  function handleDiscard() {
    if (!serverDraft) return
    setDraft(structuredClone(serverDraft))
    setError(null)
  }

  function handleBack() {
    if (dirty && !window.confirm('Você tem alterações não salvas. Sair mesmo assim?')) return
    router.push('/athletes')
  }

  return (
    <main className="min-h-screen bg-slate-950 px-4 py-8 pb-24 text-white">
      <div className="mx-auto max-w-3xl space-y-6">
        <div>
          <button
            type="button"
            onClick={handleBack}
            className="mb-4 inline-block text-sm text-slate-400 hover:text-slate-200"
          >
            ← Voltar
          </button>
          <h1 className="text-2xl font-bold tracking-tight">Divisões</h1>
          <p className="mt-1 text-slate-400">
            Configure as divisões, grupos e regras de luta usados nas suas competições. Nada aqui é fixo: crie, edite,
            misture ou apague à vontade — os padrões FPJ/CBJ são só um ponto de partida.
          </p>
          {!canEdit && (
            <p className="mt-2 text-sm text-amber-400">
              Apenas administradores da academia podem editar. Você está vendo em modo leitura.
            </p>
          )}
        </div>

        {error && (
          <div className="rounded-lg border border-red-800 bg-red-950 px-4 py-3 text-sm text-red-300">{error}</div>
        )}

        {!error && !draft && <p className="text-slate-400">Carregando…</p>}

        {draft && draft.length === 0 && (
          <div className="rounded-lg border border-slate-800 bg-slate-900 p-6 text-center">
            <p className="mb-4 text-slate-400">Nenhuma divisão configurada.</p>
            {canEdit && (
              <button
                type="button"
                onClick={() =>
                  runStructuralAction(
                    () => apiFetch('/division-templates/load-preset', { method: 'POST' }),
                    'Não foi possível carregar o padrão.',
                  )
                }
                className="rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-blue-500"
              >
                Carregar padrão FPJ
              </button>
            )}
          </div>
        )}

        {draft?.map((template, index) => (
          <DivisionCard
            key={template.id}
            template={template}
            canEdit={canEdit}
            onChange={(updated) => updateTemplate(index, updated)}
            onDeleteDivision={() => {
              const groupCount = template.groups.length
              const warning =
                groupCount > 0
                  ? `Apagar "${template.label}"? Isso também apaga ${groupCount} grupo(s) dela.`
                  : `Apagar "${template.label}"?`
              if (!window.confirm(warning)) return
              void runStructuralAction(
                () => apiFetch(`/division-templates/${template.key}`, { method: 'DELETE' }),
                'Não foi possível apagar.',
              )
            }}
            onAddGroup={(label) =>
              runStructuralAction(
                () =>
                  apiFetch(`/division-templates/${template.key}/groups`, {
                    method: 'POST',
                    body: JSON.stringify({ label, categories: [{ label: 'Único', maxKg: null }] }),
                  }),
                'Não foi possível criar o grupo.',
              )
            }
            onDeleteGroup={(group) => {
              if (!window.confirm(`Apagar o grupo "${group.label}"?`)) return
              void runStructuralAction(
                () => apiFetch(`/division-templates/${template.key}/groups/${group.id}`, { method: 'DELETE' }),
                'Não foi possível apagar o grupo.',
              )
            }}
            onRestoreGroup={(group) =>
              runStructuralAction(
                () => apiFetch(`/division-templates/${template.key}/groups/${group.id}/restore`, { method: 'POST' }),
                'Não foi possível restaurar.',
              )
            }
          />
        ))}

        {canEdit && draft && draft.length > 0 && (
          <button
            type="button"
            onClick={() =>
              runStructuralAction(
                () => apiFetch('/division-templates/load-preset', { method: 'POST' }),
                'Não foi possível carregar o padrão.',
              )
            }
            className="text-sm text-slate-400 underline decoration-dotted hover:text-slate-200"
          >
            Carregar divisões do padrão FPJ que ainda faltam
          </button>
        )}

        {canEdit && draft && (
          <NewDivisionForm
            onCreate={(body) =>
              runStructuralAction(
                () => apiFetch('/division-templates', { method: 'POST', body: JSON.stringify(body) }),
                'Não foi possível criar a divisão.',
              )
            }
          />
        )}
      </div>

      {canEdit && dirty && (
        <div className="fixed inset-x-0 bottom-0 border-t border-slate-700 bg-slate-900/95 px-4 py-3 backdrop-blur">
          <div className="mx-auto flex max-w-3xl items-center gap-3">
            <p className="flex-1 text-sm text-amber-300">Você tem alterações não salvas.</p>
            <button
              type="button"
              onClick={handleDiscard}
              disabled={saving}
              className="rounded-lg border border-slate-700 px-4 py-2 text-sm text-slate-300 transition hover:bg-slate-800 disabled:opacity-60"
            >
              Descartar
            </button>
            <button
              type="button"
              onClick={handleSaveAll}
              disabled={saving}
              className="rounded-lg bg-blue-600 px-5 py-2 text-sm font-semibold text-white transition hover:bg-blue-500 disabled:opacity-60"
            >
              {saving ? 'Salvando…' : 'Salvar alterações'}
            </button>
          </div>
        </div>
      )}
    </main>
  )
}

class SaveItemError extends Error {
  constructor(
    public readonly itemDescription: string,
    public override readonly cause: unknown,
  ) {
    super(`Failed saving ${itemDescription}`)
    this.name = 'SaveItemError'
  }
}

function ageRangeLabel(minAge: string, maxAge: string): string {
  if (minAge === '' && maxAge === '') return 'Sem restrição de idade'
  if (maxAge === '') return `${minAge}+ anos`
  if (minAge === '') return `até ${maxAge} anos`
  return `${minAge}–${maxAge} anos`
}

function rulesSummary(rules: RulesDraft): string {
  const gs = rules.goldenScoreEnabled
    ? rules.goldenScoreLimitMin === ''
      ? 'golden score sem limite'
      : `golden score até ${rules.goldenScoreLimitMin} min`
    : 'sem golden score'
  return `Luta de ${rules.matchDurationMin} min, ${gs}. Osaekomi: yuko ${rules.osaekomiYuko}s, waza-ari ${rules.osaekomiWazaari}s, ippon ${rules.osaekomiIppon}s.`
}

function DivisionCard({
  template,
  canEdit,
  onChange,
  onDeleteDivision,
  onAddGroup,
  onDeleteGroup,
  onRestoreGroup,
}: {
  template: TemplateDraft
  canEdit: boolean
  onChange: (updated: TemplateDraft) => void
  onDeleteDivision: () => void
  onAddGroup: (label: string) => void
  onDeleteGroup: (group: GroupDraft) => void
  onRestoreGroup: (group: GroupDraft) => void
}) {
  const [addingGroup, setAddingGroup] = useState(false)
  const [newGroupLabel, setNewGroupLabel] = useState('')

  function setRules(patch: Partial<RulesDraft>) {
    onChange({ ...template, rules: { ...template.rules, ...patch } })
  }

  function handleAddGroup(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    onAddGroup(newGroupLabel)
    setNewGroupLabel('')
    setAddingGroup(false)
  }

  const inputClass =
    'rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-white placeholder-slate-500 disabled:opacity-60'

  return (
    <section className="rounded-lg border border-slate-800 bg-slate-900 p-4">
      {canEdit ? (
        <>
          <div className="mb-3 flex flex-wrap items-end gap-2">
            <div className="flex-1">
              <label className="mb-1 block text-xs text-slate-500">Nome da divisão</label>
              <input
                type="text"
                value={template.label}
                onChange={(e) => onChange({ ...template, label: e.target.value })}
                className={`w-full ${inputClass}`}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-slate-500">Idade mín.</label>
              <input
                type="number"
                min="0"
                max="120"
                value={template.minAge}
                onChange={(e) => onChange({ ...template, minAge: e.target.value })}
                placeholder="—"
                className={`w-24 ${inputClass}`}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-slate-500">Idade máx.</label>
              <input
                type="number"
                min="0"
                max="120"
                value={template.maxAge}
                onChange={(e) => onChange({ ...template, maxAge: e.target.value })}
                placeholder="sem limite"
                className={`w-24 ${inputClass}`}
              />
            </div>
            <button
              type="button"
              onClick={onDeleteDivision}
              className="rounded-lg border border-red-900 px-4 py-2 text-sm text-red-400 transition hover:bg-red-950"
            >
              Apagar divisão
            </button>
          </div>

          <div className="mb-4 rounded-lg border border-slate-800 bg-slate-950/60 p-3">
            <p className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">
              Regras de luta — padrão CBJ (RNC 2025), edite livremente
            </p>
            <div className="flex flex-wrap items-end gap-x-4 gap-y-2 text-sm">
              <div>
                <label className="mb-1 block text-xs text-slate-500">Tempo de luta (min)</label>
                <input
                  type="number"
                  min="0.5"
                  max="20"
                  step="0.5"
                  value={template.rules.matchDurationMin}
                  onChange={(e) => setRules({ matchDurationMin: e.target.value })}
                  className={`w-24 text-sm ${inputClass}`}
                />
              </div>
              <label className="flex items-center gap-2 pb-2 text-sm text-slate-300">
                <input
                  type="checkbox"
                  checked={template.rules.goldenScoreEnabled}
                  onChange={(e) => setRules({ goldenScoreEnabled: e.target.checked })}
                  className="h-4 w-4 accent-blue-600"
                />
                Golden score
              </label>
              <div>
                <label className="mb-1 block text-xs text-slate-500">Limite do GS (min)</label>
                <input
                  type="number"
                  min="0.5"
                  max="20"
                  step="0.5"
                  value={template.rules.goldenScoreLimitMin}
                  disabled={!template.rules.goldenScoreEnabled}
                  onChange={(e) => setRules({ goldenScoreLimitMin: e.target.value })}
                  placeholder="sem limite"
                  className={`w-28 text-sm ${inputClass}`}
                />
              </div>
              <div>
                <label className="mb-1 block text-xs text-slate-500">Osaekomi — Yuko (s)</label>
                <input
                  type="number"
                  min="1"
                  max="60"
                  value={template.rules.osaekomiYuko}
                  onChange={(e) => setRules({ osaekomiYuko: e.target.value })}
                  className={`w-20 text-sm ${inputClass}`}
                />
              </div>
              <div>
                <label className="mb-1 block text-xs text-slate-500">Waza-ari (s)</label>
                <input
                  type="number"
                  min="1"
                  max="60"
                  value={template.rules.osaekomiWazaari}
                  onChange={(e) => setRules({ osaekomiWazaari: e.target.value })}
                  className={`w-20 text-sm ${inputClass}`}
                />
              </div>
              <div>
                <label className="mb-1 block text-xs text-slate-500">Ippon (s)</label>
                <input
                  type="number"
                  min="1"
                  max="60"
                  value={template.rules.osaekomiIppon}
                  onChange={(e) => setRules({ osaekomiIppon: e.target.value })}
                  className={`w-20 text-sm ${inputClass}`}
                />
              </div>
            </div>
          </div>
        </>
      ) : (
        <div className="mb-4">
          <h2 className="text-lg font-semibold text-white">{template.label}</h2>
          <p className="text-sm text-slate-500">{ageRangeLabel(template.minAge, template.maxAge)}</p>
          <p className="mt-1 text-sm text-slate-500">{rulesSummary(template.rules)}</p>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        {template.groups.map((group, groupIndex) => (
          <WeightCategoryGrid
            key={group.id}
            group={group}
            canEdit={canEdit}
            onChange={(updated) =>
              onChange({ ...template, groups: template.groups.map((g, i) => (i === groupIndex ? updated : g)) })
            }
            onDelete={() => onDeleteGroup(group)}
            onRestore={() => onRestoreGroup(group)}
          />
        ))}
      </div>

      {template.groups.length === 0 && <p className="text-sm text-slate-500">Nenhum grupo nesta divisão ainda.</p>}

      {canEdit && (
        <div className="mt-4">
          {addingGroup ? (
            <form onSubmit={handleAddGroup} className="flex items-center gap-2">
              <input
                type="text"
                required
                autoFocus
                value={newGroupLabel}
                onChange={(e) => setNewGroupLabel(e.target.value)}
                placeholder="Nome do grupo (ex: Masculino, Misto, Cadeirantes)"
                className="flex-1 rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white placeholder-slate-500"
              />
              <button
                type="submit"
                className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-500"
              >
                Criar
              </button>
              <button
                type="button"
                onClick={() => setAddingGroup(false)}
                className="rounded-lg border border-slate-700 px-3 py-2 text-sm text-slate-300 hover:bg-slate-800"
              >
                Cancelar
              </button>
            </form>
          ) : (
            <button
              type="button"
              onClick={() => setAddingGroup(true)}
              className="rounded-lg border border-slate-700 px-3 py-2 text-sm text-slate-300 hover:bg-slate-800"
            >
              + Adicionar grupo
            </button>
          )}
        </div>
      )}
    </section>
  )
}

function NewDivisionForm({
  onCreate,
}: {
  onCreate: (body: { label: string; minAge: number | undefined; maxAge: number | undefined }) => void
}) {
  const [open, setOpen] = useState(false)
  const [label, setLabel] = useState('')
  const [minAge, setMinAge] = useState('')
  const [maxAge, setMaxAge] = useState('')

  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    onCreate({
      label,
      minAge: minAge.trim() === '' ? undefined : Number(minAge),
      maxAge: maxAge.trim() === '' ? undefined : Number(maxAge),
    })
    setLabel('')
    setMinAge('')
    setMaxAge('')
    setOpen(false)
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="w-full rounded-lg border border-dashed border-slate-700 px-4 py-3 text-sm text-slate-400 transition hover:border-slate-600 hover:text-slate-200"
      >
        + Criar divisão
      </button>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="rounded-lg border border-slate-800 bg-slate-900 p-4">
      <h2 className="mb-3 font-semibold text-white">Nova divisão</h2>
      <div className="mb-3 flex flex-wrap items-end gap-2">
        <div className="flex-1">
          <label className="mb-1 block text-xs text-slate-500">Nome</label>
          <input
            type="text"
            required
            autoFocus
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Ex: Livre, PCD, Sub-15"
            className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-white placeholder-slate-500"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs text-slate-500">Idade mín.</label>
          <input
            type="number"
            min="0"
            max="120"
            value={minAge}
            onChange={(e) => setMinAge(e.target.value)}
            placeholder="—"
            className="w-24 rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-white placeholder-slate-500"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs text-slate-500">Idade máx.</label>
          <input
            type="number"
            min="0"
            max="120"
            value={maxAge}
            onChange={(e) => setMaxAge(e.target.value)}
            placeholder="sem limite"
            className="w-24 rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-white placeholder-slate-500"
          />
        </div>
      </div>
      <p className="mb-3 text-xs text-slate-500">
        Deixe idade em branco se a divisão não tiver restrição etária. As regras de luta nascem com o padrão CBJ e
        podem ser editadas no card da divisão.
      </p>
      <div className="flex items-center gap-2">
        <button
          type="submit"
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-500"
        >
          Criar divisão
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="rounded-lg border border-slate-700 px-3 py-2 text-sm text-slate-300 hover:bg-slate-800"
        >
          Cancelar
        </button>
      </div>
    </form>
  )
}
