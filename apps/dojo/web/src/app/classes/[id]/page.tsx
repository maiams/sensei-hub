'use client'

import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { PresenceShell } from '../../../components/PresenceShell'
import { EmptyState, ErrorState, LoadingState, Modal, StatusPill } from '../../../components/PresenceUI'
import { apiFetch } from '../../../lib/api'
import type { ClassGroupSummary } from '../../../lib/presence'
import { presenceErrorMessage } from '../../../lib/presence'
import { useNetworkStatus, usePresenceSession } from '../../../lib/usePresenceSession'

interface Enrollment { id: string; classId: string; athleteId: string; athleteName: string; active: boolean; startedAt: string; endedAt?: string }
interface AthleteSearch { id: string; fullName: string; preferredName?: string; enrollmentNumber: string }
interface AthleteSearchResult { items: AthleteSearch[] }

export default function ClassDetailPage() {
  const params = useParams<{ id: string }>()
  const { role, ready } = usePresenceSession()
  const online = useNetworkStatus()
  const [group, setGroup] = useState<ClassGroupSummary | null>(null)
  const [enrollments, setEnrollments] = useState<Enrollment[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [removing, setRemoving] = useState<Enrollment | null>(null)

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const [groups, roster] = await Promise.all([
        apiFetch<ClassGroupSummary[]>('/classes'),
        apiFetch<Enrollment[]>(`/classes/${params.id}/enrollments`),
      ])
      setGroup(groups.find((item) => item.id === params.id) ?? null)
      setEnrollments(roster.filter((item) => item.active).sort((a, b) => a.athleteName.localeCompare(b.athleteName, 'pt-BR')))
    } catch (err) { setError(presenceErrorMessage(err, 'Não foi possível carregar esta turma.')) }
    finally { setLoading(false) }
  }, [params.id])

  useEffect(() => { if (ready) void load() }, [ready, load])

  return <PresenceShell role={role} eyebrow="Turmas" title={group?.name ?? 'Turma'} action={!loading && <Link href="/classes" className="inline-flex min-h-11 items-center rounded-xl border border-slate-700 px-3 text-sm font-semibold">Voltar</Link>}>
    {loading && <LoadingState />}
    {!loading && error && <ErrorState message={error} onRetry={() => void load()} />}
    {!loading && !error && group && <>
      <section className="mb-5 rounded-2xl border border-slate-800 bg-slate-900 p-5">
        <div className="flex items-start justify-between gap-4"><p className="text-sm leading-6 text-slate-400">{group.description || 'Sem descrição.'}</p><StatusPill tone={group.active ? 'success' : 'neutral'}>{group.active ? 'Ativa' : 'Arquivada'}</StatusPill></div>
        <div className="mt-4 flex items-center justify-between border-t border-slate-800 pt-4"><div><p className="text-2xl font-bold">{enrollments.length}</p><p className="text-xs text-slate-500">alunos ativos</p></div><button type="button" disabled={!online} onClick={() => setAdding(true)} className="min-h-12 rounded-xl bg-sky-600 px-4 font-bold disabled:opacity-50">Adicionar aluno</button></div>
      </section>
      {enrollments.length === 0 ? <EmptyState title="Turma sem alunos" description="Adicione os atletas que devem aparecer nas próximas chamadas." /> : <ul className="space-y-2">
        {enrollments.map((enrollment) => <li key={enrollment.id} className="flex min-h-20 items-center justify-between gap-3 rounded-2xl border border-slate-800 bg-slate-900 px-4 py-3"><div className="min-w-0"><p className="truncate font-semibold">{enrollment.athleteName}</p><p className="mt-1 text-xs text-slate-500">Na turma desde {new Intl.DateTimeFormat('pt-BR').format(new Date(enrollment.startedAt))}</p></div><button type="button" disabled={!online} onClick={() => setRemoving(enrollment)} className="min-h-11 shrink-0 rounded-xl border border-red-900 px-3 text-sm font-semibold text-red-300 disabled:opacity-50">Remover</button></li>)}
      </ul>}
    </>}
    {adding && <AddStudentModal classId={params.id} enrolledIds={new Set(enrollments.map((item) => item.athleteId))} onClose={() => setAdding(false)} onAdded={() => { setAdding(false); void load() }} />}
    {removing && <RemoveStudentModal enrollment={removing} onClose={() => setRemoving(null)} onRemoved={() => { setRemoving(null); void load() }} />}
  </PresenceShell>
}

