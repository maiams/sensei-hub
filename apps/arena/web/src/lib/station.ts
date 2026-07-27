// Identifies THIS browser/device as a "station" for the offline queue
// (offlineQueue.ts) — an area notebook that keeps its own writes locally and
// pushes them to the master when it can. Two things live here, both
// deliberately NOT wall-clock based (station clocks are old, unmaintained
// notebooks — never trusted for ordering, see AuthCtx's doc comment in
// packages/core-server/src/context.ts):
//
//  - a stable stationId, generated once and kept in localStorage — answers
//    "which station" for the audit trail even when a write is replayed long
//    after the fact.
//  - a monotonic per-station sequence number, also in localStorage,
//    incremented once per enqueued write — a logical clock local to this
//    station. Nothing in this codebase currently orders operations by it
//    (check-in and weigh-in are each guarded by their own state machine /
//    unique index, so replay order doesn't matter for correctness — see
//    offlineQueue.ts's module doc comment), but it's recorded on every
//    queued write so the audit trail can always answer "in what order did
//    THIS station originate its writes", which wall-clock timestamps from an
//    unreliable clock cannot.
//
// localStorage (not IndexedDB) is deliberate here: this is a handful of
// small, synchronously-read values, not a queryable store.

const STATION_ID_KEY = 'sensei-arena-station-id'
const CLIENT_SEQ_KEY = 'sensei-arena-station-seq'

export function getStationId(): string {
  if (typeof window === 'undefined') return 'server'
  let id = window.localStorage.getItem(STATION_ID_KEY)
  if (!id) {
    id = crypto.randomUUID()
    window.localStorage.setItem(STATION_ID_KEY, id)
  }
  return id
}

// Returns the NEXT sequence number for this station (starts at 1) and
// persists it — always increasing, even across reloads/restarts of this
// same browser profile.
export function nextClientSeq(): number {
  if (typeof window === 'undefined') return 0
  const current = Number.parseInt(window.localStorage.getItem(CLIENT_SEQ_KEY) ?? '0', 10)
  const next = (Number.isFinite(current) ? current : 0) + 1
  window.localStorage.setItem(CLIENT_SEQ_KEY, String(next))
  return next
}
