'use client'

// Grouped, collapsible replacement for the old flat divisions list. With a
// real academy preset (52 athletes → 106 divisions, 78 empty, 17 with a
// single athlete — see CLAUDE.md session diagnosis) a flat list is
// unusable; this groups by age division then by group (gender/category),
// counts entries/confirmed per division, lets the manager hide empty
// divisions, and highlights the ones with exactly one athlete (no possible
// opponent) since those need a decision — see DivisionDetail's
// SingletonResolver.

import { useCallback, useEffect, useState, type FormEvent } from 'react'
import Link from 'next/link'
import { apiFetch, ApiError } from '../../../../lib/api'
import { translateApiError } from '../../../../lib/labels'
import { groupDivisions, shortDivisionLabel, type DivisionLite } from './divisionGrouping'
import { DivisionDetail, type EntryLite } from './DivisionDetail'

function ageRangeLabel(minAge: number | null, maxAge: number | null): string {
  if (minAge === null && maxAge === null) return 'sem restrição de idade'
  if (maxAge === null) return `${minAge}+ anos`
  if (minAge === null) return `até ${maxAge} anos`
  return `${minAge}–${maxAge} anos`
}

function weightLabel(weightLimitKg: number | null): string {
  return weightLimitKg === null ? 'aberta' : `até ${weightLimitKg}kg`
}

