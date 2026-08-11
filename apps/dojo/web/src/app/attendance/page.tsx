'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { PresenceShell } from '../../components/PresenceShell'
import { EmptyState, ErrorState, LoadingState, StatusPill } from '../../components/PresenceUI'
import { apiFetch } from '../../lib/api'
import { formatLessonDate, formatTime, makeIdempotencyKey, presenceErrorMessage, resultLabel, type LessonSummary, type StudentDashboard } from '../../lib/presence'
import { useNetworkStatus, usePresenceSession } from '../../lib/usePresenceSession'

export default function AttendanceHomePage() {
  const { role, ready } = usePresenceSession()
  if (!ready) return <div className="min-h-screen bg-slate-950" />
  if (role === 'athlete') return <StudentToday role={role} />
  if (role === 'coach' || role === 'academy_admin' || role === 'super_admin') return <CoachToday role={role} />
  return <PresenceShell role={role} eyebrow="Sensei Dojô" title="Presença"><ErrorState message="Seu papel ainda não possui acesso ao sistema de presença." /></PresenceShell>
}

function CoachToday({ role }: { role: string }) {
  const [items, setItems] = useState<LessonSummary[]>([]); const [loading, setLoading] = useState(true); const [error, setError] = useState<string | null>(null)
  const load = useCallback(async () => {
    setLoading(true); setError(null)
    const from = new Date(); from.setHours(0, 0, 0, 0); const to = new Date(from); to.setDate(to.getDate() + 1)
    try { const data = await apiFetch<LessonSummary[]>(`/lessons?from=${encodeURIComponent(from.toISOString())}&to=${encodeURIComponent(to.toISOString())}`); setItems(data.sort((a, b) => a.startsAt.localeCompare(b.startsAt))) }
    catch (err) { setError(presenceErrorMessage(err, 'Não foi possível carregar as aulas de hoje.')) }
    finally { setLoading(false) }
  }, [])
  useEffect(() => { void load() }, [load])
  return <PresenceShell role={role} eyebrow="Presença" title="Hoje" action={<Link href="/lessons" className="inline-flex min-h-11 items-center rounded-xl border border-slate-700 px-3 text-sm font-semibold">Ver aulas</Link>}>
    <p className="mb-5 text-sm capitalize text-slate-400">{new Intl.DateTimeFormat('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' }).format(new Date())}</p>
    {loading && <LoadingState />}{!loading && error && <ErrorState message={error} onRetry={() => void load()} />}
    {!loading && !error && items.length === 0 && <EmptyState title="Nenhuma aula hoje" description="A agenda de hoje está livre. Você pode criar uma aula na seção Aulas." action={<Link href="/lessons" className="inline-flex min-h-12 items-center rounded-xl bg-sky-600 px-5 font-bold">Ir para aulas</Link>} />}
    {!loading && !error && items.length > 0 && <ul className="space-y-3">{items.map((lesson) => <li key={lesson.id}><Link href={`/lessons/${lesson.id}/roll-call`} className="block rounded-2xl border border-slate-800 bg-slate-900 p-5 transition hover:border-slate-600"><div className="flex items-start justify-between gap-3"><div><h2 className="text-lg font-bold">{lesson.className}</h2><p className="mt-1 text-sm text-slate-400">{formatTime(lesson.startsAt)}–{formatTime(lesson.endsAt)}</p></div><LessonPhase lesson={lesson} /></div><div className="mt-5 flex min-h-12 items-center justify-center rounded-xl bg-sky-600 font-bold">Abrir chamada</div></Link></li>)}</ul>}
  </PresenceShell>
}

