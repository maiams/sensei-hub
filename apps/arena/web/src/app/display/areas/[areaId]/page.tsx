'use client'

// PUBLIC scoreboard display for one area — the gym TV. No auth, no controls
// (the operator screen is /events/[id]/operate). Follows the live fight over
// WebSocket straight to the API (Next's rewrite doesn't proxy upgrades), and
// falls back to polling the public GET if the socket drops — gym WiFi is
// assumed to be bad (CLAUDE.md: resilience first).
//
// Names in this payload are already privacy-filtered server-side
// (Event.publicHideNamesUnderAge) — this page never sees full minor names.

import { useEffect, useRef, useState } from 'react'
import { useParams } from 'next/navigation'
import { displayClockMs, formatClock, type ScoreboardDTO } from '../../../../components/ScoreboardPanel'

function wsUrl(areaId: string): string {
  const proto = window.location.protocol === 'https:' ? 'wss' : 'ws'
  return `${proto}://${window.location.hostname}:3001/api/public/areas/${areaId}/ws`
}

export default function PublicScoreboardPage() {
  const params = useParams<{ areaId: string }>()
  const areaId = params.areaId

  const [sb, setSb] = useState<ScoreboardDTO | null>(null)
  const [now, setNow] = useState(() => Date.now())
  const [live, setLive] = useState(false)
  const wsRef = useRef<WebSocket | null>(null)

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 100)
    return () => clearInterval(t)
  }, [])

  // WebSocket with automatic reconnect + polling fallback while disconnected.
  useEffect(() => {
    let closed = false
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null
    let pollTimer: ReturnType<typeof setInterval> | null = null

    async function poll() {
      try {
        const res = await fetch(`/api/public/areas/${areaId}/scoreboard`)
        if (res.ok) {
          const data = (await res.json()) as { scoreboard: ScoreboardDTO | null }
          if (data.scoreboard) setSb(data.scoreboard)
        }
      } catch {
        // offline — keep the last known state on screen
      }
    }

    function connect() {
      if (closed) return
      try {
        const ws = new WebSocket(wsUrl(areaId))
        wsRef.current = ws
        ws.onopen = () => {
          setLive(true)
          if (pollTimer) {
            clearInterval(pollTimer)
            pollTimer = null
          }
        }
        ws.onmessage = (event) => {
          try {
            const msg = JSON.parse(event.data as string) as { type: string; scoreboard: ScoreboardDTO }
            if (msg.type === 'scoreboard') setSb(msg.scoreboard)
          } catch {
            // ignore malformed frames
          }
        }
        ws.onclose = () => {
          setLive(false)
          if (!closed) {
            if (!pollTimer) pollTimer = setInterval(poll, 3000)
            reconnectTimer = setTimeout(connect, 5000)
          }
        }
        ws.onerror = () => ws.close()
      } catch {
        if (!pollTimer) pollTimer = setInterval(poll, 3000)
        reconnectTimer = setTimeout(connect, 5000)
      }
    }

    void poll()
    connect()
    return () => {
      closed = true
      if (reconnectTimer) clearTimeout(reconnectTimer)
      if (pollTimer) clearInterval(pollTimer)
      wsRef.current?.close()
    }
  }, [areaId])

  if (!sb) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-black text-white">
        <p className="text-3xl text-slate-500">Aguardando luta…</p>
      </main>
    )
  }

  const clockMs = displayClockMs(sb.clock, now)
  const osaekomiSeconds = sb.osaekomi ? Math.floor((now - new Date(sb.osaekomi.startedAt).getTime()) / 1000) : null
  const winnerName =
    sb.winner === null ? null : sb.winner.athleteId === sb.sides.A.athleteId ? sb.sides.A.displayName : sb.sides.B.displayName

  return (
    <main className="flex min-h-screen flex-col bg-black text-white">
      {/* header */}
      <div className="flex items-center justify-between px-6 py-3 text-slate-400">
        <p className="truncate text-2xl">{sb.divisionName}</p>
        <p className="text-2xl tabular-nums">
          Luta #{sb.matchNumber}
          {sb.phase === 'golden_score' && <span className="ml-4 font-bold text-amber-400">GOLDEN SCORE</span>}
          {!live && <span className="ml-4 text-base text-slate-600">•</span>}
        </p>
      </div>

      {/* athletes */}
      <div className="flex flex-1 flex-col">
        <AthleteRow side={sb.sides.A} white />
        <AthleteRow side={sb.sides.B} white={false} />
      </div>

      {/* clock strip */}
      <div className="flex items-center justify-center gap-12 bg-slate-950 py-6">
        <p className={`font-mono text-[9rem] font-bold leading-none tabular-nums ${clockMs === 0 && !sb.clock.countsUp ? 'text-red-500' : 'text-white'}`}>
          {formatClock(clockMs)}
        </p>
        {osaekomiSeconds !== null && (
          <div className="text-center">
            <p className="text-2xl uppercase tracking-widest text-purple-300">Osaekomi</p>
            <p className="font-mono text-8xl font-bold text-purple-200 tabular-nums">{osaekomiSeconds}</p>
          </div>
        )}
      </div>

      {/* winner overlay */}
      {sb.status === 'completed' && winnerName && (
        <div className="fixed inset-0 flex flex-col items-center justify-center bg-black/85">
          <p className="text-3xl uppercase tracking-widest text-emerald-400">Vencedor</p>
          <p className="mt-4 max-w-[90vw] truncate text-7xl font-bold">{winnerName}</p>
          <p className="mt-3 text-4xl uppercase text-slate-300">{sb.winner?.method}</p>
        </div>
      )}
    </main>
  )
}

function AthleteRow({ side, white }: { side: ScoreboardDTO['sides']['A']; white: boolean }) {
  return (
    <div className={`flex flex-1 items-center justify-between px-8 ${white ? 'bg-white text-slate-950' : 'bg-blue-800 text-white'}`}>
      <div className="min-w-0">
        <p className="truncate text-6xl font-bold">{side.displayName}</p>
        {side.clubName && (
          <p className={`mt-1 truncate text-3xl ${white ? 'text-slate-500' : 'text-blue-200'}`}>{side.clubName}</p>
        )}
        {side.hansokuMake && <p className="mt-1 text-3xl font-bold text-red-500">HANSOKU-MAKE</p>}
      </div>
      <div className="flex shrink-0 items-center gap-10">
        <ScoreDigit label="I" value={side.ippon} white={white} />
        <ScoreDigit label="W" value={side.wazaari} white={white} />
        <ScoreDigit label="Y" value={side.yuko} white={white} />
        <div className="flex w-24 flex-wrap items-center gap-2">
          {Array.from({ length: side.shido }).map((_, i) => (
            <span key={i} className="inline-block h-8 w-8 rounded-full bg-red-600" />
          ))}
        </div>
      </div>
    </div>
  )
}

function ScoreDigit({ label, value, white }: { label: string; value: number; white: boolean }) {
  return (
    <div className="text-center">
      <p className={`text-2xl ${white ? 'text-slate-400' : 'text-blue-300'}`}>{label}</p>
      <p className="font-mono text-8xl font-bold leading-none tabular-nums">{value}</p>
    </div>
  )
}
