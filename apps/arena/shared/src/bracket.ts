import { z } from 'zod'

// Mirrors apps/arena/server/src/domain/bracket/types.ts (the Fase 3B pure
// engine) — see docs/status-e-plano.md, Fase 3B/3C. This file only adds the
// HTTP/persistence layer (Zod schemas for request bodies and stored
// documents); the engine's vocabulary (stage names, Portuguese repechage
// types, 'rodizio' spelling) is authoritative and kept as-is here rather than
// translated, so there is exactly one vocabulary across engine, DB and API.

export const BracketFormat = z.enum(['elimination', 'rodizio'])
export type BracketFormat = z.infer<typeof BracketFormat>

export const RepechageType = z.enum(['nenhuma', 'simples', 'normal', 'dupla', 'finalistas'])
export type RepechageType = z.infer<typeof RepechageType>

export const BracketSize = z.union([z.literal(8), z.literal(16), z.literal(32), z.literal(64), z.literal(128)])
export type BracketSize = z.infer<typeof BracketSize>

export const MatchStage = z.enum(['round', 'bronze', 'repechage', 'repechage_round2'])
export type MatchStage = z.infer<typeof MatchStage>

export const AthleteSlotSchema = z.object({
  athleteId: z.string(),
  seed: z.number().int().positive().nullable(),
  clubId: z.string().nullable(),
})
export type AthleteSlotDTO = z.infer<typeof AthleteSlotSchema>

// POST /api/events/:id/divisions/:did/bracket
// Generates from every EventEntry currently 'confirmed' into this division
// (matching confirmedDivisionId ?? divisionId). No seeding UI yet — every
// athlete enters as unseeded (seed: null) and the draw order is decided
// deterministically by `seed`, same as an unseeded athlete anywhere else in
// the engine.
export const GenerateBracketInput = z.object({
  format: BracketFormat,
  repechageType: RepechageType.optional(), // elimination only, defaults to 'nenhuma'
  seed: z.number().int().optional(), // omit = a fresh seed is generated and persisted
  force: z.boolean().optional(), // regenerate over an existing active bracket, archiving it
})
export type GenerateBracketInput = z.infer<typeof GenerateBracketInput>

export const BracketSchema = z.object({
  id: z.string(),
  eventId: z.string(),
  divisionId: z.string(),
  format: BracketFormat,
  size: BracketSize.optional(),
  repechageType: RepechageType.optional(),
  seed: z.number().int(),
  slots: z.array(AthleteSlotSchema),
  status: z.enum(['active', 'archived']),
  version: z.number().int().positive(),
  generatedBy: z.string(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
})
export type Bracket = z.infer<typeof BracketSchema>

export const MatchResultSchema = z.object({
  winnerId: z.string(),
  isWalkover: z.boolean(),
  method: z.string().optional(),
  points: z.number().optional(),
})
export type MatchResult = z.infer<typeof MatchResultSchema>

export const MatchSchema = z.object({
  id: z.string(),
  bracketId: z.string(),
  matchNumber: z.number().int().positive(),
  round: z.number().int().positive(),
  stage: MatchStage,
  athleteAId: z.string().nullable(),
  athleteBId: z.string().nullable(),
  byeAthleteId: z.string().nullable(),
  nextMatchNumber: z.number().int().positive().nullable(),
  nextMatchSlot: z.enum(['A', 'B']).nullable(),
  loserNextMatchNumber: z.number().int().positive().nullable(),
  loserNextMatchSlot: z.enum(['A', 'B']).nullable(),
  groupMatchNumber: z.number().int().positive().nullable(),
  result: MatchResultSchema.nullable(),
})
export type Match = z.infer<typeof MatchSchema>

// POST /api/events/:id/divisions/:did/matches/:mid/result
export const RecordMatchResultInput = z.object({
  winnerId: z.string(),
  isWalkover: z.boolean().optional().default(false),
  method: z.string().max(60).optional(),
  points: z.number().nonnegative().optional(),
})
export type RecordMatchResultInput = z.infer<typeof RecordMatchResultInput>

// POST /api/events/:id/divisions/:did/matches/:mid/correct
// Only allowed while the match's old result hasn't propagated anywhere else
// yet (the winner/loser don't appear in any other match of the bracket) —
// same "terminal, no cascading undo" philosophy as EventEntry's disqualified/
// withdrawn statuses. Once the bracket has moved on, fixing a mistake means
// correcting the affected downstream matches directly instead.
export const CorrectMatchResultInput = RecordMatchResultInput.extend({
  reason: z.string().min(1).max(500),
})
export type CorrectMatchResultInput = z.infer<typeof CorrectMatchResultInput>

export const AthleteRankingSchema = z.object({
  athleteId: z.string(),
  place: z.number().int().positive(),
})
export type AthleteRanking = z.infer<typeof AthleteRankingSchema>
