'use client'

import { useEffect, useState, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { getCurrentRole, setTokens } from './api'

export interface LoginPageProps {
  productName: string
  subtitle: string
  afterLoginHref: string
  // Optional per-role landing override (e.g. a scoreboard operator should
  // land on the mat they run, not on a screen listing every event they
  // can't open). Takes precedence over `afterLoginHref` when it returns a
  // truthy path; falls back to `afterLoginHref` otherwise. `role` reads the
  // just-issued JWT's claim, same trust level as `getCurrentRole()`
  // elsewhere (display-only — the server re-checks on every request).
  resolveAfterLoginHref?: (role: string | null) => string | null | undefined
}

export function LoginPage({ productName, subtitle, afterLoginHref, resolveAfterLoginHref }: LoginPageProps) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Only enable submit once React has hydrated and `handleSubmit` is really
  // attached. Before that, a click would fall through to the browser's native
  // submit — which, on a form with no action, is a GET to this same URL that
  // puts e-mail and password in the query string and in the browser history.
  // (Observed for real: a stale service worker served mismatched chunks, the
  // page never hydrated, and "Entrar" silently did nothing — looking to the
  // operator like a wrong password.) `method="post"` below is the second layer:
  // if a native submit ever happens anyway, credentials go in the body.
  const [hydrated, setHydrated] = useState(false)
  useEffect(() => setHydrated(true), [])

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setLoading(true)
    setError(null)

    const form = new FormData(e.currentTarget)
    const payload = {
      email: form.get('email') as string,
      password: form.get('password') as string,
    }

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })

      if (!res.ok) {
        setError('E-mail ou senha inválidos')
        return
      }

      const body = (await res.json()) as { accessToken: string; refreshToken: string }
      setTokens(body.accessToken, body.refreshToken)
      const target = resolveAfterLoginHref?.(getCurrentRole()) || afterLoginHref
      router.replace(target)
    } catch {
      setError('Não foi possível conectar ao servidor. Tente novamente.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-slate-950 px-4">
      <div className="w-full max-w-md">
        <h1 className="mb-2 text-3xl font-bold tracking-tight text-white">{productName}</h1>
        <p className="mb-8 text-slate-400">{subtitle}</p>

        <form onSubmit={handleSubmit} method="post" className="space-y-5">
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-300" htmlFor="email">
              E-mail
            </label>
            <input
              id="email"
              name="email"
              type="email"
              required
              autoFocus
              className="w-full rounded-lg border border-slate-700 bg-slate-800 px-4 py-2.5 text-white placeholder-slate-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              placeholder="voce@academia.com"
            />
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-slate-300" htmlFor="password">
              Senha
            </label>
            <input
              id="password"
              name="password"
              type="password"
              required
              className="w-full rounded-lg border border-slate-700 bg-slate-800 px-4 py-2.5 text-white placeholder-slate-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              placeholder="••••••••"
            />
          </div>

          {error && (
            <div className="rounded-lg border border-red-800 bg-red-950 px-4 py-3 text-sm text-red-300">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading || !hydrated}
            className="w-full rounded-lg bg-blue-600 px-4 py-3 font-semibold text-white transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loading ? 'Entrando…' : hydrated ? 'Entrar' : 'Carregando…'}
          </button>
        </form>
      </div>
    </main>
  )
}
