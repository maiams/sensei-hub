// Exercises the outbox that's the actual product promise of this
// codebase (CLAUDE.md: "the system promises not to lose data" in gyms with
// bad internet). Every case here mirrors a failure mode named in the task:
// queue-when-offline, drain-when-back, survive-a-reload, deterministic
// order, definitive-rejection-stays-visible, retry/discard.
//
// `fetch` is mocked directly rather than going through MSW or a real server
// — offlineQueue.ts's only contract with the network is a single
// `fetch(...)` call per queued item, so a plain vi.fn() is the simplest
// thing that can possibly work and keeps this test independent of
// @arena/server actually running.
//
// Ordering tests write directly to the IndexedDB store via a second `idb`
// connection (same DB name/version) instead of faking system time — a
// deliberate choice: fake-indexeddb schedules its request callbacks with
// real `setTimeout`s internally, so faking timers here would freeze the
// queue's own awaits, not just Date.now().
//
// The module under test is (re-)imported dynamically in `beforeEach`, after
// `vi.resetModules()`. offlineQueue.ts caches its IndexedDB connection in a
// module-level `dbPromise` — without resetting the module registry, every
// test in this file would share ONE connection opened by the first test,
// and setup.ts's per-test fresh fake-indexeddb factory would have no effect
// (the stale connection keeps pointing at the OLD store), so writes from
// one test would keep bleeding into the next.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { openDB } from 'idb'
import { setTokens, clearTokens } from '@sensei-hub/core-web'
import type * as OfflineQueue from '../offlineQueue'

const okResponse = (body: unknown = {}) => ({ ok: true, status: 200, json: async () => body }) as Response
const errorResponse = (status: number, error: string) => ({ ok: false, status, json: async () => ({ error }) }) as Response

let fetchMock: ReturnType<typeof vi.fn>
let Q: typeof OfflineQueue

beforeEach(async () => {
  fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
  vi.resetModules()
  Q = await import('../offlineQueue')
})

afterEach(() => {
  vi.unstubAllGlobals()
})

// Overwrites the createdAt of already-queued records directly in the store,
// so drain order can be pinned deterministically without touching Date.
async function forceOrder(records: Array<{ id: string }>, isoTimestamps: string[]) {
  const db = await openDB('sensei-hub-offline', 1)
  for (const [i, record] of records.entries()) {
    const stored = await db.get('outbox', record.id)
    await db.put('outbox', { ...stored, createdAt: isoTimestamps[i] })
  }
  db.close()
}

describe('enqueue + drain — the happy offline→online cycle', () => {
  it('queues a write while offline, then drains it successfully once back online', async () => {
    const record = await Q.enqueueOfflineWrite({
      path: '/events/e1/checkin',
      method: 'POST',
      body: { athleteId: 'a1' },
      description: 'Check-in Fulano',
    })
    expect(await Q.countOutstandingWrites()).toBe(1)

    fetchMock.mockResolvedValueOnce(okResponse({ id: 'att1' }))
    const result = await Q.drainOfflineQueue()

    expect(result).toEqual({ succeeded: 1, failed: 0 })
    expect(await Q.countOutstandingWrites()).toBe(0)
    expect(await Q.listOfflineWrites()).toEqual([])

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/events/e1/checkin')
    expect(init.method).toBe('POST')
    const headers = init.headers as Headers
    expect(headers.get('Idempotency-Key')).toBe(record.id)
    expect(headers.get('X-Station-Id')).toBe(record.stationId)
    expect(headers.get('X-Client-Seq')).toBe(String(record.clientSeq))
    expect(headers.get('X-Occurred-At')).toBe(record.createdAt)
    expect(headers.get('Content-Type')).toBe('application/json')
  })

  it('attaches the Authorization header from the stored access token, when one exists', async () => {
    setTokens('fake-access-token', 'fake-refresh-token')
    await Q.enqueueOfflineWrite({ path: '/x', method: 'POST', body: {}, description: 'x' })
    fetchMock.mockResolvedValueOnce(okResponse())
    await Q.drainOfflineQueue()

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect((init.headers as Headers).get('Authorization')).toBe('Bearer fake-access-token')
    clearTokens()
  })

  it('keeps a write PENDING — never drops it — when the network is genuinely down', async () => {
    await Q.enqueueOfflineWrite({ path: '/events/e1/checkin', method: 'POST', body: {}, description: 'x' })
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'))

    const result = await Q.drainOfflineQueue()
    expect(result).toEqual({ succeeded: 0, failed: 0 })
    expect(await Q.countOutstandingWrites()).toBe(1)
    const [item] = await Q.listOfflineWrites()
    expect(item?.status).toBe('pending')
  })
})

describe('durability across a reload', () => {
  it('does NOT lose queued writes across a simulated page reload', async () => {
    await Q.enqueueOfflineWrite({ path: '/a', method: 'POST', body: {}, description: 'um' })
    await Q.enqueueOfflineWrite({ path: '/b', method: 'POST', body: {}, description: 'dois' })
    expect(await Q.countOutstandingWrites()).toBe(2)

    // vi.resetModules() simulates "the page reloaded": every module-level
    // variable (including offlineQueue.ts's cached `dbPromise`) is gone, but
    // the underlying fake IndexedDB store (this test's globalThis.indexedDB,
    // assigned once per test in setup.ts's beforeEach, which already ran
    // before THIS test's own beforeEach above) is untouched — same as a
    // real browser tab refresh.
    vi.resetModules()
    const reloaded = await import('../offlineQueue')

    const afterReload = await reloaded.listOfflineWrites()
    expect(afterReload).toHaveLength(2)
    expect(afterReload.map((w) => w.description).sort()).toEqual(['dois', 'um'])
    expect(afterReload.every((w) => w.status === 'pending')).toBe(true)
  })
})

