'use client'

import { useEffect, useState } from 'react'

// Small shared hook — used by SyncStatusBadge (global indicator) and any
// screen that needs to react to connectivity itself, e.g. the scoreboard
// operator page warning that live scoring needs a real connection (it runs
// over WebSocket, which Fase 6's offline queue deliberately does not cover).
export function useOnlineStatus(): boolean {
  const [online, setOnline] = useState(true)

  useEffect(() => {
    setOnline(navigator.onLine)
    const handleOnline = () => setOnline(true)
    const handleOffline = () => setOnline(false)
    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)
    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [])

  return online
}
