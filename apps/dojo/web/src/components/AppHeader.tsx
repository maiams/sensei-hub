'use client'

// Global navigation header. Before this, no screen in the Dojô showed who
// was logged in or offered a way to log out — a role that landed on a
// screen it can't use (see /athletes 403 handling) had no way out except
// clearing localStorage by hand. Mirrors the same fix already shipped in
// the Arena (apps/arena/web/src/components/AppHeader.tsx).
//
// Deliberately renders nothing on /login and /setup — pre-authentication
// screens.

import { useEffect, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import Link from 'next/link'
import { clearTokens, getCurrentRole, isLoggedIn } from '../lib/api'
import { USER_ROLE_LABELS } from '../lib/labels'

function isSuppressed(pathname: string): boolean {
  return pathname === '/login' || pathname === '/setup'
}

export function AppHeader() {
  const pathname = usePathname()
  const router = useRouter()
  // isLoggedIn() reads localStorage, which doesn't exist during SSR — always
  // false there. Rendering off that directly would make the server emit no
  // header while an already-logged-in client immediately renders one right
  // after hydration, a server/client mismatch React has to discard and
  // redo. Gating on a client-only `mounted` flag keeps the very first client
  // render identical to the server's (both null), then reconciles normally.
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])

  if (!mounted) return null
  if (isSuppressed(pathname)) return null
  if (!isLoggedIn()) return null

  const role = getCurrentRole()
  const roleLabel = role ? (USER_ROLE_LABELS[role] ?? role) : null
  const presenceRole = role === 'athlete' || role === 'coach' || role === 'academy_admin' || role === 'super_admin'
  const desktopLinks = role === 'athlete'
    ? [{ href: '/attendance', label: 'Hoje' }, { href: '/attendance/history', label: 'Histórico' }]
    : presenceRole
      ? [{ href: '/attendance', label: 'Hoje' }, { href: '/classes', label: 'Turmas' }, { href: '/lessons', label: 'Aulas' }, { href: '/athletes', label: 'Atletas' }]
      : [{ href: '/athletes', label: 'Atletas' }]

  function handleLogout() {
    clearTokens()
    router.replace('/login')
  }

  return (
    <header className="sticky top-0 z-30 border-b border-slate-800 bg-slate-950/95 px-4 py-3 text-white backdrop-blur">
      <div className="mx-auto flex max-w-5xl items-center gap-5">
        <Link href={presenceRole ? '/attendance' : '/athletes'} className="shrink-0 text-sm font-bold tracking-tight text-white">
          Sensei Dojô
        </Link>

        <nav aria-label="Navegação principal" className="hidden items-center gap-1 md:flex">
          {desktopLinks.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              aria-current={pathname === item.href || (item.href !== '/attendance' && pathname.startsWith(`${item.href}/`)) ? 'page' : undefined}
              className={`rounded-lg px-3 py-2 text-sm font-medium transition ${pathname === item.href || (item.href !== '/attendance' && pathname.startsWith(`${item.href}/`)) ? 'bg-slate-800 text-sky-300' : 'text-slate-400 hover:text-white'}`}
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="ml-auto flex min-w-0 items-center gap-2 text-sm">
          {roleLabel && <span className="hidden truncate text-slate-400 min-[380px]:inline">{roleLabel}</span>}
          <button
            type="button"
            onClick={handleLogout}
            className="min-h-10 rounded-lg border border-slate-700 px-3 py-1.5 text-slate-300 transition hover:bg-slate-800"
          >
            Sair
          </button>
        </div>
      </div>
    </header>
  )
}
