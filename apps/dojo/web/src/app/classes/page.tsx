'use client'

import { useCallback, useEffect, useState, type FormEvent } from 'react'
import Link from 'next/link'
import { PresenceShell } from '../../components/PresenceShell'
import { EmptyState, ErrorState, LoadingState, Modal, StatusPill } from '../../components/PresenceUI'
import { apiFetch } from '../../lib/api'
import type { ClassGroupSummary } from '../../lib/presence'
import { presenceErrorMessage } from '../../lib/presence'
import { useNetworkStatus, usePresenceSession } from '../../lib/usePresenceSession'

export default function ClassesPage() {
  const { role, ready } = usePresenceSession()
  const online = useNetworkStatus()
  const [items, setItems] = useState<ClassGroupSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const canManage = role === 'coach' || role === 'academy_admin' || role === 'super_admin'

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await apiFetch<ClassGroupSummary[]>('/classes')
      setItems([...data].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR')))
    } catch (err) {
      setError(presenceErrorMessage(err, 'Confira sua conexão e tente novamente.'))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { if (ready) void load() }, [ready, load])

  return (
    <PresenceShell role={role} eyebrow="Organização" title="Turmas" action={canManage && <button type="button" disabled={!online} onClick={() => setCreating(true)} className="min-h-11 rounded-xl bg-sky-600 px-4 text-sm font-bold text-white disabled:opacity-50">Nova turma</button>}>
      {loading && <LoadingState label="Carregando turmas" />}
      {!loading && error && <ErrorState message={error} onRetry={() => void load()} />}
      {!loading && !error && items.length === 0 && <EmptyState title="Nenhuma turma criada" description="Crie a primeira turma para organizar alunos e aulas." action={canManage && online && <button type="button" onClick={() => setCreating(true)} className="min-h-12 rounded-xl bg-sky-600 px-5 font-bold">Criar turma</button>} />}
      {!loading && !error && items.length > 0 && (
        <ul className="grid gap-3 sm:grid-cols-2">
          {items.map((item) => (
            <li key={item.id}>
              <Link href={`/classes/${item.id}`} className="block min-h-32 rounded-2xl border border-slate-800 bg-slate-900 p-5 transition hover:border-slate-600">
                <div className="flex items-start justify-between gap-3">
                  <h2 className="text-lg font-bold">{item.name}</h2>
                  <StatusPill tone={item.active ? 'success' : 'neutral'}>{item.active ? 'Ativa' : 'Arquivada'}</StatusPill>
                </div>
                <p className="mt-2 line-clamp-2 text-sm leading-6 text-slate-400">{item.description || 'Sem descrição.'}</p>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {creating && <CreateClassModal onClose={() => setCreating(false)} onCreated={() => { setCreating(false); void load() }} />}
    </PresenceShell>
  )
}

function CreateClassModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (saving) return
    const form = new FormData(event.currentTarget)
    setSaving(true)
    setError(null)
    try {
      await apiFetch('/classes', { method: 'POST', body: JSON.stringify({ name: form.get('name'), description: form.get('description') || undefined }) })
      onCreated()
    } catch (err) {
      setError(presenceErrorMessage(err, 'Não foi possível criar a turma.'))
    } finally { setSaving(false) }
  }
  return <Modal title="Nova turma" description="Você poderá adicionar alunos depois de criar." onClose={onClose}>
    <form onSubmit={submit} className="space-y-4">
      <label className="block text-sm font-semibold text-slate-200">Nome<input name="name" required minLength={2} maxLength={120} autoFocus className="mt-2 min-h-12 w-full rounded-xl border border-slate-700 bg-slate-950 px-4 text-base" /></label>
      <label className="block text-sm font-semibold text-slate-200">Descrição <span className="font-normal text-slate-500">(opcional)</span><textarea name="description" maxLength={500} rows={3} className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-950 p-4 text-base" /></label>
      {error && <p role="alert" className="text-sm text-red-300">{error}</p>}
      <div className="grid grid-cols-2 gap-3"><button type="button" onClick={onClose} className="min-h-12 rounded-xl border border-slate-700 font-semibold">Cancelar</button><button disabled={saving} className="min-h-12 rounded-xl bg-sky-600 font-bold disabled:opacity-50">{saving ? 'Criando…' : 'Criar turma'}</button></div>
    </form>
  </Modal>
}
