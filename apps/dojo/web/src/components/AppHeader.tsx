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

  function handleLogout() {
    clearTokens()
    router.replace('/login')
  }

  return (
    <header className="border-b border-slate-800 bg-slate-950 px-4 py-3 text-white">
      <div className="mx-auto flex max-w-3xl flex-wrap items-center gap-x-6 gap-y-2">
        <Link href="/athletes" className="text-sm font-bold tracking-tight text-white">
          Sensei Dojô
        </Link>

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
