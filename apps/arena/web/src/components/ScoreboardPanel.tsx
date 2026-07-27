'use client'

// Operator panel for one live match (Fase 4B). Every action is a REST call
// that returns the fresh scoreboard DTO — the operator's own screen is driven
// by responses, while the public display follows via WebSocket. The clock is
// authoritative on the server (clockMs + lastStartedAt); here we only *render*
// it ticking.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { hasMinRole, type UserRole } from '@sensei-hub/shared'
import { apiFetch, ApiError, getCurrentRole } from '../lib/api'
import { translateApiError } from '../lib/labels'

export interface ScoreboardDTO {
  id: string
  matchNumber: number
  divisionName: string
  phase: 'regular' | 'golden_score'
  status: 'active' | 'completed' | 'aborted'
  matchRules: {
    matchDurationSeconds: number
    goldenScoreEnabled: boolean
    goldenScoreDurationSeconds: number | null
    osaekomiYukoSeconds: number
    osaekomiWazaariSeconds: number
    osaekomiIpponSeconds: number
  }
  clock: { clockMs: number; running: boolean; lastStartedAt: string | null; countsUp: boolean }
  osaekomi: { holder: 'A' | 'B'; startedAt: string } | null
  sides: { A: SideDTO; B: SideDTO }
  winner: { athleteId: string; method: string } | null
}

interface SideDTO {
  athleteId: string
  displayName: string
  clubName: string | null
  // Short label ("Federação 12345", "CPF ***.***.***-01", "nasc. 2012")
  // resolved server-side — see resolveAthleteIdentity in @arena/shared — to
  // tell apart two competitors with the same/similar name. Always null on
  // the PUBLIC payload (ScoreboardService#toDTO) — this display page must
  // never render it: it's for the mesário, not the public screen.
  identity: string | null
  ippon: number
  wazaari: number
  yuko: number
  shido: number
  hansokuMake: boolean
}

export function displayClockMs(clock: ScoreboardDTO['clock'], now: number): number {
  if (!clock.running || !clock.lastStartedAt) return clock.clockMs
  const elapsed = now - new Date(clock.lastStartedAt).getTime()
  return clock.countsUp ? clock.clockMs + elapsed : Math.max(0, clock.clockMs - elapsed)
}

