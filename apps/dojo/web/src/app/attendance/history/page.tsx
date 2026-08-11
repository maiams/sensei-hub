'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { PresenceShell } from '../../../components/PresenceShell'
import { EmptyState, ErrorState, LoadingState, StatusPill } from '../../../components/PresenceUI'
import { apiFetch } from '../../../lib/api'
import { formatLessonDate, formatTime, presenceErrorMessage, type AttendanceHistoryItem } from '../../../lib/presence'
import { usePresenceSession } from '../../../lib/usePresenceSession'

export default function AttendanceHistoryPage() {
  const { role, ready } = usePresenceSession(); const [items, setItems] = useState<AttendanceHistoryItem[]>([]); const [loading, setLoading] = useState(true); const [error, setError] = useState<string | null>(null); const [filter, setFilter] = useState<'all' | 'present' | 'absent'>('all')
  const load = useCallback(async () => { setLoading(true); setError(null); try { setItems(await apiFetch<AttendanceHistoryItem[]>('/student/attendance')) } catch (err) { setError(presenceErrorMessage(err, 'Não foi possível carregar seu histórico.')) } finally { setLoading(false) } }, [])
  useEffect(() => { if (ready) void load() }, [ready, load])
  const visible = items.filter((item) => filter === 'all' || item.result === filter)
  return <PresenceShell role={role} eyebrow="Minha presença" title="Histórico" action={<Link href="/attendance" className="inline-flex min-h-11 items-center rounded-xl border border-slate-700 px-3 text-sm font-semibold">Hoje</Link>}>
    <div className="mb-5 grid grid-cols-3 rounded-xl bg-slate-900 p-1" role="group" aria-label="Filtrar histórico">{([['all', 'Todos'], ['present', 'Presentes'], ['absent', 'Faltas']] as const).map(([value, label]) => <button key={value} type="button" aria-pressed={filter === value} onClick={() => setFilter(value)} className={`min-h-11 rounded-lg text-sm font-semibold ${filter === value ? 'bg-slate-700 text-white' : 'text-slate-400'}`}>{label}</button>)}</div>
    {loading && <LoadingState />}{!loading && error && <ErrorState message={error} onRetry={() => void load()} />}
    {!loading && !error && visible.length === 0 && <EmptyState title={items.length ? 'Nenhum resultado neste filtro' : 'Histórico vazio'} description={items.length ? 'Escolha outro filtro.' : 'Suas presenças aparecerão depois que as chamadas forem realizadas.'} />}
    {!loading && !error && visible.length > 0 && <ul className="space-y-3">{visible.map((item) => { const startsAt = item.lessonStartsAt; const status = item.result === 'present' ? { tone: 'success' as const, label: 'Presente' } : item.result === 'absent' ? { tone: 'danger' as const, label: 'Faltou' } : { tone: 'neutral' as const, label: 'Aguardando chamada' }; return <li key={item.id} className="rounded-2xl border border-slate-800 bg-slate-900 p-4"><div className="flex items-start justify-between gap-3"><div><h2 className="font-bold">{item.className || 'Aula'}</h2>{startsAt && <p className="mt-1 text-sm capitalize text-slate-400">{formatLessonDate(startsAt)} · {formatTime(startsAt)}</p>}</div><StatusPill tone={status.tone}>{status.label}</StatusPill></div>{item.reason && <p className="mt-3 border-t border-slate-800 pt-3 text-sm text-slate-400">{item.reason}</p>}</li> })}</ul>}
  </PresenceShell>
}
