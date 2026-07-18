import { z } from 'zod'
import { MatchRules } from './divisionTemplate.js'

// Live scoreboard for one match (Fase 4B). Vocabulary follows CBJ RNC 2025:
// scores are ippon/waza-ari/yuko (yuko exists again in the 2025 rules),
// penalties are shido (3rd = hansoku-make), osaekomi converts to a score by
// held time, and golden score — when the division enables it — ends at the
// first score (osaekomi ends at yuko). The fight rules themselves come from
// `Division.matchRules`, snapshotted onto the scoreboard when the match
// starts so editing the division mid-event never mutates a fight in progress.

// Completion is expressed by `status` ('completed'/'aborted'), not by a phase.
export const ScoreboardPhase = z.enum(['regular', 'golden_score'])
export type ScoreboardPhase = z.infer<typeof ScoreboardPhase>

export const ScoreboardStatus = z.enum(['active', 'completed', 'aborted'])
export type ScoreboardStatus = z.infer<typeof ScoreboardStatus>

export const SideKey = z.enum(['A', 'B'])
export type SideKey = z.infer<typeof SideKey>

export const ScoreType = z.enum(['ippon', 'wazaari', 'yuko', 'shido'])
export type ScoreType = z.infer<typeof ScoreType>

// Suggested values for Match.result.method (free string in the bracket API).
export const VICTORY_METHODS = ['ippon', 'wazaari', 'yuko', 'hansoku-make', 'decisao', 'wo'] as const

export const SideScore = z.object({
  ippon: z.number().int().min(0).max(1),
  wazaari: z.number().int().min(0).max(2), // 2nd waza-ari = awasete-ippon (rules module sets ippon)
  yuko: z.number().int().min(0),
  shido: z.number().int().min(0).max(3),
  hansokuMake: z.boolean(), // true at the 3rd shido
})
export type SideScore = z.infer<typeof SideScore>

// The clock is authoritative on the server and rendered client-side:
// display = countsUp ? clockMs + elapsedSinceStart : max(0, clockMs - elapsedSinceStart).
// `clockMs` is the value as of `lastStartedAt` when running, or the frozen
// value when paused. Regular phase and limited golden score count down;
// unlimited golden score counts up from zero.
export const ScoreboardClock = z.object({
  clockMs: z.number().int().min(0),
  running: z.boolean(),
  lastStartedAt: z.string().datetime().nullable(),
  countsUp: z.boolean(),
})
export type ScoreboardClock = z.infer<typeof ScoreboardClock>

export const ScoreboardSideDTO = SideScore.extend({
  athleteId: z.string(),
  // Already privacy-filtered on public payloads (Event.publicHideNamesUnderAge).
  displayName: z.string(),
  clubName: z.string().nullable(),
})
export type ScoreboardSideDTO = z.infer<typeof ScoreboardSideDTO>

export const ScoreboardDTO = z.object({
  id: z.string(),
  eventId: z.string(),
  divisionId: z.string(),
  divisionName: z.string(),
  areaId: z.string(),
  matchId: z.string(),
  matchNumber: z.number().int().positive(),
  phase: ScoreboardPhase,
  status: ScoreboardStatus,
  matchRules: MatchRules,
  clock: ScoreboardClock,
  osaekomi: z.object({ holder: SideKey, startedAt: z.string().datetime() }).nullable(),
  sides: z.object({ A: ScoreboardSideDTO, B: ScoreboardSideDTO }),
  winner: z.object({ athleteId: z.string(), method: z.string() }).nullable(),
  updatedAt: z.string().datetime(),
})
export type ScoreboardDTO = z.infer<typeof ScoreboardDTO>

// ─── Route inputs ────────────────────────────────────────────────────────

// POST /api/events/:id/areas/:aid/scoreboard  { matchId } — start (or resume
// the active scoreboard of) the given dispatched match on this area.
export const StartScoreboardInput = z.object({ matchId: z.string() })
export type StartScoreboardInput = z.infer<typeof StartScoreboardInput>

export const AddScoreInput = z.object({ side: SideKey, type: ScoreType })
export type AddScoreInput = z.infer<typeof AddScoreInput>

export const RemoveScoreInput = z.object({ side: SideKey, type: ScoreType, reason: z.string().min(1).max(500) })
export type RemoveScoreInput = z.infer<typeof RemoveScoreInput>

export const SetClockInput = z.object({ clockMs: z.number().int().min(0), reason: z.string().min(1).max(500) })
export type SetClockInput = z.infer<typeof SetClockInput>

export const StartOsaekomiInput = z.object({ holder: SideKey })
export type StartOsaekomiInput = z.infer<typeof StartOsaekomiInput>

export const DeclareWinnerInput = z.object({ winnerId: z.string(), method: z.string().min(1).max(60) })
export type DeclareWinnerInput = z.infer<typeof DeclareWinnerInput>

export const AbortScoreboardInput = z.object({ reason: z.string().min(1).max(500) })
export type AbortScoreboardInput = z.infer<typeof AbortScoreboardInput>