export function formatClock(ms: number): string {
  const total = Math.ceil(ms / 1000)
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

const METHOD_OPTIONS = [
  { value: 'ippon', label: 'Ippon' },
  { value: 'wazaari', label: 'Waza-ari' },
  { value: 'yuko', label: 'Yuko' },
  { value: 'hansoku-make', label: 'Hansoku-make' },
  { value: 'decisao', label: 'Decisão' },
  { value: 'desistencia', label: 'Desistência' },
  { value: 'wo', label: 'W.O.' },
]

const SCORE_TYPES: Array<{ type: 'ippon' | 'wazaari' | 'yuko' | 'shido'; label: string }> = [
  { type: 'ippon', label: 'Ippon' },
  { type: 'wazaari', label: 'Waza-ari' },
  { type: 'yuko', label: 'Yuko' },
  { type: 'shido', label: 'Shido' },
]

export function ScoreboardPanel({
  initial,
  onFinished,
}: {
  initial: ScoreboardDTO
  onFinished: () => void
}) {
  const [sb, setSb] = useState<ScoreboardDTO>(initial)
  const [now, setNow] = useState(() => Date.now())
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [winnerSide, setWinnerSide] = useState<'A' | 'B' | null>(null)
  const [winnerMethod, setWinnerMethod] = useState('ippon')
  // O mesário (scoreboard_operator) não cancela mais luta — depois de
  // iniciada, só resta declarar o vencedor. Abortar (luta com atletas
  // errados etc.) fica restrito a event_manager+; a checagem real é no
  // servidor (POST /scoreboards/:sid/abort exige o papel), isto aqui só
  // evita mostrar um botão que a API vai recusar.
  const [canAbort, setCanAbort] = useState(false)
  const busyRef = useRef(false)

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 100)
    return () => clearInterval(t)
  }, [])

  useEffect(() => {
    const role = getCurrentRole()
    setCanAbort(role !== null && hasMinRole(role as UserRole, 'event_manager'))
  }, [])

  const action = useCallback(
    async (path: string, body?: Record<string, unknown>) => {
      if (busyRef.current) return null
      busyRef.current = true
      setBusy(true)
      setError(null)
      try {
        const result = await apiFetch<ScoreboardDTO | { scoreboard: ScoreboardDTO; award: string | null }>(
          `/scoreboards/${sb.id}/${path}`,
          { method: 'POST', ...(body !== undefined ? { body: JSON.stringify(body) } : {}) },
        )
        const dto = 'scoreboard' in result ? result.scoreboard : result
        setSb(dto)
        return result
      } catch (err) {
        setError(err instanceof ApiError ? translateApiError(err.message) : 'Falha na ação — tente novamente.')
        return null
      } finally {
        busyRef.current = false
        setBusy(false)
      }
    },
    [sb.id],
  )

  const clockMs = displayClockMs(sb.clock, now)
  const timeUp = !sb.clock.countsUp && clockMs === 0
  const osaekomiSeconds = sb.osaekomi ? Math.floor((now - new Date(sb.osaekomi.startedAt).getTime()) / 1000) : null

  const decisive =
    sb.sides.A.ippon === 1 || sb.sides.B.ippon === 1 || sb.sides.A.hansokuMake || sb.sides.B.hansokuMake
  const tied =
    sb.sides.A.ippon === sb.sides.B.ippon &&
    sb.sides.A.wazaari === sb.sides.B.wazaari &&
    sb.sides.A.yuko === sb.sides.B.yuko &&
    sb.sides.A.hansokuMake === sb.sides.B.hansokuMake
  const canGoldenScore = sb.phase === 'regular' && sb.matchRules.goldenScoreEnabled && tied && timeUp

  const suggestedWinner = useMemo((): { side: 'A' | 'B'; method: string } | null => {
    const a = sb.sides.A
    const b = sb.sides.B
    if (a.hansokuMake !== b.hansokuMake) return { side: a.hansokuMake ? 'B' : 'A', method: 'hansoku-make' }
    if (a.ippon !== b.ippon) return { side: a.ippon > b.ippon ? 'A' : 'B', method: 'ippon' }
    if (a.wazaari !== b.wazaari) return { side: a.wazaari > b.wazaari ? 'A' : 'B', method: 'wazaari' }
    if (a.yuko !== b.yuko) return { side: a.yuko > b.yuko ? 'A' : 'B', method: 'yuko' }
    return null
  }, [sb.sides])

  function openWinnerForm() {
    setWinnerSide(suggestedWinner?.side ?? 'A')
    setWinnerMethod(suggestedWinner?.method ?? 'decisao')
  }

  async function handleRemoveScore(side: 'A' | 'B', type: string) {
    const reason = window.prompt(`Motivo da correção (remover ${type} de ${sb.sides[side].displayName}):`)
    if (!reason || reason.trim().length < 3) return
    await action('score/remove', { side, type, reason })
  }

  async function handleSetClock() {
    const input = window.prompt('Novo tempo (m:ss):', formatClock(clockMs))
    if (!input) return
    const m = input.match(/^(\d+):([0-5]\d)$/)
    if (!m) {
      setError('Formato inválido — use m:ss (ex: 2:30).')
      return
    }
    const reason = window.prompt('Motivo do ajuste do relógio:')
    if (!reason || reason.trim().length < 3) return
    const newMs = (Number(m[1]) * 60 + Number(m[2])) * 1000
    await action('clock/set', { clockMs: newMs, reason })
  }

  async function handleAbort() {
    const reason = window.prompt('Motivo para cancelar esta luta (ela volta para a fila):')
    if (!reason || reason.trim().length < 3) return
    const result = await action('abort', { reason })
    if (result) onFinished()
  }

  async function handleDeclareWinner() {
    if (!winnerSide) return
    const result = await action('winner', { winnerId: sb.sides[winnerSide].athleteId, method: winnerMethod })
    if (result) setWinnerSide(null)
  }

  if (sb.status === 'completed') {
    const winnerName =
      sb.winner && sb.sides.A.athleteId === sb.winner.athleteId
        ? sb.sides.A.displayName
        : sb.sides.B.displayName
    return (
      <div className="rounded-lg border border-emerald-800 bg-emerald-950/40 p-6 text-center">
        <p className="text-sm uppercase tracking-wide text-emerald-400">Vencedor</p>
        <p className="mt-1 text-2xl font-bold text-white">{winnerName}</p>
        <p className="mt-1 text-sm text-emerald-300">{sb.winner?.method}</p>
        <button
          type="button"
          onClick={onFinished}
          className="mt-4 rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-blue-500"
        >
          Buscar próxima luta
        </button>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-baseline justify-between">
        <p className="text-xs uppercase tracking-wide text-blue-300">
          {sb.divisionName} — luta #{sb.matchNumber}
        </p>
        {sb.phase === 'golden_score' && (
          <span className="rounded-full bg-amber-900/60 px-3 py-0.5 text-xs font-bold text-amber-300">
            GOLDEN SCORE
          </span>
        )}
      </div>

      {/* clock */}
      <div className="rounded-lg border border-slate-800 bg-slate-950 p-4 text-center">
        <p
          className={`font-mono text-6xl font-bold tabular-nums ${
            timeUp && sb.phase === 'regular' ? 'text-red-400' : 'text-white'
          }`}
        >
          {formatClock(clockMs)}
        </p>
        {timeUp && sb.phase === 'regular' && !decisive && (
          <p className="mt-1 text-xs text-red-300">Tempo esgotado</p>
        )}
        <div className="mt-3 flex flex-wrap justify-center gap-2">
          {sb.clock.running ? (
            <button
              type="button"
              onClick={() => action('clock/pause')}
              disabled={busy}
              className="rounded-lg bg-amber-600 px-6 py-3 text-lg font-bold text-white hover:bg-amber-500 disabled:opacity-60"
            >
              Pausar
            </button>
          ) : (
            <button
              type="button"
              onClick={() => action('clock/start')}
              disabled={busy || decisive}
              className="rounded-lg bg-emerald-600 px-6 py-3 text-lg font-bold text-white hover:bg-emerald-500 disabled:opacity-60"
            >
              Iniciar tempo
            </button>
          )}
          {canGoldenScore && (
            <button
              type="button"
              onClick={() => action('golden-score')}
              disabled={busy}
              className="rounded-lg bg-amber-700 px-6 py-3 text-lg font-bold text-white hover:bg-amber-600 disabled:opacity-60"
            >
              Golden Score
            </button>
          )}
          <button
            type="button"
            onClick={handleSetClock}
            disabled={busy}
            className="rounded-lg border border-slate-700 px-4 py-3 text-sm text-slate-300 hover:bg-slate-800 disabled:opacity-60"
          >
            Ajustar relógio
          </button>
        </div>
      </div>

      {/* osaekomi */}
      <div className="rounded-lg border border-slate-800 bg-slate-950 p-4">
        {sb.osaekomi ? (
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-xs uppercase tracking-wide text-purple-300">
                Osaekomi — {sb.sides[sb.osaekomi.holder].displayName}
              </p>
              <p className="font-mono text-4xl font-bold text-purple-200 tabular-nums">{osaekomiSeconds}s</p>
            </div>
            <button
              type="button"
              onClick={() => action('osaekomi/stop')}
              disabled={busy}
              className="rounded-lg bg-purple-600 px-6 py-4 text-lg font-bold text-white hover:bg-purple-500 disabled:opacity-60"
            >
              Toketa / Parar
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <p className="mr-2 text-xs uppercase tracking-wide text-slate-500">Osaekomi:</p>
            {(['A', 'B'] as const).map((side) => (
              <button
                key={side}
                type="button"
                onClick={() => action('osaekomi/start', { holder: side })}
                disabled={busy || decisive}
                className="rounded-lg border border-purple-800 px-4 py-2 text-sm font-semibold text-purple-300 hover:bg-purple-950 disabled:opacity-60"
              >
                {sb.sides[side].displayName}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* score panels */}
      <div className="grid gap-3 sm:grid-cols-2">
        {(['A', 'B'] as const).map((sideKey) => {
          const side = sb.sides[sideKey]
          const isWhite = sideKey === 'A'
          return (
            <div
              key={sideKey}
              className={`rounded-lg border p-4 ${
                isWhite ? 'border-slate-500 bg-slate-100 text-slate-950' : 'border-blue-700 bg-blue-950 text-white'
              }`}
            >
              <p className="truncate text-lg font-bold">{side.displayName}</p>
              {(side.clubName || side.identity) && (
                <p className={`truncate text-xs ${isWhite ? 'text-slate-600' : 'text-blue-300'}`}>
                  {side.clubName}
                  {side.clubName && side.identity && ' · '}
                  {side.identity}
                </p>
              )}

              <div className="mt-2 flex items-end gap-4 font-mono text-3xl font-bold tabular-nums">
                <span title="Ippon">{side.ippon}</span>
                <span title="Waza-ari">{side.wazaari}</span>
                <span title="Yuko">{side.yuko}</span>
                <span
                  className="ml-auto flex items-center gap-1"
                  title="Shido"
                  aria-label={`${side.shido} ${side.shido === 1 ? 'shido' : 'shidos'}`}
                >
                  {Array.from({ length: side.shido }).map((_, i) => (
                    <span key={i} className="inline-block h-3 w-3 rounded-full bg-red-500" aria-hidden="true" />
                  ))}
                </span>
              </div>
              <p className={`text-[10px] uppercase tracking-wide ${isWhite ? 'text-slate-500' : 'text-blue-400'}`}>
                I&nbsp;&nbsp;&nbsp;W&nbsp;&nbsp;&nbsp;Y{side.hansokuMake ? ' — HANSOKU-MAKE' : ''}
              </p>

              <div className="mt-3 grid grid-cols-2 gap-1.5">
                {SCORE_TYPES.map(({ type, label }) => (
                  <div key={type} className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => action('score', { side: sideKey, type })}
                      disabled={busy || decisive}
                      className={`flex-1 rounded-lg px-2 py-2.5 text-sm font-semibold disabled:opacity-50 ${
                        type === 'shido'
                          ? 'bg-red-700 text-white hover:bg-red-600'
                          : isWhite
                            ? 'bg-slate-800 text-white hover:bg-slate-700'
                            : 'bg-blue-700 text-white hover:bg-blue-600'
                      }`}
                    >
                      {label}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleRemoveScore(sideKey, type)}
                      disabled={busy}
                      aria-label={`Corrigir ${label}`}
                      title={`Remover ${label} (correção com motivo)`}
                      className={`rounded-lg px-2 py-2.5 text-sm disabled:opacity-50 ${
                        isWhite ? 'border border-slate-400 text-slate-700' : 'border border-blue-700 text-blue-300'
                      }`}
                    >
                      −
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )
        })}
      </div>

      {error && <p className="text-sm text-red-400">{error}</p>}

      {/* winner declaration */}
      {winnerSide === null ? (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={openWinnerForm}
            disabled={busy}
            className="rounded-lg bg-emerald-700 px-5 py-3 text-base font-bold text-white hover:bg-emerald-600 disabled:opacity-60"
          >
            Declarar vencedor
          </button>
          {canAbort && (
            <button
              type="button"
              onClick={handleAbort}
              disabled={busy}
              title="Uso excepcional: atletas errados na mesa, etc. Não é uma opção do mesário."
              className="ml-auto rounded-lg border border-red-900 px-4 py-3 text-sm text-red-400 hover:bg-red-950 disabled:opacity-60"
            >
              Cancelar luta (atletas errados)
            </button>
          )}
        </div>
      ) : (
        <div className="rounded-lg border border-emerald-800 bg-emerald-950/30 p-4">
          <p className="mb-2 text-sm font-semibold text-emerald-300">Confirmar vencedor:</p>
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={winnerSide}
              onChange={(e) => setWinnerSide(e.target.value as 'A' | 'B')}
              className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-2.5 text-sm text-white"
            >
              <option value="A">{sb.sides.A.displayName}</option>
              <option value="B">{sb.sides.B.displayName}</option>
            </select>
            <select
              value={winnerMethod}
              onChange={(e) => setWinnerMethod(e.target.value)}
              className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-2.5 text-sm text-white"
            >
              {METHOD_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={handleDeclareWinner}
              disabled={busy}
              className="rounded-lg bg-emerald-600 px-5 py-2.5 text-sm font-bold text-white hover:bg-emerald-500 disabled:opacity-60"
            >
              Confirmar vencedor
            </button>
            <button
              type="button"
              onClick={() => setWinnerSide(null)}
              className="rounded-lg border border-slate-700 px-3 py-2.5 text-sm text-slate-300 hover:bg-slate-800"
            >
              Voltar
            </button>
          </div>
          <p className="mt-3 text-sm text-emerald-200">
            <strong>{sb.sides[winnerSide].displayName}</strong> vence por{' '}
            <strong>{METHOD_OPTIONS.find((o) => o.value === winnerMethod)?.label ?? winnerMethod}</strong>.
            Esta ação encerra a luta e não pode ser desfeita.
          </p>
          {suggestedWinner && (
            <p className="mt-2 text-xs text-slate-400">
              Sugestão do placar: {sb.sides[suggestedWinner.side].displayName} por {suggestedWinner.method}.
            </p>
          )}
        </div>
      )}
    </div>
  )
}
