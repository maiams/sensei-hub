'use client'

import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { PresenceShell } from '../../../../components/PresenceShell'
import { EmptyState, ErrorState, LoadingState, Modal, StatusPill } from '../../../../components/PresenceUI'
import { apiFetch } from '../../../../lib/api'
import { calculateAge, formatLessonDate, formatTime, makeIdempotencyKey, presenceErrorMessage, resultLabel, type RollCallItem, type RollCallResponse } from '../../../../lib/presence'
import { useNetworkStatus, usePresenceSession } from '../../../../lib/usePresenceSession'

type Filter = 'all' | 'pending' | 'without_request' | 'present' | 'absent'
type ReasonAction = { kind: 'reject' | 'correct_present' | 'correct_absent'; item: RollCallItem }

export default function RollCallPage() {
  const params = useParams<{ id: string }>()
  const { role, ready } = usePresenceSession()
  const online = useNetworkStatus()
  const [data, setData] = useState<RollCallResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [filter, setFilter] = useState<Filter>('all')
  const [reasonAction, setReasonAction] = useState<ReasonAction | null>(null)

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const response = await apiFetch<RollCallResponse>(`/lessons/${params.id}/roll-call`)
      response.items.sort((a, b) => a.athleteName.localeCompare(b.athleteName, 'pt-BR'))
      setData(response)
    } catch (err) { setError(presenceErrorMessage(err, 'Confira sua conexão e tente novamente.')) }
    finally { setLoading(false) }
  }, [params.id])
  useEffect(() => { if (ready) void load() }, [ready, load])

  const counts = useMemo(() => ({
    all: data?.items.length ?? 0,
    pending: data?.items.filter((item) => item.request?.status === 'pending').length ?? 0,
    without_request: data?.items.filter((item) => item.result === 'unmarked' && !item.request).length ?? 0,
    present: data?.items.filter((item) => item.result === 'present').length ?? 0,
    absent: data?.items.filter((item) => item.result === 'absent').length ?? 0,
  }), [data])
  const visible = (data?.items ?? []).filter((item) => {
    if (filter === 'all') return true
    if (filter === 'pending') return item.request?.status === 'pending'
    if (filter === 'without_request') return item.result === 'unmarked' && !item.request
    return item.result === filter
  })

  async function mutate(item: RollCallItem, path: string, body?: unknown) {
    if (busyId || !online) return
    setBusyId(item.attendanceId); setActionError(null)
    try {
      await apiFetch(path, {
        method: 'POST',
        headers: { 'Idempotency-Key': makeIdempotencyKey() },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      })
      await load()
    } catch (err) { setActionError(presenceErrorMessage(err, 'A ação não foi enviada. Nada foi alterado.')) }
    finally { setBusyId(null) }
  }

  return <PresenceShell role={role} eyebrow={data?.lesson.className ?? 'Chamada'} title="Chamada" action={<Link href="/lessons" className="inline-flex min-h-11 items-center rounded-xl border border-slate-700 px-3 text-sm font-semibold">Voltar</Link>}>
    {data && <section className="mb-4 rounded-2xl border border-slate-800 bg-slate-900 p-4"><p className="font-semibold capitalize">{formatLessonDate(data.lesson.startsAt)} · {formatTime(data.lesson.startsAt)}–{formatTime(data.lesson.endsAt)}</p><div className="mt-3 grid grid-cols-3 divide-x divide-slate-800 text-center"><Summary number={counts.present} label="presentes" tone="text-emerald-300" /><Summary number={counts.pending} label="pendentes" tone="text-amber-300" /><Summary number={counts.without_request} label="sem pedido" tone="text-slate-300" /></div></section>}
    {actionError && <div role="alert" className="mb-4 flex items-start justify-between gap-3 rounded-xl border border-red-800 bg-red-950/60 p-4 text-sm text-red-200"><span>{actionError}</span><button type="button" onClick={() => setActionError(null)} aria-label="Fechar erro" className="min-h-8 min-w-8">×</button></div>}
    <div className="-mx-4 mb-5 overflow-x-auto px-4 [scrollbar-width:none] sm:mx-0 sm:px-0"><div className="flex min-w-max gap-2" role="group" aria-label="Filtrar chamada">{([
      ['all', 'Todos'], ['pending', 'Pendentes'], ['without_request', 'Sem pedido'], ['present', 'Presentes'], ['absent', 'Faltas'],
    ] as Array<[Filter, string]>).map(([value, label]) => <button key={value} type="button" onClick={() => setFilter(value)} aria-pressed={filter === value} className={`min-h-11 rounded-full border px-4 text-sm font-semibold ${filter === value ? 'border-sky-500 bg-sky-950 text-sky-200' : 'border-slate-700 bg-slate-900 text-slate-300'}`}>{label} <span className="ml-1 text-xs opacity-70">{counts[value]}</span></button>)}</div></div>
    {loading && <LoadingState label="Carregando chamada" />}
    {!loading && error && <ErrorState message={error} onRetry={() => void load()} />}
    {!loading && !error && data?.items.length === 0 && <EmptyState title="Chamada vazia" description="Adicione alunos à turma antes de criar a aula." />}
    {!loading && !error && data && data.items.length > 0 && visible.length === 0 && <EmptyState title="Nada neste filtro" description="Escolha outro filtro para ver os demais alunos." />}
    {!loading && !error && data && visible.length > 0 && <ul className="space-y-3">{visible.map((item) => {
      const working = busyId === item.attendanceId
      const age = calculateAge(item.birthDate, new Date(data.lesson.startsAt))
      return <li key={item.attendanceId} className="rounded-2xl border border-slate-800 bg-slate-900 p-4">
        <div className="flex items-start justify-between gap-3"><div className="min-w-0"><h2 className="truncate text-base font-bold">{item.athleteName}</h2><p className="mt-1 text-sm text-slate-400">{age !== null ? `${age} anos` : 'Idade não informada'}</p></div><AttendanceBadge item={item} /></div>
        {item.request && <p className="mt-3 border-t border-slate-800 pt-3 text-sm text-slate-400"><LocationLabel status={item.request.locationStatus} />{item.request.requestedAt && <> · Pedido às {formatTime(item.request.requestedAt)}</>}</p>}
        {(item.request?.rejectionReason || item.request?.expirationReason) && <p className="mt-2 text-sm text-red-300">Motivo: {item.request.rejectionReason || item.request.expirationReason}</p>}
        <div className="mt-4 grid gap-2 min-[380px]:grid-flow-col min-[380px]:auto-cols-fr">
          {item.request?.status === 'pending' && <><button type="button" disabled={!online || busyId !== null} onClick={() => void mutate(item, `/attendance-requests/${item.request?.id}/confirm`)} className="min-h-12 rounded-xl bg-emerald-700 px-3 font-bold text-white disabled:opacity-50">{working ? 'Enviando…' : 'Confirmar'}</button><button type="button" disabled={!online || busyId !== null} onClick={() => setReasonAction({ kind: 'reject', item })} className="min-h-12 rounded-xl border border-red-800 px-3 font-bold text-red-300 disabled:opacity-50">Recusar</button></>}
          {item.result === 'unmarked' && item.request?.status !== 'pending' && <button type="button" disabled={!online || busyId !== null} onClick={() => void mutate(item, `/lessons/${params.id}/attendance`, { athleteId: item.athleteId })} className="min-h-12 rounded-xl bg-sky-600 px-3 font-bold text-white disabled:opacity-50">{working ? 'Enviando…' : 'Dar presença'}</button>}
          {item.result === 'present' && <button type="button" disabled={!online || busyId !== null} onClick={() => setReasonAction({ kind: 'correct_absent', item })} className="min-h-12 rounded-xl border border-slate-700 px-3 font-semibold text-slate-200 disabled:opacity-50">Corrigir para falta</button>}
          {item.result === 'absent' && <button type="button" disabled={!online || busyId !== null} onClick={() => setReasonAction({ kind: 'correct_present', item })} className="min-h-12 rounded-xl border border-slate-700 px-3 font-semibold text-slate-200 disabled:opacity-50">Corrigir para presente</button>}
        </div>
      </li>
    })}</ul>}
    {reasonAction && <ReasonModal action={reasonAction} saving={busyId !== null} onClose={() => setReasonAction(null)} onSubmit={async (reason) => {
      const action = reasonAction; setReasonAction(null)
      if (action.kind === 'reject') await mutate(action.item, `/attendance-requests/${action.item.request?.id}/reject`, { reason })
      else await mutate(action.item, `/attendance/${action.item.attendanceId}/correct`, { result: action.kind === 'correct_present' ? 'present' : 'absent', reason })
    }} />}
  </PresenceShell>
}