function AddStudentModal({ classId, enrolledIds, onClose, onAdded }: { classId: string; enrolledIds: Set<string>; onClose: () => void; onAdded: () => void }) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<AthleteSearch[]>([])
  const [searching, setSearching] = useState(false)
  const [savingId, setSavingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  async function search(event: FormEvent) {
    event.preventDefault(); setSearching(true); setError(null)
    try { const data = await apiFetch<AthleteSearchResult>(`/athletes?q=${encodeURIComponent(query)}&pageSize=20`); setResults(data.items.filter((item) => !enrolledIds.has(item.id))) }
    catch (err) { setError(presenceErrorMessage(err, 'Não foi possível buscar alunos.')) }
    finally { setSearching(false) }
  }
  async function add(athleteId: string) {
    if (savingId) return
    setSavingId(athleteId); setError(null)
    try { await apiFetch(`/classes/${classId}/enrollments`, { method: 'POST', body: JSON.stringify({ athleteId }) }); onAdded() }
    catch (err) { setError(presenceErrorMessage(err, 'Não foi possível adicionar o aluno.')); setSavingId(null) }
  }
  return <Modal title="Adicionar aluno" description="Busque apenas pelo nome ou matrícula." onClose={onClose}>
    <form onSubmit={search} className="flex gap-2"><label className="sr-only" htmlFor="athlete-search">Nome ou matrícula</label><input id="athlete-search" value={query} onChange={(e) => setQuery(e.target.value)} required autoFocus placeholder="Nome ou matrícula" className="min-h-12 min-w-0 flex-1 rounded-xl border border-slate-700 bg-slate-950 px-4"/><button disabled={searching} className="min-h-12 rounded-xl bg-slate-700 px-4 font-bold disabled:opacity-50">{searching ? '…' : 'Buscar'}</button></form>
    {error && <p role="alert" className="mt-3 text-sm text-red-300">{error}</p>}
    <ul className="mt-4 max-h-80 space-y-2 overflow-y-auto">{results.map((athlete) => <li key={athlete.id} className="flex items-center justify-between gap-3 rounded-xl border border-slate-800 p-3"><div className="min-w-0"><p className="truncate font-semibold">{athlete.preferredName || athlete.fullName}</p><p className="text-xs text-slate-500">Matrícula {athlete.enrollmentNumber}</p></div><button type="button" disabled={savingId !== null} onClick={() => void add(athlete.id)} className="min-h-11 rounded-xl bg-sky-600 px-3 text-sm font-bold disabled:opacity-50">{savingId === athlete.id ? 'Adicionando…' : 'Adicionar'}</button></li>)}</ul>
    {!searching && query && results.length === 0 && <p className="mt-5 text-center text-sm text-slate-500">Nenhum aluno disponível nesta busca.</p>}
  </Modal>
}

function RemoveStudentModal({ enrollment, onClose, onRemoved }: { enrollment: Enrollment; onClose: () => void; onRemoved: () => void }) {
  const [saving, setSaving] = useState(false); const [error, setError] = useState<string | null>(null)
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (saving) return
    const reason = new FormData(event.currentTarget).get('reason'); setSaving(true); setError(null)
    try { await apiFetch(`/enrollments/${enrollment.id}`, { method: 'DELETE', body: JSON.stringify({ reason }) }); onRemoved() }
    catch (err) { setError(presenceErrorMessage(err, 'Não foi possível remover o aluno.')); setSaving(false) }
  }
  return <Modal title={`Remover ${enrollment.athleteName}?`} description="A matrícula anterior será preservada no histórico." onClose={onClose}><form onSubmit={submit} className="space-y-4"><label className="block text-sm font-semibold">Motivo<textarea name="reason" required minLength={3} maxLength={500} autoFocus rows={3} className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-950 p-4 text-base" /></label>{error && <p role="alert" className="text-sm text-red-300">{error}</p>}<div className="grid grid-cols-2 gap-3"><button type="button" onClick={onClose} className="min-h-12 rounded-xl border border-slate-700 font-semibold">Cancelar</button><button disabled={saving} className="min-h-12 rounded-xl bg-red-700 font-bold disabled:opacity-50">{saving ? 'Removendo…' : 'Remover'}</button></div></form></Modal>
}
