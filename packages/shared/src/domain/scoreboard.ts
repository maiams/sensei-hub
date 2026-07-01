import { z } from 'zod'

export const ScoreboardState = z.enum(['idle', 'running', 'osaekomi', 'paused', 'finished'])
export type ScoreboardState = z.infer<typeof ScoreboardState>

export const ScoreboardSchema = z.object({
  _id: z.string(),
  matchId: z.string(),
  divisionId: z.string(),
  state: ScoreboardState,

  // Timer (seconds elapsed)
  elapsedSeconds: z.number().int().nonnegative(),
  timerStartedAt: z.string().datetime().nullable(),

  // Osaekomi
  osaekomiAthleteId: z.string().nullable(),
  osaekomiStartedAt: z.string().datetime().nullable(),
  osaekomiSeconds: z.number().int().nonnegative(),

  // Scores
  athleteA: z.object({
    id: z.string().nullable(),
    name: z.string(),
    academyName: z.string(),
    wazaAri: z.number().int().min(0).max(2),
    shido: z.number().int().min(0).max(3),
    hansokuMake: z.boolean(),
  }),
  athleteB: z.object({
    id: z.string().nullable(),
    name: z.string(),
    academyName: z.string(),
    wazaAri: z.number().int().min(0).max(2),
    shido: z.number().int().min(0).max(3),
    hansokuMake: z.boolean(),
  }),

  winnerId: z.string().nullable(),
  updatedAt: z.string().datetime(),
})
export type Scoreboard = z.infer<typeof ScoreboardSchema>
