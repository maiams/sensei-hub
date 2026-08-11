'use client'

import { useCallback, useEffect, useState, type FormEvent } from 'react'
import Link from 'next/link'
import { PresenceShell } from '../../components/PresenceShell'
import { EmptyState, ErrorState, LoadingState, Modal, StatusPill } from '../../components/PresenceUI'
import { apiFetch } from '../../lib/api'
import type { ClassGroupSummary, LessonSummary } from '../../lib/presence'
import { formatLessonDate, formatTime, presenceErrorMessage } from '../../lib/presence'
import { useNetworkStatus, usePresenceSession } from '../../lib/usePresenceSession'

export default function LessonsPage() {
  const { role, ready } = usePresenceSession()
  const online = useNetworkStatus()
  const [lessons, setLessons] = useState<LessonSummary[]>([])
  const [classes, setClasses] = useState<ClassGroupSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [scope, setScope] = useState<'upcoming' | 'past'>('upcoming')
  const canManage = role === 'coach' || role === 'academy_admin' || role === 'super_admin'

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    const now = new Date()
    const from = new Date(now); from.setDate(from.getDate() - 30)
    const to = new Date(now); to.setDate(to.getDate() + 60)
    try {
      const [lessonData, classData] = await Promise.all([
        apiFetch<LessonSummary[]>(`/lessons?from=${encodeURIComponent(from.toISOString())}&to=${encodeURIComponent(to.toISOString())}`),
        apiFetch<ClassGroupSummary[]>('/classes'),
      ])
      setLessons([...lessonData].sort((a, b) => a.startsAt.localeCompare(b.startsAt)))
      setClasses(classData.filter((item) => item.active))
    } catch (err) { setError(presenceErrorMessage(err, 'Não foi possível carregar as aulas.')) }
    finally { setLoading(false) }
  }, [])
  useEffect(() => { if (ready) void load() }, [ready, load])

  const now = Date.now()
  const visible = lessons.filter((lesson) => scope === 'upcoming' ? new Date(lesson.endsAt).getTime() >= now : new Date(lesson.endsAt).getTime() < now).sort((a, b) => scope === 'upcoming' ? a.startsAt.localeCompare(b.startsAt) : b.startsAt.localeCompare(a.startsAt))

  return <PresenceShell role={role} eyebrow="Presença" title="Aulas" action={canManage && <button disabled={!online || classes.length === 0} type="button" onClick={() => setCreating(true)} className="min-h-11 rounded-xl bg-sky-600 px-4 text-sm font-bold disabled:opacity-50">Nova aula</button>}>
    <div className="mb-5 grid grid-cols-2 rounded-xl bg-slate-900 p-1" role="group" aria-label="Período das aulas">
      <button type="button" onClick={() => setScope('upcoming')} aria-pressed={scope === 'upcoming'} className={`min-h-11 rounded-lg text-sm font-semibold ${scope === 'upcoming' ? 'bg-slate-700 text-white' : 'text-slate-400'}`}>Próximas</button>
      <button type="button" onClick={() => setScope('past')} aria-pressed={scope === 'past'} className={`min-h-11 rounded-lg text-sm font-semibold ${scope === 'past' ? 'bg-slate-700 text-white' : 'text-slate-400'}`}>Anteriores</button>
    </div>
    {loading && <LoadingState label="Carregando aulas" />}
    {!loading && error && <ErrorState message={error} onRetry={() => void load()} />}
    {!loading && !error && visible.length === 0 && <EmptyState title={scope === 'upcoming' ? 'Nenhuma próxima aula' : 'Nenhuma aula anterior'} description={canManage ? 'Crie uma aula para disponibilizar a chamada aos alunos.' : 'Quando uma aula for agendada, ela aparecerá aqui.'} />}
    {!loading && !error && visible.length > 0 && <ul className="space-y-3">{visible.map((lesson) => <li key={lesson.id}><Link href={`/lessons/${lesson.id}/roll-call`} className="flex min-h-28 items-center gap-4 rounded-2xl border border-slate-800 bg-slate-900 p-4 transition hover:border-slate-600"><div className="w-16 shrink-0 rounded-xl bg-slate-800 px-2 py-3 text-center"><p className="text-xs uppercase text-slate-400">{new Intl.DateTimeFormat('pt-BR', { month: 'short' }).format(new Date(lesson.startsAt)).replace('.', '')}</p><p className="text-2xl font-black">{new Date(lesson.startsAt).getDate()}</p></div><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><h2 className="truncate font-bold">{lesson.className}</h2><LessonStatus lesson={lesson} /></div><p className="mt-1 text-sm text-slate-400"><span className="capitalize">{formatLessonDate(lesson.startsAt)}</span> · {formatTime(lesson.startsAt)}–{formatTime(lesson.endsAt)}</p><p className="mt-2 text-xs font-semibold text-sky-300">Abrir chamada →</p></div></Link></li>)}</ul>}
    {creating && <CreateLessonModal classes={classes} onClose={() => setCreating(false)} onCreated={() => { setCreating(false); void load() }} />}
  </PresenceShell>
}