function StudentToday({ role }: { role: string }) {
  const online = useNetworkStatus(); const [data, setData] = useState<StudentDashboard | null>(null); const [loading, setLoading] = useState(true); const [sending, setSending] = useState(false); const [error, setError] = useState<string | null>(null); const [actionError, setActionError] = useState<string | null>(null)
  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try { setData(await apiFetch<StudentDashboard>('/student/dashboard')) }
    catch (err) { setError(presenceErrorMessage(err, 'Não foi possível carregar sua próxima aula.')) }
    finally { setLoading(false) }
  }, [])
  useEffect(() => { void load() }, [load])

  async function requestAttendance() {
    if (!data?.nextLesson || sending || !online) return
    setSending(true); setActionError(null)
    try {
      // A localização fica explicitamente indisponível até a academia cadastrar
      // coordenada/raio confiáveis para o servidor fazer o cálculo. Não pedimos
      // GPS para descartar o dado ou classificar no cliente.
      await apiFetch(`/lessons/${data.nextLesson.id}/attendance-requests`, { method: 'POST', headers: { 'Idempotency-Key': makeIdempotencyKey() }, body: JSON.stringify({ location: { status: 'unavailable' } }) })
      await load()
    } catch (err) { setActionError(presenceErrorMessage(err, 'A solicitação não foi enviada. Tente novamente.')) }
    finally { setSending(false) }
  }

  return <PresenceShell role={role} eyebrow={data?.athlete.fullName ? `Olá, ${data.athlete.fullName.split(' ')[0]}` : 'Minha presença'} title="Hoje" action={<Link href="/attendance/history" className="inline-flex min-h-11 items-center rounded-xl border border-slate-700 px-3 text-sm font-semibold">Histórico</Link>}>
    {loading && <LoadingState />}{!loading && error && <ErrorState message={error} onRetry={() => void load()} />}
    {!loading && !error && data && !data.currentClass && <EmptyState title="Você ainda não está em uma turma" description="Peça ao Sensei para aprovar seu cadastro e vincular sua conta a uma turma." />}
    {!loading && !error && data?.currentClass && !data.nextLesson && <><section className="rounded-2xl border border-slate-800 bg-slate-900 p-5"><p className="text-xs font-semibold uppercase tracking-wider text-sky-400">Sua turma</p><h2 className="mt-2 text-xl font-bold">{data.currentClass.name}</h2></section><div className="mt-4"><EmptyState title="Nenhuma próxima aula" description="Assim que o Sensei agendar uma aula, ela aparecerá aqui." /></div></>}
    {!loading && !error && data?.nextLesson && <>
      <section className="overflow-hidden rounded-3xl border border-slate-800 bg-slate-900"><div className="bg-gradient-to-br from-sky-950 to-slate-900 p-5 sm:p-6"><p className="text-xs font-semibold uppercase tracking-[0.16em] text-sky-300">Próxima aula</p><h2 className="mt-2 text-2xl font-black">{data.nextLesson.className}</h2><p className="mt-2 capitalize text-slate-300">{formatLessonDate(data.nextLesson.startsAt)} · {formatTime(data.nextLesson.startsAt)}–{formatTime(data.nextLesson.endsAt)}</p></div><div className="p-5 sm:p-6"><StudentAttendanceStatus data={data} sending={sending} online={online} onRequest={() => void requestAttendance()} />{actionError && <p role="alert" className="mt-4 rounded-xl border border-red-800 bg-red-950/50 p-3 text-sm text-red-200">{actionError}</p>}</div></section>
      <section className="mt-4 rounded-2xl border border-slate-800 bg-slate-900/60 p-4 text-sm leading-6 text-slate-400"><p><strong className="text-slate-200">Como funciona:</strong> sua solicitação fica pendente até o Sensei conferir você presencialmente.</p><p className="mt-2">Localização: não informada nesta versão. Isso não impede sua solicitação.</p></section>
    </>}
  </PresenceShell>
}

function StudentAttendanceStatus({ data, sending, online, onRequest }: { data: StudentDashboard; sending: boolean; online: boolean; onRequest: () => void }) {
  if (data.request?.status === 'pending') return <div><StatusPill tone="warning">Aguardando o Sensei</StatusPill><p className="mt-3 text-sm text-slate-400">Solicitação enviada às {data.request.requestedAt ? formatTime(data.request.requestedAt) : '—'}.</p></div>
  if (data.attendance?.result === 'present' || data.request?.status === 'confirmed') return <div><StatusPill tone="success">Presença confirmada</StatusPill><p className="mt-3 text-sm text-slate-400">Sua presença foi registrada nesta aula.</p></div>
  if (data.request?.status === 'rejected') return <div><StatusPill tone="danger">Solicitação recusada</StatusPill><p className="mt-3 text-sm text-slate-400">{data.request.rejectionReason || 'Consulte o Sensei para mais informações.'}</p></div>
  if (data.attendance?.result === 'absent' || data.request?.status === 'expired') return <div><StatusPill tone="danger">{resultLabel('absent')}</StatusPill><p className="mt-3 text-sm text-slate-400">A chamada desta aula foi encerrada.</p></div>
  const now = Date.now(); const opens = new Date(data.nextLesson?.requestOpensAt ?? data.nextLesson?.startsAt ?? 0).getTime(); const closes = new Date(data.nextLesson?.requestClosesAt ?? data.nextLesson?.startsAt ?? 0).getTime(); const canRequest = now >= opens && now <= closes
  if (!canRequest) return <div><StatusPill tone="info">{now < opens ? 'Solicitação ainda não abriu' : 'Janela encerrada'}</StatusPill><p className="mt-3 text-sm text-slate-400">{now < opens ? `Disponível a partir de ${formatTime(new Date(opens).toISOString())}.` : 'Peça ajuda diretamente ao Sensei.'}</p></div>
  return <button type="button" onClick={onRequest} disabled={sending || !online} className="min-h-14 w-full rounded-2xl bg-sky-600 px-5 text-lg font-black text-white disabled:opacity-50">{sending ? 'Enviando…' : online ? 'Solicitar presença' : 'Conecte-se para solicitar'}</button>
}

function LessonPhase({ lesson }: { lesson: LessonSummary }) {
  if (lesson.status === 'cancelled') return <StatusPill tone="danger">Cancelada</StatusPill>
  if (lesson.status === 'closed') return <StatusPill tone="neutral">Encerrada</StatusPill>
  const now = Date.now()
  if (now >= new Date(lesson.startsAt).getTime() && now <= new Date(lesson.endsAt).getTime()) return <StatusPill tone="success">Agora</StatusPill>
  return <StatusPill tone="info">Hoje</StatusPill>
}
