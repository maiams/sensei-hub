'use client'

// Global navigation header (task: "não existe navegação global" — before
// this, /settings/divisions was only reachable by typing the URL and no
// screen showed who was logged in or offered a way to log out).
//
// Deliberately renders nothing on:
//  - /login, /setup — pre-authentication screens.
//  - /display/*     — the public venue/scoreboard TV. CLAUDE.md: "The public
//                      display must not expose admin controls."
//  - /events/:id/operate — the mesário's fullscreen table-operation screen.
//  - /kiosk         — the Electron launcher window, kiosk-style by design.
//
// Each nav link is gated by the role's actual server-side permission for
// that screen (staff+ for Eventos/Divisões, academy_admin+ for Usuários) —
// this hides links a role can't use, but the server keeps enforcing access
// regardless (CLAUDE.md: "Frontend hiding is not authorization").

import { useEffect, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import Link from 'next/link'
import { hasMinRole, type UserRole } from '@sensei-hub/shared'
import { clearTokens, getCurrentRole, isLoggedIn } from '../lib/api'
import { USER_ROLE_LABELS } from '../lib/labels'

function isSuppressed(pathname: string): boolean {
  if (pathname === '/login' || pathname === '/setup' || pathname === '/kiosk') return true
  if (pathname.startsWith('/display')) return true
  if (/^\/events\/[^/]+\/operate(\/|$)/.test(pathname)) return true
  return false
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

  function handleLogout() {
    clearTokens()
    router.replace('/login')
  }

  const links: Array<{ href: string; label: string }> = []
  if (role && hasMinRole(role as UserRole, 'staff')) {
    links.push({ href: '/events', label: 'Eventos' })
    links.push({ href: '/settings/divisions', label: 'Divisões' })
  }
  if (role && hasMinRole(role as UserRole, 'academy_admin')) {
    links.push({ href: '/settings/users', label: 'Usuários' })
  }

  return (
    <header className="border-b border-slate-800 bg-slate-950 px-4 py-3 text-white">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-6 gap-y-2">
        <Link href="/events" className="text-sm font-bold tracking-tight text-white">
          Sensei Arena
        </Link>

        <nav className="flex flex-wrap items-center gap-4">
          {links.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className={
                pathname === link.href || pathname.startsWith(link.href + '/')
                  ? 'text-sm font-semibold text-white'
                  : 'text-sm text-slate-400 hover:text-slate-200'
              }
            >
              {link.label}
            </Link>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-3 text-sm">
          {roleLabel && <span className="text-slate-400">{roleLabel}</span>}
          <button
            type="button"
            onClick={handleLogout}
            className="rounded-lg border border-slate-700 px-3 py-1.5 text-slate-300 transition hover:bg-slate-800"
          >
            Sair
          </button>
        </div>
      </div>
    </header>
  )
}
