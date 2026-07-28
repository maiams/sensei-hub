// station.ts identifies a browser/device ("station") for the offline queue
// and hands out a monotonic per-station sequence number. Both are used for
// idempotency/audit (see offlineQueue.ts and offlineResilience.test.ts on
// the server), so this proves the two guarantees that matter:
//   - stationId is generated once and then STABLE across the lifetime of
//     the browser profile (including across a page reload).
//   - clientSeq only ever goes up, starts at 1, and — critically — does
//     NOT reset back to 0/1 after a reload, because a reset would let two
//     different writes from the same station collide under the same seq.
import { describe, it, expect, vi } from 'vitest'
import { getStationId, nextClientSeq } from '../station'

describe('getStationId', () => {
  it('generates an id on first use and returns the SAME id on every subsequent call', () => {
    const first = getStationId()
    expect(first).toMatch(/^[0-9a-f-]{36}$/i)
    expect(getStationId()).toBe(first)
    expect(getStationId()).toBe(first)
  })

  it('persists across a simulated page reload (fresh module instance, same localStorage)', async () => {
    const first = getStationId()

    // vi.resetModules() clears vitest's module registry — the closest thing
    // to "the page reloaded and every module-level variable is gone" without
    // actually tearing down jsdom. localStorage (unlike module state) is not
    // reset, matching a real reload.
    vi.resetModules()
    const reloaded = await import('../station')
    expect(reloaded.getStationId()).toBe(first)
  })
})

describe('nextClientSeq', () => {
  it('starts at 1 and increments by exactly 1 each call', () => {
    expect(nextClientSeq()).toBe(1)
    expect(nextClientSeq()).toBe(2)
    expect(nextClientSeq()).toBe(3)
  })

  it('does NOT reset after a simulated reload — keeps counting up from where it left off', async () => {
    expect(nextClientSeq()).toBe(1)
    expect(nextClientSeq()).toBe(2)

    vi.resetModules()
    const reloaded = await import('../station')
    // A fresh module instance (no in-memory counter of its own) still reads
    // the persisted value from localStorage and continues from 3, not 1.
    expect(reloaded.nextClientSeq()).toBe(3)
  })
})
