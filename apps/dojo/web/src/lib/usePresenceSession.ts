'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { getCurrentRole, isLoggedIn } from './api'
import type { PresenceRole } from './presence'

export function usePresenceSession(): { role: PresenceRole | null; ready: boolean } {
  const router = useRouter()
  const [role, setRole] = useState<PresenceRole | null>(null)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    if (!isLoggedIn()) {
      router.replace('/login')
      return
    }
    setRole(getCurrentRole())
    setReady(true)
  }, [router])

  return { role, ready }
}

export function useNetworkStatus(): boolean {
  const [online, setOnline] = useState(true)
  useEffect(() => {
    const update = () => setOnline(navigator.onLine)
    update()
    window.addEventListener('online', update)
    window.addEventListener('offline', update)
    return () => {
      window.removeEventListener('online', update)
      window.removeEventListener('offline', update)
    }
  }, [])
  return online
}
