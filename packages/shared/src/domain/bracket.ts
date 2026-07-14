import { z } from 'zod'

export const EliminationSize = z.union([
  z.literal(8), z.literal(16), z.literal(32), z.literal(64), z.literal(128),
])
export type EliminationSize = z.infer<typeof EliminationSize>

export const RoundRobinSize = z.union([
  z.literal(3), z.literal(4), z.literal(5), z.literal(6),
])
export type RoundRobinSize = z.infer<typeof RoundRobinSize>

export const RepechageType = z.enum(['none', 'simple', 'quarterFinal', 'semiFinal', 'finalist'])
export type RepechageType = z.infer<typeof RepechageType>

export const MatchPhase = z.enum(['R1', 'R2', 'QF', 'SF', 'F', 'Bronze', 'Rep'])
export type MatchPhase = z.infer<typeof MatchPhase>

export const MatchState = z.enum(['pending', 'ready', 'in_progress', 'completed', 'bye', 'walkover'])
export type MatchState = z.infer<typeof MatchState>

// Discriminated union prevents invalid combinations like roundRobin + size 128 + repechageType
export const EliminationBracketConfig = z.object({
  format: z.literal('elimination'),
  size: EliminationSize,
  repechageType: RepechageType,
})
export type EliminationBracketConfig = z.infer<typeof EliminationBracketConfig>

export const RoundRobinBracketConfig = z.object({
  format: z.literal('roundRobin'),
  size: RoundRobinSize,
})
export type RoundRobinBracketConfig = z.infer<typeof RoundRobinBracketConfig>

export const BracketConfig = z.discriminatedUnion('format', [
  EliminationBracketConfig,
  RoundRobinBracketConfig,
])
export type BracketConfig = z.infer<typeof BracketConfig>

export const BracketAthleteSlot = z.object({
  position: z.number().int().positive(),
  athleteId: z.string().nullable(),
  seed: z.number().int().nonnegative(),
  bye: z.boolean(),
})
export type BracketAthleteSlot = z.infer<typeof BracketAthleteSlot>

export const BracketSchema = z.object({
  _id: z.string(),
  divisionId: z.string(),
  config: BracketConfig,
  athletes: z.array(BracketAthleteSlot),
  generatedAt: z.string().datetime(),
  generatedBy: z.string(),
  version: z.number().int().nonnegative(),
})
export type Bracket = z.infer<typeof BracketSchema>

export const VictoryMethod = z.enum([
  'ippon', 'waza_ari', 'shido', 'hansoku_make', 'kiken_gachi', 'wo',
])
export type VictoryMethod = z.infer<typeof VictoryMethod>

export const MatchSchema = z.object({
  _id: z.string(),
  bracketId: z.string(),
  divisionId: z.string(),
  matchNumber: z.number().int().positive(),
  phase: MatchPhase,
  athleteAId: z.string().nullable(),
  athleteBId: z.string().nullable(),
  state: MatchState,
  winnerId: z.string().nullable(),
  victoryMethod: VictoryMethod.nullable(),
  durationSeconds: z.number().int().nonnegative().nullable(),
  nextMatchNumber: z.number().int().positive().nullable(),
  repNextMatchNumber: z.number().int().positive().nullable(),
  scheduledAt: z.string().datetime().optional(),
  completedAt: z.string().datetime().optional(),
  operatorId: z.string().optional(),
})
export type Match = z.infer<typeof MatchSchema>
