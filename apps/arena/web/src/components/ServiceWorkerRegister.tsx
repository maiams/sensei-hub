'use client'

import { useEffect } from 'react'

// Registers the Serwist-built service worker (public/sw.js). In dev the file
// doesn't exist (disabled in next.config.ts) — registration simply fails
// silently, which is fine, dev already has hot reload.
export function ServiceWorkerRegister() {
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return
    navigator.serviceWorker.register('/sw.js').catch(() => {
      // No SW in this build (dev) or registration genuinely failed — either
      // way the app must keep working online without it.
    })
  }, [])

  return null
}