function LessonStatus({ lesson }: { lesson: LessonSummary }) {
  if (lesson.status === 'cancelled') return <StatusPill tone="danger">Cancelada</StatusPill>
  if (lesson.status === 'closed') return <StatusPill tone="neutral">Encerrada</StatusPill>
  const current = Date.now(); const start = new Date(lesson.startsAt).getTime(); const end = new Date(lesson.endsAt).getTime()
  if (current >= start && current <= end) return <StatusPill tone="success">Acontecendo</StatusPill>
  return <StatusPill tone="info">Agendada</StatusPill>
}

function toLocalInput(date: Date): string {
  const shifted = new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
  return shifted.toISOString().slice(0, 16)
}

function CreateLessonModal({ classes, onClose, onCreated }: { classes: ClassGroupSummary[]; onClose: () => void; onCreated: () => void }) {
  const initialStart = new Date(); initialStart.setMinutes(0, 0, 0); initialStart.setHours(initialStart.getHours() + 1)
  const initialEnd = new Date(initialStart); initialEnd.setMinutes(initialEnd.getMinutes() + 90)
  const [saving, setSaving] = useState(false); const [error, setError] = useState<string | null>(null)
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (saving) return
    const form = new FormData(event.currentTarget); const startsAt = new Date(String(form.get('startsAt'))); const endsAt = new Date(String(form.get('endsAt')))
    if (endsAt <= startsAt) { setError('O término deve ser depois do início.'); return }
    setSaving(true); setError(null)
    try { await apiFetch('/lessons', { method: 'POST', body: JSON.stringify({ classId: form.get('classId'), startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString() }) }); onCreated() }
    catch (err) { setError(presenceErrorMessage(err, 'Não foi possível criar a aula.')); setSaving(false) }
  }
  return <Modal title="Nova aula" description="A chamada será criada com os alunos ativos da turma." onClose={onClose}><form onSubmit={submit} className="space-y-4">
    <label className="block text-sm font-semibold">Turma<select name="classId" required autoFocus className="mt-2 min-h-12 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 text-base">{classes.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
    <label className="block text-sm font-semibold">Início<input name="startsAt" type="datetime-local" required defaultValue={toLocalInput(initialStart)} className="mt-2 min-h-12 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 text-base" /></label>
    <label className="block text-sm font-semibold">Término<input name="endsAt" type="datetime-local" required defaultValue={toLocalInput(initialEnd)} className="mt-2 min-h-12 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 text-base" /></label>
    {error && <p role="alert" className="text-sm text-red-300">{error}</p>}
    <div className="grid grid-cols-2 gap-3"><button type="button" onClick={onClose} className="min-h-12 rounded-xl border border-slate-700 font-semibold">Cancelar</button><button disabled={saving} className="min-h-12 rounded-xl bg-sky-600 font-bold disabled:opacity-50">{saving ? 'Criando…' : 'Criar aula'}</button></div>
  </form></Modal>
}
