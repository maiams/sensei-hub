'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useState, type ReactNode } from 'react'
import type { PresenceRole } from '../lib/presence'

interface NavItem {
  href: string
  label: string
  shortLabel?: string
  icon: ReactNode
}

const coachNav: NavItem[] = [
  { href: '/attendance', label: 'Hoje', icon: <HomeIcon /> },
  { href: '/classes', label: 'Turmas', icon: <GroupIcon /> },
  { href: '/lessons', label: 'Aulas', icon: <CalendarIcon /> },
  { href: '/athletes', label: 'Atletas', icon: <PersonIcon /> },
]

const athleteNav: NavItem[] = [
  { href: '/attendance', label: 'Hoje', icon: <HomeIcon /> },
  { href: '/attendance/history', label: 'Histórico', icon: <HistoryIcon /> },
]

export function PresenceShell({
  role,
  title,
  eyebrow,
  action,
  children,
}: {
  role: PresenceRole | null
  title: string
  eyebrow?: string
  action?: ReactNode
  children: ReactNode
}) {
  const pathname = usePathname()
  const [online, setOnline] = useState(true)
  const nav = role === 'athlete' ? athleteNav : coachNav

  useEffect(() => {
    const update = () => setOnline(navigator.onLine)
    update()
    window.addEventListener('online', update)
    window.addEventListener('offline', update)
    return () => {
      window.removeEventListener('online', update)
      window.removeEventListener('offline', update)
    }
  }, [])

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      {!online && (
        <div role="status" className="border-b border-amber-700 bg-amber-950 px-4 py-2 text-center text-sm font-medium text-amber-200">
          Sem conexão. Nenhuma ação será mostrada como concluída antes de chegar ao servidor.
        </div>
      )}

      <div className="mx-auto max-w-5xl px-4 pb-[calc(var(--dojo-bottom-nav-height)+env(safe-area-inset-bottom)+1.5rem)] pt-5 sm:px-6 md:pb-10 md:pt-8">
        <header className="mb-6 flex min-w-0 items-end justify-between gap-3">
          <div className="min-w-0">
            {eyebrow && <p className="mb-1 text-xs font-semibold uppercase tracking-[0.16em] text-sky-400">{eyebrow}</p>}
            <h1 className="truncate text-2xl font-bold tracking-tight sm:text-3xl">{title}</h1>
          </div>
          {action && <div className="shrink-0">{action}</div>}
        </header>
        {children}
      </div>

      <nav aria-label="Navegação principal" className="fixed inset-x-0 bottom-0 z-40 border-t border-slate-800 bg-slate-950/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden">
        <ul className="mx-auto grid max-w-lg grid-flow-col auto-cols-fr">
          {nav.map((item) => {
            const active = item.href === '/attendance'
              ? pathname === item.href
              : pathname === item.href || pathname.startsWith(`${item.href}/`)
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  aria-current={active ? 'page' : undefined}
                  className={`flex min-h-[4.5rem] flex-col items-center justify-center gap-1 px-1 text-xs font-medium ${active ? 'text-sky-300' : 'text-slate-400'}`}
                >
                  <span aria-hidden="true">{item.icon}</span>
                  <span>{item.shortLabel ?? item.label}</span>
                </Link>
              </li>
            )
          })}
        </ul>
      </nav>
    </div>
  )
}

function Icon({ children }: { children: ReactNode }) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-5 w-5">{children}</svg>
}

function HomeIcon() { return <Icon><path d="m3 11 9-8 9 8"/><path d="M5 10v10h14V10M9 20v-6h6v6"/></Icon> }
function GroupIcon() { return <Icon><circle cx="9" cy="8" r="3"/><circle cx="17" cy="9" r="2"/><path d="M3 20c0-4 2-7 6-7s6 3 6 7M15 14c3 0 5 2 5 5"/></Icon> }
function CalendarIcon() { return <Icon><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v4M17 3v4M3 10h18"/></Icon> }
function PersonIcon() { return <Icon><circle cx="12" cy="8" r="4"/><path d="M4 21c0-5 3-8 8-8s8 3 8 8"/></Icon> }
function HistoryIcon() { return <Icon><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5M12 7v6l4 2"/></Icon> }
