'use client'

import { useState, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { setTokens } from './api'

interface ApiErrorBody {
  error: string
  details?: {
    fieldErrors: Record<string, string[]>
  }
}

export interface SetupPageProps {
  productName: string
  subtitle: string
  // "Academia" no dojô, "Organização" na arena — mesmo campo no backend
  organizationLabel: string
  organizationPlaceholder: string
  // Where to land once setup finishes and the just-created admin is
  // auto-logged-in (same idea as LoginPage.afterLoginHref) — e.g. "/events"
  // on the Arena, "/athletes" on the Dojô.
  afterLoginHref: string
}

export function SetupPage({ productName, subtitle, organizationLabel, organizationPlaceholder, afterLoginHref }: SetupPageProps) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({})

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setLoading(true)
    setError(null)
    setFieldErrors({})

    const form = new FormData(e.currentTarget)
    const payload = {
      academyName: form.get('academyName') as string,
      adminName: form.get('adminName') as string,
      adminEmail: form.get('adminEmail') as string,
      adminPassword: form.get('adminPassword') as string,
    }

    try {
      const res = await fetch('/api/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })

      if (res.ok) {
        // Auto-login with the credentials the admin just typed — they
        // already proved they know them by submitting this form, so making
        // them re-type everything on /login right after is pure friction.
        // If the login call itself fails for any reason, fall back to the
        // old behavior (send them to /login) rather than getting stuck.
        try {
          const loginRes = await fetch('/api/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: payload.adminEmail, password: payload.adminPassword }),
          })
          if (loginRes.ok) {
            const body = (await loginRes.json()) as { accessToken: string; refreshToken: string }
            setTokens(body.accessToken, body.refreshToken)
            router.replace(afterLoginHref)
            return
          }
        } catch {
          // fall through to /login below
        }
        router.replace('/login')
        return
      }

      const body = (await res.json()) as ApiErrorBody
      if (res.status === 409) {
        router.replace('/login')
        return
      }
      if (body.details?.fieldErrors) {
        setFieldErrors(body.details.fieldErrors)
      } else {
        setError(body.error ?? 'Erro desconhecido')
      }
    } catch {
      setError('Não foi possível conectar ao servidor. Tente novamente.')
    } finally {
      setLoading(false)
    }
  }

  const inputClass =
    'w-full rounded-lg border border-slate-700 bg-slate-800 px-4 py-2.5 text-white placeholder-slate-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500'

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-slate-950 px-4">
      <div className="w-full max-w-md">
        <h1 className="mb-2 text-3xl font-bold tracking-tight text-white">{productName}</h1>
        <p className="mb-8 text-slate-400">{subtitle}</p>

        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-300" htmlFor="academyName">
              {organizationLabel}
            </label>
            <input
              id="academyName"
              name="academyName"
              type="text"
              required
              minLength={2}
              maxLength={200}
              className={inputClass}
              placeholder={organizationPlaceholder}
            />
            {fieldErrors['academyName']?.map((msg) => (
              <p key={msg} className="mt-1 text-sm text-red-400">
                {msg}
              </p>
            ))}
          </div>

          <hr className="border-slate-700" />

          <div>
            <label className="mb-1 block text-sm font-medium text-slate-300" htmlFor="adminName">
              Seu nome
            </label>
            <input id="adminName" name="adminName" type="text" required minLength={2} maxLength={120} className={inputClass} placeholder="Nome completo" />
            {fieldErrors['adminName']?.map((msg) => (
              <p key={msg} className="mt-1 text-sm text-red-400">
                {msg}
              </p>
            ))}
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-slate-300" htmlFor="adminEmail">
              E-mail do administrador
            </label>
            <input id="adminEmail" name="adminEmail" type="email" required className={inputClass} placeholder="admin@academia.com" />
            {fieldErrors['adminEmail']?.map((msg) => (
              <p key={msg} className="mt-1 text-sm text-red-400">
                {msg}
              </p>
            ))}
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-slate-300" htmlFor="adminPassword">
              Senha (mínimo 8 caracteres)
            </label>
            <input id="adminPassword" name="adminPassword" type="password" required minLength={8} className={inputClass} placeholder="••••••••" />
            {fieldErrors['adminPassword']?.map((msg) => (
              <p key={msg} className="mt-1 text-sm text-red-400">
                {msg}
              </p>
            ))}
          </div>

          {error && (
            <div className="rounded-lg border border-red-800 bg-red-950 px-4 py-3 text-sm text-red-300">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-lg bg-blue-600 px-4 py-3 font-semibold text-white transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loading ? 'Configurando…' : 'Começar'}
          </button>
        </form>
      </div>
    </main>
  )
}
