// Offline write queue (Fase 6). IndexedDB (via `idb`) is used here
// specifically because it's the right tool for a structured, queryable
// outbox of pending mutations — unlike the read-only API caching (see
// src/app/sw.ts), which uses the browser's native Cache Storage instead.
//
// Scope is deliberately narrow: only check-in and weigh-in submissions are
// queueable (see call sites in checkin/page.tsx and events/[id]/page.tsx).
// These are the two flows CLAUDE.md explicitly calls out as needing offline
// resilience ("Mobile Check-In", "Weigh-In Integration... tolerate bad
// internet and allow safe retry"). Bracket results, scoreboard actions, and
// anything else are NOT queued — replaying a stale, unattended tournament
// decision from a background queue is a different risk category than
// replaying "this person is present" or "this is their weight", and the
// project's product owner hasn't set a conflict-resolution policy for that.
//
// Replay never invents new conflict-resolution logic: it just re-submits the
// exact original request once online. The backend's own validation (unique
// indexes, explicit state machines, 409s) is what decides whether a queued
// write still makes sense — a rejection is surfaced to the operator
// (CLAUDE.md: "no silent data loss"), never silently discarded or retried
// forever.

import { openDB, type DBSchema, type IDBPDatabase } from 'idb'
import { getAccessToken } from './api'
import { translateApiError } from './labels'

export type QueueableMethod = 'POST' | 'PATCH' | 'DELETE'

export interface OfflineWriteRecord {
  id: string
  path: string // relative to /api, same convention as apiFetch's `path` argument
  method: QueueableMethod
  body: unknown
  description: string // human-readable label for the sync status UI
  createdAt: string
  status: 'pending' | 'failed'
  error?: string
  attempts: number
}

interface OfflineDBSchema extends DBSchema {
  outbox: {
    key: string
    value: OfflineWriteRecord
    indexes: { status: string }
  }
}

let dbPromise: Promise<IDBPDatabase<OfflineDBSchema>> | null = null

function getDb() {
  if (typeof window === 'undefined') {
    throw new Error('offlineQueue is client-only')
  }
  if (!dbPromise) {
    dbPromise = openDB<OfflineDBSchema>('sensei-hub-offline', 1, {
      upgrade(db) {
        const store = db.createObjectStore('outbox', { keyPath: 'id' })
        store.createIndex('status', 'status')
      },
    })
  }
  return dbPromise
}

export async function enqueueOfflineWrite(input: {
  path: string
  method: QueueableMethod
  body: unknown
  description: string
}): Promise<OfflineWriteRecord> {
  const db = await getDb()
  const record: OfflineWriteRecord = {
    id: crypto.randomUUID(),
    path: input.path,
    method: input.method,
    body: input.body,
    description: input.description,
    createdAt: new Date().toISOString(),
    status: 'pending',
    attempts: 0,
  }
  await db.put('outbox', record)
  return record
}

export async function listOfflineWrites(): Promise<OfflineWriteRecord[]> {
  const db = await getDb()
  const all = await db.getAll('outbox')
  return all.sort((a, b) => a.createdAt.localeCompare(b.createdAt))
}

// Counts EVERYTHING in the outbox, not just 'pending' — a 'failed' item
// (rejected by the server, not a connectivity issue) still needs the
// operator's attention and must never silently disappear from the sync
// indicator (CLAUDE.md: "no silent data loss").
export async function countOutstandingWrites(): Promise<number> {
  const db = await getDb()
  return db.count('outbox')
}

export async function dismissOfflineWrite(id: string): Promise<void> {
  const db = await getDb()
  await db.delete('outbox', id)
}

export async function retryOfflineWrite(id: string): Promise<void> {
  const db = await getDb()
  const record = await db.get('outbox', id)
  if (!record) return
  record.status = 'pending'
  delete record.error
  await db.put('outbox', record)
  await drainOfflineQueue()
}

// Replays pending items oldest-first. Stops at the first item that fails due
// to a genuine network error (still offline) — the rest stay 'pending' for
// the next trigger. An item rejected by the server (ApiError, i.e. a real
// HTTP error status) is marked 'failed' with a translated message and
// drainage continues — that failure isn't a connectivity problem, so the
// next queued item might still succeed.
export async function drainOfflineQueue(): Promise<{ succeeded: number; failed: number }> {
  const db = await getDb()
  const pending = await db.getAllFromIndex('outbox', 'status', 'pending')
  pending.sort((a, b) => a.createdAt.localeCompare(b.createdAt))

  let succeeded = 0
  let failed = 0

  for (const record of pending) {
    try {
      const token = getAccessToken()
      const headers = new Headers({ 'Content-Type': 'application/json' })
      if (token) headers.set('Authorization', `Bearer ${token}`)
      const res = await fetch(`/api${record.path}`, {
        method: record.method,
        headers,
        body: JSON.stringify(record.body),
      })
      if (res.ok) {
        await db.delete('outbox', record.id)
        succeeded++
        continue
      }
      const errorBody = await res.json().catch(() => ({ error: 'Erro desconhecido' }))
      record.status = 'failed'
      record.error = translateApiError(errorBody.error ?? 'Erro desconhecido')
      record.attempts++
      await db.put('outbox', record)
      failed++
    } catch {
      // fetch() itself threw — still offline (or DNS/CORS down). Leave this
      // and every later item as 'pending' and stop; a later online/retry
      // trigger will pick up from here.
      break
    }
  }

  return { succeeded, failed }
}
