'use client'

import { useEffect, useState } from 'react'

// Registers the Serwist-built service worker (public/sw.js) and gives the app
// a way to recover on its own from a stale/fossilized service worker — see
// docs/dev-service-worker-cache-recovery.md for the incident this responds
// to (26/jul/2026: an old production build's SW kept controlling localhost
// with a week-old precache, producing a white screen with
// "Cannot read properties of undefined (reading 'call')" on every module).
//
// Two mechanisms, layered:
//
// 1. Reload on controllerchange. sw.ts already sets skipWaiting+clientsClaim,
//    so a newly installed SW takes control of open tabs immediately — but the
//    *tab's own JS*, already loaded from the previous build, keeps running
//    until a navigation happens. If that old JS then lazy-loads a chunk that
//    no longer exists on the server (a normal deploy rotates chunk hashes),
//    it fails. Reloading the page the moment a new SW takes control keeps the
//    running JS in sync with whatever the SW/precache actually has. This is
//    the standard pairing for skipWaiting (see Workbox/Serwist docs) and is
//    what actually closes the gap for the *legitimate* prod-to-prod upgrade
//    case.
//
// 2. Hard recovery on chunk-load failure. Mechanism 1 only fires when a new
//    SW is installed and taking over. It does nothing for the case actually
//    observed in the incident: a SW from a much older build (or one left over
//    from a one-off `next build && next start` in what is normally a dev
//    environment) sitting there with no newer version to update to — in dev,
//    fetching /sw.js for the update check 404s, so the browser's update
//    algorithm never installs anything new, and the stale SW just keeps
//    serving its old precache indefinitely. There is no "update" event to
//    hook for that case. So instead we watch for the *symptom*: a chunk that
//    fails to load, or the module-registry TypeError that follows from
//    running mismatched chunks together. On that signal we unregister every
//    SW registration, wipe every Cache Storage entry, and reload — the same
//    steps a human would do by hand in DevTools (see the doc above), just
//    automatic.
//
// Trade-off: (2) is a heuristic net, not a guarantee — a genuinely unrelated
// script error matching the same message could trigger an unnecessary reload.
// It is capped (see MAX_AUTO_RECOVERIES) so a real, unrelated failure loop
// degrades to a visible banner asking for a manual reload instead of
// reloading forever. It also cannot recover in-progress unsaved UI state —
// by design, per CLAUDE.md, anything that matters for tournament operation
// (e.g. scoreboard state) must already be persisted server-side often enough
// to survive a refresh; this mechanism assumes that, it does not replace it.

const RECOVERY_COUNT_KEY = 'sh-sw-recovery-count'
const RECOVERY_WINDOW_MS = 60_000
const MAX_AUTO_RECOVERIES = 2

const CHUNK_ERROR_PATTERNS = [
  /Loading chunk [\d\w-]+ failed/i,
  /Loading CSS chunk [\d\w-]+ failed/i,
  /ChunkLoadError/,
  /Cannot read properties of undefined \(reading 'call'\)/,
]

function looksLikeChunkFailure(message: string | undefined, name: string | undefined): boolean {
  if (name === 'ChunkLoadError') return true
  if (!message) return false
  return CHUNK_ERROR_PATTERNS.some((pattern) => pattern.test(message))
}

function readRecoveryAttempts(): number {
  try {
    const raw = sessionStorage.getItem(RECOVERY_COUNT_KEY)
    if (!raw) return 0
    const [countStr, tsStr] = raw.split(':')
    const count = Number(countStr)
    const ts = Number(tsStr)
    if (!Number.isFinite(count) || !Number.isFinite(ts)) return 0
    // Old attempts outside the window don't count against the cap anymore.
    if (Date.now() - ts > RECOVERY_WINDOW_MS) return 0
    return count
  } catch {
    return 0
  }
}

function recordRecoveryAttempt(count: number) {
  try {
    sessionStorage.setItem(RECOVERY_COUNT_KEY, `${count}:${Date.now()}`)
  } catch {
    // sessionStorage unavailable (private mode, etc.) — worst case we lose
    // the loop guard, not correctness.
  }
}

async function hardRecover(): Promise<void> {
  try {
    const registrations = await navigator.serviceWorker.getRegistrations()
    await Promise.all(registrations.map((registration) => registration.unregister()))
  } catch {
    // Best effort — still proceed to clear caches and reload.
  }

  try {
    if ('caches' in window) {
      const keys = await caches.keys()
      await Promise.all(keys.map((key) => caches.delete(key)))
    }
  } catch {
    // Best effort.
  }

  window.location.reload()
}

export function ServiceWorkerRegister() {
  const [recoveryExhausted, setRecoveryExhausted] = useState(false)

  useEffect(() => {
    if (!('serviceWorker' in navigator)) return

    navigator.serviceWorker.register('/sw.js').catch(() => {
      // No SW in this build (dev) or registration genuinely failed — either
      // way the app must keep working online without it.
    })

    // Mechanism 1: a new SW just took control (skipWaiting+clientsClaim in
    // sw.ts) — reload so this tab's JS matches it. Guard against reloading
    // more than once per page load (controllerchange can in principle fire
    // more than once).
    let reloadedForController = false
    function onControllerChange() {
      if (reloadedForController) return
      reloadedForController = true
      window.location.reload()
    }
    navigator.serviceWorker.addEventListener('controllerchange', onControllerChange)

    // Mechanism 2: detect the chunk-mismatch symptom and force a clean
    // recovery (unregister SW, clear caches, reload) instead of leaving the
    // operator stuck on a white screen with no way to help themselves.
    function maybeRecover(message: string | undefined, name: string | undefined) {
      if (!looksLikeChunkFailure(message, name)) return

      const attempts = readRecoveryAttempts()
      if (attempts >= MAX_AUTO_RECOVERIES) {
        setRecoveryExhausted(true)
        return
      }

      recordRecoveryAttempt(attempts + 1)
      void hardRecover()
    }

    function onWindowError(event: ErrorEvent) {
      maybeRecover(event.message, event.error?.name)
    }
    function onUnhandledRejection(event: PromiseRejectionEvent) {
      const reason: unknown = event.reason
      const message = reason instanceof Error ? reason.message : String(reason)
      const name = reason instanceof Error ? reason.name : undefined
      maybeRecover(message, name)
    }
    window.addEventListener('error', onWindowError)
    window.addEventListener('unhandledrejection', onUnhandledRejection)

    return () => {
      navigator.serviceWorker.removeEventListener('controllerchange', onControllerChange)
      window.removeEventListener('error', onWindowError)
      window.removeEventListener('unhandledrejection', onUnhandledRejection)
    }
  }, [])

  if (!recoveryExhausted) return null

  // We tried the automatic recovery twice in the last minute and the app is
  // still failing — stop looping and tell the operator what to do, instead
  // of silently trying forever. Deliberately plain/inline: this can render
  // when the rest of the app has failed to hydrate.
  return (
    <div
      role="alert"
      style={{
        position: 'fixed',
        bottom: 16,
        left: 16,
        right: 16,
        zIndex: 9999,
        padding: '12px 16px',
        borderRadius: 8,
        background: '#7f1d1d',
        color: '#fff',
        fontSize: 14,
        boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
      }}
    >
      Falha ao carregar a aplicação mesmo após tentar recuperar automaticamente. Feche esta aba e
      abra novamente, ou recarregue a página (Cmd/Ctrl+Shift+R).
    </div>
  )
}
