'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { apiFetch, isLoggedIn } from '../../lib/api'
import { BELT_LABELS, formatDate } from '../../lib/labels'

interface AthleteListItem {
  id: string
  enrollmentNumber: string
  fullName: string
  preferredName?: string
  birthDate: string
  currentBelt: string
  status: string
}

interface AthleteListResult {
  items: AthleteListItem[]
  total: number
  page: number
  pageSize: number
}

export default function AthletesPage() {
  const router = useRouter()
  const [query, setQuery] = useState('')
  const [result, setResult] = useState<AthleteListResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async (q: string) => {
    setLoading(true)
    setError(null)
    try {
      const search = q ? `?q=${encodeURIComponent(q)}` : ''
      const data = await apiFetch<AthleteListResult>(`/athletes${search}`)
      setResult(data)
    } catch {
      setError('Não foi possível carregar os atletas.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!isLoggedIn()) {
      router.replace('/login')
      return
    }
    void load('')
  }, [router, load])

  function handleSearchSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    void load(query)
  }

  return (
    <main className="min-h-screen bg-slate-950 px-4 py-8 text-white">
      <div className="mx-auto max-w-3xl">
        <div className="mb-6 flex items-center justify-between gap-4">
          <h1 className="text-2xl font-bold tracking-tight">Atletas</h1>
          <div className="flex items-center gap-3">
            <Link href="/events" className="text-sm text-slate-400 transition hover:text-slate-200">
              Eventos
            </Link>
            <Link
              href="/settings/divisions"
              className="text-sm text-slate-400 transition hover:text-slate-200"
            >
              Divisões
            </Link>
            <Link
              href="/athletes/new"
              className="rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-blue-500"
            >
              + Cadastrar atleta
            </Link>
          </div>
        </div>

        <form onSubmit={handleSearchSubmit} className="mb-6 flex gap-2">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar por nome, CPF ou matrícula…"
            className="flex-1 rounded-lg border border-slate-700 bg-slate-800 px-4 py-3 text-base text-white placeholder-slate-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
          <button
            type="submit"
            className="rounded-lg border border-slate-700 bg-slate-800 px-5 py-3 font-medium text-white transition hover:bg-slate-700"
          >
            Buscar
          </button>
        </form>

        {loading && <p className="text-slate-400">Carregando…</p>}
        {error && (
          <div className="rounded-lg border border-red-800 bg-red-950 px-4 py-3 text-sm text-red-300">{error}</div>
        )}

        {!loading && !error && result && result.items.length === 0 && (
          <p className="text-slate-400">Nenhum atleta encontrado.</p>
        )}

        {!loading && !error && result && result.items.length > 0 && (
          <ul className="space-y-2">
            {result.items.map((athlete) => (
              <li key={athlete.id}>
                <Link
                  href={`/athletes/${athlete.id}`}
                  className="flex items-center justify-between rounded-lg border border-slate-800 bg-slate-900 px-4 py-4 transition hover:border-slate-700 hover:bg-slate-800"
                >
                  <div>
                    <p className="text-lg font-semibold text-white">
                      {athlete.preferredName || athlete.fullName}
                    </p>
                    <p className="text-sm text-slate-400">
                      Matrícula {athlete.enrollmentNumber} · Nascimento {formatDate(athlete.birthDate)}
                    </p>
                  </div>
                  <span className="rounded-full border border-slate-700 px-3 py-1 text-xs font-medium text-slate-300">
                    {BELT_LABELS[athlete.currentBelt] ?? athlete.currentBelt}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}

        {result && result.total > result.items.length && (
          <p className="mt-4 text-sm text-slate-500">
            Mostrando {result.items.length} de {result.total} atletas.
          </p>
        )}
      </div>
    </main>
  )
}
