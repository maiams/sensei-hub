'use client'

import { useEffect, useRef, type ReactNode } from 'react'

export function LoadingState({ label = 'Carregando…' }: { label?: string }) {
  return (
    <div role="status" className="space-y-3" aria-label={label}>
      <span className="sr-only">{label}</span>
      {[0, 1, 2].map((item) => <div key={item} className="h-24 animate-pulse rounded-2xl border border-slate-800 bg-slate-900" />)}
    </div>
  )
}

export function EmptyState({ title, description, action }: { title: string; description: string; action?: ReactNode }) {
  return (
    <section className="rounded-2xl border border-dashed border-slate-700 bg-slate-900/50 px-5 py-10 text-center">
      <h2 className="text-lg font-semibold text-white">{title}</h2>
      <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-slate-400">{description}</p>
      {action && <div className="mt-5">{action}</div>}
    </section>
  )
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <section role="alert" className="rounded-2xl border border-red-800 bg-red-950/50 p-5">
      <h2 className="font-semibold text-red-200">Não foi possível carregar</h2>
      <p className="mt-1 text-sm leading-6 text-red-300">{message}</p>
      {onRetry && <button type="button" onClick={onRetry} className="mt-4 min-h-12 rounded-xl border border-red-700 px-4 py-2 font-semibold text-red-100">Tentar novamente</button>}
    </section>
  )
}

export function StatusPill({ tone, children }: { tone: 'neutral' | 'info' | 'success' | 'danger' | 'warning'; children: ReactNode }) {
  const tones = {
    neutral: 'border-slate-700 bg-slate-800 text-slate-300',
    info: 'border-sky-800 bg-sky-950 text-sky-200',
    success: 'border-emerald-800 bg-emerald-950 text-emerald-200',
    danger: 'border-red-800 bg-red-950 text-red-200',
    warning: 'border-amber-800 bg-amber-950 text-amber-200',
  }
  return <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${tones[tone]}`}>{children}</span>
}

export function Modal({ title, description, children, onClose }: { title: string; description?: string; children: ReactNode; onClose: () => void }) {
  const dialogRef = useRef<HTMLElement>(null)

  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const dialog = dialogRef.current
    const focusable = dialog?.querySelector<HTMLElement>('[autofocus]')
      ?? dialog?.querySelector<HTMLElement>('input, textarea, select, button, a[href]')
    focusable?.focus()

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
        return
      }
      if (event.key !== 'Tab' || !dialog) return
      const items = [...dialog.querySelectorAll<HTMLElement>('input, textarea, select, button, a[href]')]
        .filter((item) => !item.hasAttribute('disabled'))
      if (!items.length) return
      const first = items[0]
      const last = items[items.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault(); last?.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault(); first?.focus()
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.body.style.overflow = previousOverflow
      document.removeEventListener('keydown', handleKeyDown)
      previousFocus?.focus()
    }
  }, [onClose])

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/80 p-0 sm:items-center sm:p-4" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) onClose() }}>
      <section ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="presence-modal-title" className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-t-3xl border border-slate-700 bg-slate-900 p-5 shadow-2xl sm:rounded-3xl sm:p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 id="presence-modal-title" className="text-xl font-bold text-white">{title}</h2>
            {description && <p className="mt-1 text-sm leading-6 text-slate-400">{description}</p>}
          </div>
          <button type="button" onClick={onClose} aria-label="Fechar" className="grid min-h-11 min-w-11 place-items-center rounded-full text-xl text-slate-300 hover:bg-slate-800">×</button>
        </div>
        <div className="mt-5">{children}</div>
      </section>
    </div>
  )
}
