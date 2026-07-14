'use client'

import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { hasMinRole, type UserRole } from '@sensei-hub/shared'
import { apiFetch, ApiError, getCurrentRole, isLoggedIn } from '../../../lib/api'
import { translateApiError } from '../../../lib/labels'
import { WeightCategoryGrid } from '../../../components/WeightCategoryGrid'

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
  order: number
  groups: GroupDTO[]
}

export default function DivisionsSettingsPage() {
  const router = useRouter()
  const [templates, setTemplates] = useState<TemplateDTO[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [canEdit, setCanEdit] = useState(false)

  const load = useCallback(async () => {
    try {
      const data = await apiFetch<TemplateDTO[]>('/division-templates')
      setTemplates(data)
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

  async function handleLoadPreset() {
    setError(null)
    try {
      await apiFetch('/division-templates/load-preset', { method: 'POST' })
      await load()
    } catch (err) {
      setError(err instanceof ApiError ? translateApiError(err.message) : 'Não foi possível carregar o padrão.')
    }
  }

  return (
    <main className="min-h-screen bg-slate-950 px-4 py-8 text-white">
      <div className="mx-auto max-w-3xl space-y-6">
        <div>
          <Link href="/athletes" className="mb-4 inline-block text-sm text-slate-400 hover:text-slate-200">
            ← Voltar
          </Link>
          <h1 className="text-2xl font-bold tracking-tight">Divisões</h1>
          <p className="mt-1 text-slate-400">
            Configure as divisões e grupos usados nas suas competições. Nada aqui é fixo: crie, edite, misture ou
            apague à vontade — o padrão FPJ é só um ponto de partida.
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

        {!error && !templates && <p className="text-slate-400">Carregando…</p>}

        {templates && templates.length === 0 && (
          <div className="rounded-lg border border-slate-800 bg-slate-900 p-6 text-center">
            <p className="mb-4 text-slate-400">Nenhuma divisão configurada.</p>
            {canEdit && (
              <button
                type="button"
                onClick={handleLoadPreset}
                className="rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-blue-500"
              >
                Carregar padrão FPJ
              </button>
            )}
          </div>
        )}

        {templates?.map((template) => (
          <DivisionCard key={template.id} template={template} canEdit={canEdit} onChanged={load} />
        ))}

        {canEdit && templates && templates.length > 0 && (
          <button
            type="button"
            onClick={handleLoadPreset}
            className="text-sm text-slate-400 underline decoration-dotted hover:text-slate-200"
          >
            Carregar divisões do padrão FPJ que ainda faltam
          </button>
        )}

        {canEdit && <NewDivisionForm onCreated={load} />}
      </div>
    </main>
  )
}

function ageRangeLabel(minAge: number | null, maxAge: number | null): string {
  if (minAge === null && maxAge === null) return 'Sem restrição de idade'
  if (maxAge === null) return `${minAge}+ anos`
  if (minAge === null) return `até ${maxAge} anos`
  return `${minAge}–${maxAge} anos`
}

function DivisionCard({
  template,
  canEdit,
  onChanged,
}: {
  template: TemplateDTO
  canEdit: boolean
  onChanged: () => void
}) {
  const [label, setLabel] = useState(template.label)
  const [minAge, setMinAge] = useState(template.minAge?.toString() ?? '')
  const [maxAge, setMaxAge] = useState(template.maxAge?.toString() ?? '')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [addingGroup, setAddingGroup] = useState(false)
  const [newGroupLabel, setNewGroupLabel] = useState('')

  async function handleSaveDivision() {
    setLoading(true)
    setError(null)
    try {
      await apiFetch(`/division-templates/${template.key}`, {
        method: 'PATCH',
        body: JSON.stringify({
          label,
          minAge: minAge.trim() === '' ? null : Number(minAge),
          maxAge: maxAge.trim() === '' ? null : Number(maxAge),
        }),
      })
      onChanged()
    } catch (err) {
      setError(err instanceof ApiError ? translateApiError(err.message) : 'Não foi possível salvar.')
    } finally {
      setLoading(false)
    }
  }

  async function handleDeleteDivision() {
    const groupCount = template.groups.length
    const warning =
      groupCount > 0
        ? `Apagar "${template.label}"? Isso também apaga ${groupCount} grupo(s) dela.`
        : `Apagar "${template.label}"?`
    if (!window.confirm(warning)) return
    setLoading(true)
    setError(null)
    try {
      await apiFetch(`/division-templates/${template.key}`, { method: 'DELETE' })
      onChanged()
    } catch (err) {
      setError(err instanceof ApiError ? translateApiError(err.message) : 'Não foi possível apagar.')
      setLoading(false)
    }
  }

  async function handleAddGroup(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setLoading(true)
    setError(null)
    try {
      await apiFetch(`/division-templates/${template.key}/groups`, {
        method: 'POST',
        body: JSON.stringify({ label: newGroupLabel, categories: [{ label: 'Único', maxKg: null }] }),
      })
      setNewGroupLabel('')
      setAddingGroup(false)
      onChanged()
    } catch (err) {
      setError(err instanceof ApiError ? translateApiError(err.message) : 'Não foi possível criar o grupo.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <section className="rounded-lg border border-slate-800 bg-slate-900 p-4">
      <div className="mb-4 flex flex-wrap items-end gap-2">
        {canEdit ? (
          <>
            <div className="flex-1">
              <label className="mb-1 block text-xs text-slate-500">Nome da divisão</label>
              <input
                type="text"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-white"
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
            <button
              type="button"
              onClick={handleSaveDivision}
              disabled={loading}
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-500 disabled:opacity-60"
            >
              Salvar
            </button>
            <button
              type="button"
              onClick={handleDeleteDivision}
              disabled={loading}
              className="rounded-lg border border-red-900 px-4 py-2 text-sm text-red-400 transition hover:bg-red-950 disabled:opacity-60"
            >
              Apagar divisão
            </button>
          </>
        ) : (
          <div>
            <h2 className="text-lg font-semibold text-white">{template.label}</h2>
            <p className="text-sm text-slate-500">{ageRangeLabel(template.minAge, template.maxAge)}</p>
          </div>
        )}
      </div>

      {error && <p className="mb-3 text-sm text-red-400">{error}</p>}

      <div className="grid gap-4 sm:grid-cols-2">
        {template.groups.map((group) => (
          <WeightCategoryGrid
            key={group.id}
            templateKey={template.key}
            groupId={group.id}
            initialLabel={group.label}
            initialCategories={group.categories}
            canRestoreFromPreset={group.canRestoreFromPreset}
            canEdit={canEdit}
            onDeleted={onChanged}
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
                disabled={loading}
                className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-500 disabled:opacity-60"
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

function NewDivisionForm({ onCreated }: { onCreated: () => void }) {
  const [open, setOpen] = useState(false)
  const [label, setLabel] = useState('')
  const [minAge, setMinAge] = useState('')
  const [maxAge, setMaxAge] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setLoading(true)
    setError(null)
    try {
      await apiFetch('/division-templates', {
        method: 'POST',
        body: JSON.stringify({
          label,
          minAge: minAge.trim() === '' ? undefined : Number(minAge),
          maxAge: maxAge.trim() === '' ? undefined : Number(maxAge),
        }),
      })
      setLabel('')
      setMinAge('')
      setMaxAge('')
      setOpen(false)
      onCreated()
    } catch (err) {
      setError(err instanceof ApiError ? translateApiError(err.message) : 'Não foi possível criar a divisão.')
    } finally {
      setLoading(false)
    }
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
      <p className="mb-3 text-xs text-slate-500">Deixe idade em branco se a divisão não tiver restrição etária.</p>
      {error && <p className="mb-3 text-sm text-red-400">{error}</p>}
      <div className="flex items-center gap-2">
        <button
          type="submit"
          disabled={loading}
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-500 disabled:opacity-60"
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
