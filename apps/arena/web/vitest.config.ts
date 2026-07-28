import { defineConfig } from 'vitest/config'

// Scope is deliberately narrow: this project only tests plain TS modules
// under src/lib (offline queue, station identity, athlete identity cascade)
// — not React components/pages. Those are still validated manually per
// CLAUDE.md's UI guidance; this config exists specifically to close the gap
// called out for the offline-queue/client-identity logic, which previously
// had zero automated coverage.
//
// environment: 'jsdom' — offlineQueue.ts and station.ts both branch on
// `typeof window === 'undefined'` and use `window.localStorage`, so a DOM
// global is required. jsdom (not happy-dom) was chosen because it's the
// long-established, most compatible choice for pairing with fake-indexeddb
// below; nothing here depends on jsdom-specific behavior beyond window/
// localStorage/crypto, so either would technically work.
//
// fake-indexeddb (setup file) — jsdom does not implement IndexedDB. The
// offline queue's entire job is persisting writes in IndexedDB across
// reloads, so an in-memory fake that behaves like the real API (same async
// request/event semantics) is the only way to exercise it without a real
// browser. Both are dev-only, follow the same vitest family already used by
// @arena/server, and add no runtime weight.
export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: false,
    setupFiles: ['./src/lib/__tests__/setup.ts'],
  },
})