describe('drain ordering', () => {
  it('drains PENDING items oldest-first by createdAt, regardless of enqueue order', async () => {
    // Enqueued in reverse of the desired drain order — proves ordering
    // comes from createdAt, not insertion/key order.
    const c = await Q.enqueueOfflineWrite({ path: '/third', method: 'POST', body: {}, description: 'third' })
    const b = await Q.enqueueOfflineWrite({ path: '/second', method: 'POST', body: {}, description: 'second' })
    const a = await Q.enqueueOfflineWrite({ path: '/first', method: 'POST', body: {}, description: 'first' })
    await forceOrder(
      [a, b, c],
      ['2026-01-01T10:00:00.000Z', '2026-01-01T10:00:01.000Z', '2026-01-01T10:00:02.000Z'],
    )

    fetchMock.mockResolvedValue(okResponse())
    await Q.drainOfflineQueue()

    const calledPaths = fetchMock.mock.calls.map(([url]) => url)
    expect(calledPaths).toEqual(['/api/first', '/api/second', '/api/third'])
  })

  it('stops at the first genuine network failure, leaving later items untouched (not attempted, still pending)', async () => {
    const a = await Q.enqueueOfflineWrite({ path: '/a', method: 'POST', body: {}, description: 'a' })
    const b = await Q.enqueueOfflineWrite({ path: '/b', method: 'POST', body: {}, description: 'b' })
    await forceOrder([a, b], ['2026-01-01T00:00:00.000Z', '2026-01-01T00:00:01.000Z'])

    fetchMock.mockRejectedValueOnce(new TypeError('network down'))
    const result = await Q.drainOfflineQueue()

    expect(result).toEqual({ succeeded: 0, failed: 0 })
    expect(fetchMock).toHaveBeenCalledTimes(1) // 'b' was never even attempted
    const items = await Q.listOfflineWrites()
    expect(items.every((i) => i.status === 'pending')).toBe(true)
  })

  it('continues draining PAST a rejected item — a business rejection is not a connectivity problem', async () => {
    const a = await Q.enqueueOfflineWrite({ path: '/a', method: 'POST', body: {}, description: 'a' })
    const b = await Q.enqueueOfflineWrite({ path: '/b', method: 'POST', body: {}, description: 'b' })
    await forceOrder([a, b], ['2026-01-01T00:00:00.000Z', '2026-01-01T00:00:01.000Z'])

    fetchMock.mockResolvedValueOnce(errorResponse(409, 'Conflito')).mockResolvedValueOnce(okResponse())

    const result = await Q.drainOfflineQueue()
    expect(result).toEqual({ succeeded: 1, failed: 1 })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})

describe('a write the server rejects for good', () => {
  it('is marked "failed" — visible to the operator via list/count, never silently dropped', async () => {
    const record = await Q.enqueueOfflineWrite({
      path: '/events/e1/checkin',
      method: 'POST',
      body: { athleteId: 'ghost' },
      description: 'Check-in fantasma',
    })
    fetchMock.mockResolvedValueOnce(errorResponse(404, 'Athlete not found'))

    const result = await Q.drainOfflineQueue()
    expect(result).toEqual({ succeeded: 0, failed: 1 })

    const [item] = await Q.listOfflineWrites()
    expect(item?.id).toBe(record.id)
    expect(item?.status).toBe('failed')
    expect(item?.error).toBeTruthy()
    expect(item?.attempts).toBe(1)
    // Still outstanding — CLAUDE.md: "no silent data loss".
    expect(await Q.countOutstandingWrites()).toBe(1)
  })

  it('retryOfflineWrite flips it back to pending and re-attempts it', async () => {
    const record = await Q.enqueueOfflineWrite({ path: '/x', method: 'PATCH', body: {}, description: 'peso' })
    fetchMock.mockResolvedValueOnce(errorResponse(422, 'Peso inválido'))
    await Q.drainOfflineQueue()
    expect((await Q.listOfflineWrites())[0]?.status).toBe('failed')

    fetchMock.mockResolvedValueOnce(okResponse())
    await Q.retryOfflineWrite(record.id)

    expect(await Q.listOfflineWrites()).toEqual([])
    expect(await Q.countOutstandingWrites()).toBe(0)
  })

  it('retrying a second time (still rejected) keeps it failed and bumps attempts, still never dropped', async () => {
    const record = await Q.enqueueOfflineWrite({ path: '/x', method: 'PATCH', body: {}, description: 'peso' })
    fetchMock.mockResolvedValueOnce(errorResponse(422, 'Peso inválido'))
    await Q.drainOfflineQueue()

    fetchMock.mockResolvedValueOnce(errorResponse(422, 'Peso inválido'))
    await Q.retryOfflineWrite(record.id)

    const [item] = await Q.listOfflineWrites()
    expect(item?.status).toBe('failed')
    expect(item?.attempts).toBe(2)
  })

  it('dismissOfflineWrite discards it for good, on explicit operator action', async () => {
    const record = await Q.enqueueOfflineWrite({ path: '/x', method: 'POST', body: {}, description: 'x' })
    fetchMock.mockResolvedValueOnce(errorResponse(400, 'Erro'))
    await Q.drainOfflineQueue()
    expect(await Q.countOutstandingWrites()).toBe(1)

    await Q.dismissOfflineWrite(record.id)
    expect(await Q.countOutstandingWrites()).toBe(0)
    expect(await Q.listOfflineWrites()).toEqual([])
  })
})
