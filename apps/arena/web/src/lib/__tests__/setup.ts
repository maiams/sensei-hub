// Global vitest setup for @arena/web's lib tests (see vitest.config.ts).
//
// jsdom (the configured test environment) gives us `window`, which
// station.ts and offlineQueue.ts both branch on — but it does NOT implement
// IndexedDB. We assign a brand-new fake-indexeddb factory as the bare
// `indexedDB`/`IDBKeyRange` globals before every test, so:
//   - offlineQueue.ts's `openDB(...)` (from the `idb` package) has a real
//     IndexedDB-shaped backing store to talk to.
//   - each test starts with an empty store — no queued write from one test
//     can leak into the next.
//
// Assigned on both `globalThis` and `window` explicitly (rather than relying
// on fake-indexeddb/auto's own global-detection) because vitest's jsdom
// environment does not guarantee a live two-way bridge between the two for
// properties added after setup.
//
// localStorage needs its own workaround: recent jsdom versions moved
// `localStorage`/`sessionStorage` off the window instance and onto the
// shared window PROTOTYPE (a memory optimization). Vitest's jsdom
// environment (as of 3.2.x) copies globals by reading the window instance's
// OWN property names, so it never picks up prototype-level accessors — on a
// Node version that also ships its own experimental global `localStorage`
// (gated behind --localstorage-file), `window.localStorage` in a test
// silently resolves to that broken stand-in instead of jsdom's real,
// working Storage implementation. Reaching into `globalThis.jsdom.window`
// (the actual jsdom Window instance vitest stashes there) gets the real one.
import { beforeEach } from 'vitest'
import * as fakeIndexedDB from 'fake-indexeddb'

const { IDBFactory } = fakeIndexedDB
// idb's `wrap()` does `value instanceof IDBRequest` (and IDBCursor,
// IDBTransaction, ...) to decide how to promisify a raw IndexedDB result —
// so every one of these constructors needs to be the SAME classes
// fake-indexeddb's own IDBFactory produces, installed as real globals, not
// just `indexedDB` and `IDBKeyRange`.
const INDEXEDDB_GLOBALS = [
  'IDBCursor',
  'IDBCursorWithValue',
  'IDBDatabase',
  'IDBFactory',
  'IDBIndex',
  'IDBKeyRange',
  'IDBObjectStore',
  'IDBOpenDBRequest',
  'IDBRequest',
  'IDBTransaction',
  'IDBVersionChangeEvent',
] as const

beforeEach(() => {
  const factory = new IDBFactory()
  Object.defineProperty(globalThis, 'indexedDB', { value: factory, configurable: true, writable: true })
  for (const name of INDEXEDDB_GLOBALS) {
    Object.defineProperty(globalThis, name, { value: fakeIndexedDB[name], configurable: true, writable: true })
    if (typeof window !== 'undefined') {
      Object.defineProperty(window, name, { value: fakeIndexedDB[name], configurable: true, writable: true })
    }
  }
  if (typeof window !== 'undefined') {
    Object.defineProperty(window, 'indexedDB', { value: factory, configurable: true, writable: true })
  }

  const realWindow = (globalThis as unknown as { jsdom?: { window?: Window } }).jsdom?.window
  const realLocalStorage = realWindow?.localStorage
  if (!realLocalStorage) {
    throw new Error(
      'jsdom real window/localStorage not found at globalThis.jsdom.window — vitest internals likely changed; revisit this workaround.',
    )
  }
  Object.defineProperty(globalThis, 'localStorage', { value: realLocalStorage, configurable: true, writable: true })
  Object.defineProperty(window, 'localStorage', { value: realLocalStorage, configurable: true, writable: true })
  realLocalStorage.clear()
})