function Summary({ number, label, tone }: { number: number; label: string; tone: string }) { return <div><p className={`text-xl font-black ${tone}`}>{number}</p><p className="text-[11px] text-slate-500">{label}</p></div> }

function AttendanceBadge({ item }: { item: RollCallItem }) {
  if (item.request?.status === 'pending') return <StatusPill tone="warning">Pedido pendente</StatusPill>
  if (item.result === 'present') return <StatusPill tone="success">Presente</StatusPill>
  if (item.result === 'absent') return <StatusPill tone="danger">Faltou</StatusPill>
  return <StatusPill tone="neutral">Sem marcação</StatusPill>
}

function LocationLabel({ status }: { status: RollCallItem['request'] extends infer R ? 'inside' | 'outside' | 'unavailable' : never }) {
  if (status === 'inside') return <span className="text-emerald-300">● Dentro do raio</span>
  if (status === 'outside') return <span className="text-red-300">● Fora do raio</span>
  return <span>○ Localização não informada</span>
}

function ReasonModal({ action, saving, onClose, onSubmit }: { action: ReasonAction; saving: boolean; onClose: () => void; onSubmit: (reason: string) => void | Promise<void> }) {
  const labels = action.kind === 'reject' ? { title: `Recusar pedido de ${action.item.athleteName}?`, button: 'Recusar pedido', danger: true } : { title: `Corrigir presença de ${action.item.athleteName}?`, button: 'Salvar correção', danger: false }
  function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); const reason = String(new FormData(event.currentTarget).get('reason') ?? '').trim(); if (reason.length >= 3) void onSubmit(reason) }
  return <Modal title={labels.title} description="A alteração e o motivo ficarão no histórico da chamada." onClose={onClose}><form onSubmit={submit} className="space-y-4"><label className="block text-sm font-semibold">Motivo<textarea name="reason" required minLength={3} maxLength={500} autoFocus rows={4} className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-950 p-4 text-base" placeholder="Explique o que aconteceu" /></label><div className="grid grid-cols-2 gap-3"><button type="button" onClick={onClose} className="min-h-12 rounded-xl border border-slate-700 font-semibold">Cancelar</button><button disabled={saving} className={`min-h-12 rounded-xl font-bold disabled:opacity-50 ${labels.danger ? 'bg-red-700' : 'bg-sky-600'}`}>{labels.button}</button></div></form></Modal>
}
