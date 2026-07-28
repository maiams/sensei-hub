'use client'

// Periodic "this station is alive" signal for the cluster management screen
// (Fase 8 — master/backup declarado, see apps/arena/web/src/app/settings/
// cluster/page.tsx). Reuses the SAME stable per-browser stationId the
// offline queue already tracks (lib/station.ts) — this is not a new device
// identity, just another consumer of the existing one.
//
// Deliberately fire-and-forget: a failed heartbeat (offline, or this node
// running standalone with no cluster at all) must never surface an error to
// the operator — it's a background signal, not a user-facing action. Runs
// on every authenticated page (mounted once in layout.tsx), not just
// station-specific screens, since any area notebook's browser tab counts as
// "this station is here" regardless of which screen is open.

import { useEffect } from 'react'
import { hasMinRole, type UserRole } from '@sensei-hub/shared'
import { apiFetch, getCurrentRole, isLoggedIn } from '../lib/api'
import { getStationId } from '../lib/station'

const HEARTBEAT_INTERVAL_MS = 20_000

export function StationHeartbeat() {
  useEffect(() => {
    function sendHeartbeat() {
      if (!isLoggedIn()) return
      const role = getCurrentRole()
      // Matches the server's own authorize('scoreboard_operator') gate on
      // POST /cluster/stations/heartbeat — skips a request that would only
      // ever 403 for athlete/guardian accounts.
      if (!role || !hasMinRole(role as UserRole, 'scoreboard_operator')) return
      apiFetch('/cluster/stations/heartbeat', {
        method: 'POST',
        body: JSON.stringify({ stationId: getStationId() }),
      }).catch(() => {
        // Silent — see module doc comment.
      })
    }

    sendHeartbeat()
    const interval = setInterval(sendHeartbeat, HEARTBEAT_INTERVAL_MS)
    return () => clearInterval(interval)
  }, [])

  return null
}
