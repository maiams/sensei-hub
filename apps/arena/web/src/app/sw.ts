// Service worker (Fase 6 — PWA + Offline). Only active in production builds
// (see next.config.ts). Two jobs, deliberately kept separate:
//
// 1. Precache the app shell + Next.js static assets (via Serwist's default
//    Next.js runtime caching) so the UI itself loads offline.
// 2. Cache-Storage (NetworkFirst) for the small set of read-only API GETs
//    that make sense to browse with stale data when offline — athlete list
//    and event structure. This deliberately uses the browser's native Cache
//    Storage (what service workers are built for) rather than mirroring the
//    same data into IndexedDB by hand, a documented deviation from the
//    original Fase 6 plan sketch in docs/status-e-plano.md — see that doc
//    for the trade-off. IndexedDB (src/lib/offlineQueue.ts) is reserved for
//    what it's actually good at: the pending-writes outbox.
//
// Explicitly NOT cached: auth endpoints (never cache anything credential-
// adjacent), and anything under /api/public/*/ws (WebSocket — not a fetch
// target anyway). The scoreboard does not work offline by design (needs a
// live WebSocket) — the UI says so, this file doesn't need to.

import { defaultCache } from '@serwist/next/worker'
import { NetworkFirst, ExpirationPlugin, Serwist } from 'serwist'
import type { PrecacheEntry, SerwistGlobalConfig } from 'serwist'

declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined
  }
}

declare const self: ServiceWorkerGlobalScope

const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  // skipWaiting + clientsClaim: a new SW takes over immediately instead of
  // waiting for every open tab to close. This alone isn't enough to avoid a
  // stale/fossilized SW serving mismatched chunks — see the recovery layer
  // in ../../components/ServiceWorkerRegister.tsx and
  // docs/dev-service-worker-cache-recovery.md for the rest of the story.
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: true,
  runtimeCaching: [
    {
      // Read-only, safe-to-cache GETs: athlete lists, event/division/entry
      // structure. NetworkFirst — always tries the network first (fresh
      // data when online), falls back to the last cached response when the
      // request fails (offline / server unreachable).
      matcher: ({ url, request }) =>
        request.method === 'GET' &&
        url.pathname.startsWith('/api/') &&
        (url.pathname.startsWith('/api/athletes') ||
          /^\/api\/events(\/[^/]+)?(\/(divisions|entries|checkin))?$/.test(url.pathname)),
      handler: new NetworkFirst({
        cacheName: 'sensei-hub-api-read-cache',
        networkTimeoutSeconds: 4,
        plugins: [new ExpirationPlugin({ maxEntries: 200, maxAgeSeconds: 60 * 60 * 24 })],
      }),
    },
    ...defaultCache,
  ],
})

serwist.addEventListeners()
