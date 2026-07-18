'use client'

// Global, always-visible connectivity + pending-writes indicator (Fase 6).
// CLAUDE.md — Offline and Resilience: "clear sync status... local operator
// feedback... no silent data loss." Sits fixed at the bottom of every page;
// invisible when online with nothing queued, so it never gets in the way of
// the "few clicks, no clutter" operator screens during normal operation.

import { useCallback, useEffect, useState } from 'react'
import { isLoggedIn } from '../lib/api'
import { useOnlineStatus } from '../lib/useOnlineStatus'
import {
  countOutstandingWrites,
  dismissOfflineWrite,
  drainOfflineQueue,
  listOfflineWrites,
  retryOfflineWrite,
  type OfflineWriteRecord,
} from '../lib/offlineQueue'

export function SyncStatusBadge() {
  const online = useOnlineStatus()
  const [outstandingCount, setOutstandingCount] = useState(0)
  const [failedCount, setFailedCount] = useState(0)
  const [expanded, setExpanded] = useState(false)
  const [records, setRecords] = useState<OfflineWriteRecord[]>([])

  const refresh = useCallback(async () => {
    try {
      setOutstandingCount(await countOutstandingWrites())
      const all = await listOfflineWrites()
      setFailedCount(all.filter((r) => r.status === 'failed').length)
      if (expanded) setRecords(all)
    } catch {
      // IndexedDB unavailable (private browsing, very old browser) — the
      // badge just won't show counts; queueing itself degrades gracefully
      // at the call sites (falls through to the normal error message).
    }
  }, [expanded])

  const trySync = useCallback(async () => {
    if (!navigator.onLine) return
    await drainOfflineQueue()
    await refresh()
  }, [refresh])

  useEffect(() => {
    void refresh()
    // Periodic safety net: if the browser's online/offline events are
    // unreliable (some WiFi captive-portal cases report "online" while
    // still unable to reach the server), retry drainage every 30s whenever
    // there's something pending.
    const interval = setInterval(() => void trySync(), 30_000)
    return () => clearInterval(interval)
  }, [refresh, trySync])

  // Trigger an immediate sync attempt the moment `useOnlineStatus` flips to true.
  useEffect(() => {
    if (online) void trySync()
  }, [online, trySync])

  if (!isLoggedIn()) return null
  // Stays visible whenever there's ANYTHING outstanding — pending or
  // failed — even while online. A failed item is a rejected write that
  // still needs a human decision; hiding it because "we're online" would
  // be exactly the silent data loss CLAUDE.md rules out.
  if (online && outstandingCount === 0 && !expanded) return null

  return (
    <div className="fixed bottom-3 right-3 z-50 max-w-sm">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className={`flex items-center gap-2 rounded-full border px-3 py-2 text-xs font-medium shadow-lg backdrop-blur ${
          !online || failedCount > 0
            ? 'border-red-700 bg-red-950/90 text-red-300'
            : outstandingCount > 0
              ? 'border-blue-700 bg-blue-950/90 text-blue-300'
              : 'border-slate-700 bg-slate-900/90 text-slate-400'
        }`}
      >
        <span className={`h-2 w-2 rounded-full ${online ? 'bg-emerald-500' : 'bg-amber-500'}`} />
        {!online ? 'Offline' : 'Online'}
        {outstandingCount > 0 && ` · ${outstandingCount} pendente(s)`}
        {failedCount > 0 && ` · ${failedCount} com erro`}
      </button>

      {expanded && (
        <div className="mt-2 rounded-lg border border-slate-700 bg-slate-900 p-3 shadow-xl">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-sm font-semibold text-white">Sincronização</p>
            <button type="button" onClick={() => void trySync()} className="text-xs text-blue-400 hover:text-blue-300">
              Sincronizar agora
            </button>
          </div>
          {records.length === 0 && <p className="text-xs text-slate-500">Nada pendente.</p>}
          <ul className="max-h-56 space-y-1.5 overflow-y-auto">
            {records.map((r) => (
              <li key={r.id} className="rounded border border-slate-800 bg-slate-950 px-2.5 py-2 text-xs">
                <p className="text-slate-300">{r.description}</p>
                {r.status === 'failed' ? (
                  <>
                    <p className="mt-0.5 text-red-400">{r.error}</p>
                    <div className="mt-1 flex gap-2">
                      <button
                        type="button"
                        onClick={() => void retryOfflineWrite(r.id).then(refresh)}
                        className="text-blue-400 hover:text-blue-300"
                      >
                        Tentar de novo
                      </button>
                      <button
                        type="button"
                        onClick={() => void dismissOfflineWrite(r.id).then(refresh)}
                        className="text-slate-500 hover:text-slate-300"
                      >
                        Descartar
                      </button>
                    </div>
                  </>
                ) : (
                  <p className="mt-0.5 text-amber-400">Aguardando conexão…</p>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