export function DivisionsPanel({
  eventId,
  divisions,
  canManage,
  onChanged,
  entriesRefreshKey,
  onEntriesChanged,
}: {
  eventId: string
  divisions: DivisionLite[]
  canManage: boolean
  onChanged: () => void
  entriesRefreshKey: number
  onEntriesChanged: () => void
}) {
  const [entries, setEntries] = useState<EntryLite[]>([])
  const [error, setError] = useState<string | null>(null)
  const [importing, setImporting] = useState(false)
  const [importResult, setImportResult] = useState<number | null>(null)
  const [addingDivision, setAddingDivision] = useState(false)
  const [hideEmpty, setHideEmpty] = useState(true)
  const [filterText, setFilterText] = useState('')
  const [expandedAge, setExpandedAge] = useState<Set<string>>(new Set())
  const [expandedSub, setExpandedSub] = useState<Set<string>>(new Set())
  const [expandedDivision, setExpandedDivision] = useState<Set<string>>(new Set())

  const loadEntries = useCallback(async () => {
    try {
      const data = await apiFetch<EntryLite[]>(`/events/${eventId}/entries`)
      setEntries(data)
    } catch {
      // counts are a convenience — the rest of the panel still works without them
    }
  }, [eventId])

  useEffect(() => {
    void loadEntries()
  }, [loadEntries, entriesRefreshKey])

  async function handleImport() {
    setImporting(true)
    setError(null)
    setImportResult(null)
    try {
      const created = await apiFetch<unknown[]>(`/events/${eventId}/divisions/import-from-templates`, {
        method: 'POST',
        body: JSON.stringify({}),
      })
      setImportResult(created.length)
      if (created.length > 0) onChanged()
    } catch (err) {
      setError(err instanceof ApiError ? translateApiError(err.message) : 'Não foi possível importar.')
    } finally {
      setImporting(false)
    }
  }

  async function handleDelete(divisionId: string) {
    const division = divisions.find((d) => d.id === divisionId)
    if (!window.confirm(`Apagar a divisão "${division?.name ?? divisionId}"?`)) return
    setError(null)
    try {
      await apiFetch(`/events/${eventId}/divisions/${divisionId}`, { method: 'DELETE' })
      onChanged()
    } catch (err) {
      setError(err instanceof ApiError ? translateApiError(err.message) : 'Não foi possível apagar.')
    }
  }

  function countsFor(divisionId: string) {
    const active = entries.filter(
      (e) => (e.confirmedDivisionId ?? e.divisionId) === divisionId && e.status !== 'withdrawn' && e.status !== 'disqualified',
    )
    return { active: active.length, confirmed: active.filter((e) => e.status === 'confirmed').length }
  }

  function toggle(set: Set<string>, setSet: (s: Set<string>) => void, key: string) {
    const next = new Set(set)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    setSet(next)
  }

  const filterLower = filterText.trim().toLowerCase()
  const matches = (d: DivisionLite) => filterLower === '' || d.name.toLowerCase().includes(filterLower)

  const groups = groupDivisions(divisions).map((ageNode) => {
    const subgroups = ageNode.subgroups
      .map((sub) => ({ ...sub, divisions: sub.divisions.filter((d) => matches(d) && (!hideEmpty || countsFor(d.id).active > 0)) }))
      .filter((sub) => sub.divisions.length > 0)
    const loose = ageNode.loose.filter((d) => matches(d) && (!hideEmpty || countsFor(d.id).active > 0))
    return { ...ageNode, subgroups, loose }
  }).filter((ageNode) => ageNode.subgroups.length > 0 || ageNode.loose.length > 0)

  const totalDivisions = divisions.length
  const emptyCount = divisions.filter((d) => countsFor(d.id).active === 0).length
  const singletonCount = divisions.filter((d) => countsFor(d.id).active === 1).length

  return (
    <section>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold text-white">Divisões</h2>
        <div className="flex flex-wrap gap-2">
          <Link
            href={`/events/${eventId}/print/weighin`}
            className="rounded-lg border border-slate-700 px-3 py-2 text-sm text-slate-300 hover:bg-slate-800"
          >
            Ficha de pesagem
          </Link>
          {canManage && (
            <button
              type="button"
              onClick={handleImport}
              disabled={importing}
              className="rounded-lg border border-slate-700 px-3 py-2 text-sm text-slate-300 hover:bg-slate-800 disabled:opacity-60"
            >
              {importing ? 'Importando…' : 'Importar do padrão da academia'}
            </button>
          )}
          {canManage && (
            <button
              type="button"
              onClick={() => setAddingDivision(true)}
              className="rounded-lg bg-blue-600 px-3 py-2 text-sm font-semibold text-white transition hover:bg-blue-500"
            >
              + Criar divisão
            </button>
          )}
        </div>
      </div>

      {importResult === 0 && (
        <p className="mb-3 rounded-lg border border-amber-800 bg-amber-950/40 px-3 py-2 text-sm text-amber-300">
          Nenhuma divisão foi criada: esta academia ainda não tem um padrão de divisões cadastrado. Cadastre um em{' '}
          <Link href="/settings/divisions" className="underline">
            Configurações → Divisões
          </Link>{' '}
          (o botão &quot;Carregar padrão FPJ&quot; monta um pronto para editar).
        </p>
      )}
      {importResult !== null && importResult > 0 && (
        <p className="mb-3 rounded-lg border border-emerald-800 bg-emerald-950/40 px-3 py-2 text-sm text-emerald-300">
          {importResult} divisão(ões) importada(s).
        </p>
      )}

      {error && <p className="mb-3 text-sm text-red-400">{error}</p>}

      {divisions.length === 0 && !addingDivision && (
        <p className="text-sm text-slate-500">Nenhuma divisão ainda. Importe do padrão da academia ou crie manualmente.</p>
      )}

      {divisions.length > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-3 rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-sm">
          <span className="text-slate-400">
            {totalDivisions} divisões · {emptyCount} vazias
            {singletonCount > 0 && <span className="text-amber-400"> · {singletonCount} com 1 só atleta</span>}
          </span>
          <label className="flex items-center gap-1.5 text-slate-300">
            <input type="checkbox" checked={hideEmpty} onChange={(e) => setHideEmpty(e.target.checked)} />
            Ocultar divisões vazias
          </label>
          <input
            value={filterText}
            onChange={(e) => setFilterText(e.target.value)}
            placeholder="Filtrar por nome…"
            className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-sm text-white placeholder-slate-500"
          />
        </div>
      )}

      <div className="space-y-2">
        {groups.map((ageNode) => {
          const ageDivisionIds = [...ageNode.subgroups.flatMap((s) => s.divisions.map((d) => d.id)), ...ageNode.loose.map((d) => d.id)]
          const ageEmpty = ageDivisionIds.filter((id) => countsFor(id).active === 0).length
          const ageSingleton = ageDivisionIds.filter((id) => countsFor(id).active === 1).length
          const ageOpen = expandedAge.has(ageNode.key)
          return (
            <div key={ageNode.key} className="rounded-lg border border-slate-800 bg-slate-900">
              <button
                type="button"
                onClick={() => toggle(expandedAge, setExpandedAge, ageNode.key)}
                className="flex w-full flex-wrap items-center justify-between gap-2 px-4 py-3 text-left"
              >
                <span className="font-medium text-white">
                  {ageOpen ? '▾' : '▸'} {ageNode.label}
                </span>
                <span className="text-xs text-slate-500">
                  {ageDivisionIds.length} divisão(ões){ageEmpty > 0 ? ` · ${ageEmpty} vazia(s)` : ''}
                  {ageSingleton > 0 ? ` · ${ageSingleton} com 1 atleta` : ''}
                </span>
              </button>

              {ageOpen && (
                <div className="space-y-2 border-t border-slate-800 p-3">
                  {ageNode.subgroups.map((sub) => {
                    const subOpen = expandedSub.has(sub.key)
                    const subEmpty = sub.divisions.filter((d) => countsFor(d.id).active === 0).length
                    const subSingleton = sub.divisions.filter((d) => countsFor(d.id).active === 1).length
                    return (
                      <div key={sub.key} className="rounded-lg border border-slate-800 bg-slate-950">
                        <button
                          type="button"
                          onClick={() => toggle(expandedSub, setExpandedSub, sub.key)}
                          className="flex w-full flex-wrap items-center justify-between gap-2 px-3 py-2 text-left"
                        >
                          <span className="text-sm font-medium text-slate-200">
                            {subOpen ? '▾' : '▸'} {sub.label}
                          </span>
                          <span className="text-xs text-slate-500">
                            {sub.divisions.length} divisão(ões){subEmpty > 0 ? ` · ${subEmpty} vazia(s)` : ''}
                            {subSingleton > 0 ? ` · ${subSingleton} com 1 atleta` : ''}
                          </span>
                        </button>
                        {subOpen && (
                          <div className="space-y-1.5 border-t border-slate-800 p-2">
                            {sub.divisions.map((d) => (
                              <DivisionLeaf
                                key={d.id}
                                eventId={eventId}
                                division={d}
                                allDivisions={divisions}
                                entries={entries}
                                canManage={canManage}
                                expanded={expandedDivision.has(d.id)}
                                onToggle={() => toggle(expandedDivision, setExpandedDivision, d.id)}
                                onChanged={onChanged}
                                onDelete={handleDelete}
                                onEntriesChanged={() => {
                                  void loadEntries()
                                  onEntriesChanged()
                                }}
                              />
                            ))}
                          </div>
                        )}
                      </div>
                    )
                  })}

                  {ageNode.loose.map((d) => (
                    <DivisionLeaf
                      key={d.id}
                      eventId={eventId}
                      division={d}
                      allDivisions={divisions}
                      entries={entries}
                      canManage={canManage}
                      expanded={expandedDivision.has(d.id)}
                      onToggle={() => toggle(expandedDivision, setExpandedDivision, d.id)}
                      onChanged={onChanged}
                      onDelete={handleDelete}
                      onEntriesChanged={() => {
                        void loadEntries()
                        onEntriesChanged()
                      }}
                    />
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {canManage && addingDivision && (
        <NewDivisionForm eventId={eventId} onDone={() => setAddingDivision(false)} onCreated={onChanged} />
      )}
    </section>
  )
}

function DivisionLeaf({
  eventId,
  division,
  allDivisions,
  entries,
  canManage,
  expanded,
  onToggle,
  onChanged,
  onDelete,
  onEntriesChanged,
}: {
  eventId: string
  division: DivisionLite
  allDivisions: DivisionLite[]
  entries: EntryLite[]
  canManage: boolean
  expanded: boolean
  onToggle: () => void
  onChanged: () => void
  onDelete: (id: string) => void
  onEntriesChanged: () => void
}) {
  const active = entries.filter(
    (e) => (e.confirmedDivisionId ?? e.divisionId) === division.id && e.status !== 'withdrawn' && e.status !== 'disqualified',
  )
  const isEmpty = active.length === 0
  const isSingleton = active.length === 1

  return (
    <div className={`rounded-lg border px-3 py-2 ${isSingleton ? 'border-amber-800 bg-amber-950/10' : 'border-slate-800 bg-slate-900'}`}>
      <button type="button" onClick={onToggle} className="flex w-full flex-wrap items-center justify-between gap-2 text-left">
        <span className="text-sm text-white">
          {expanded ? '▾' : '▸'} {shortDivisionLabel(division)}
          <span className="ml-2 text-xs text-slate-500">
            {ageRangeLabel(division.minAge, division.maxAge)} · {weightLabel(division.weightLimitKg)}
          </span>
        </span>
        <span className={`text-xs ${isEmpty ? 'text-slate-600' : isSingleton ? 'font-medium text-amber-400' : 'text-slate-400'}`}>
          {isEmpty ? 'vazia' : `${active.length} atleta(s)${isSingleton ? ' — sem adversário' : ''}`}
        </span>
      </button>

      {expanded && (
        <div className="mt-2">
          <DivisionDetail
            eventId={eventId}
            division={division}
            allDivisions={allDivisions}
            entries={entries}
            canManage={canManage}
            onDivisionSaved={onChanged}
            onDivisionDeleted={onDelete}
            onEntriesChanged={onEntriesChanged}
          />
        </div>
      )}
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
