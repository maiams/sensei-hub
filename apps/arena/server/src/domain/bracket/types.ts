// Pure bracket domain types — no I/O, no Mongoose. See docs/status-e-plano.md
// (Fase 3B) and docs/zempo-modelos/{chave-eliminacao,repescagem,rodizio}.md
// for the rules these types encode.

export type BracketFormat = 'elimination' | 'rodizio'

// The 5 repechage (second-chance) formats a judo elimination bracket can use.
// Only relevant when format === 'elimination'.
export type RepechageType = 'nenhuma' | 'simples' | 'normal' | 'dupla' | 'finalistas'

// Single-elimination brackets only come in powers of two.
export type BracketSize = 8 | 16 | 32 | 64 | 128
export const BRACKET_SIZES: readonly BracketSize[] = [8, 16, 32, 64, 128]

export interface AthleteSlot {
  athleteId: string
  // 1 = best seed. null = unseeded (drawn); unseeded athletes are placed
  // deterministically using config.seed, after all explicitly seeded ones.
  seed: number | null
  // Used for round-1 same-club separation. null = no club / unknown.
  clubId: string | null
}

export interface BracketConfig {
  format: BracketFormat
  // Elimination only. Omit to auto-select the smallest valid BracketSize
  // that fits the athlete count (minimum 8).
  size?: BracketSize
  // Elimination only. Defaults to 'nenhuma'.
  repechageType?: RepechageType
  // Seeds the deterministic PRNG used to place unseeded athletes and to
  // break tied rodizio rankings. Two calls with the same athletes + config
  // (including the same seed) always produce the same BracketState.
  seed?: number
}

export type MatchStage = 'round' | 'bronze' | 'repechage' | 'repechage_round2'

export interface MatchResultInput {
  matchNumber: number
  winnerId: string
  isWalkover: boolean
  // Free-form for now — Fase 4 (scoreboard) will encode real judo methods
  // (ippon, waza-ari, hansoku-make, decision...). Not validated here.
  method?: string
  // Rodízio only: the winner's technical points for this bout, used for the
  // "pontos acumulados" tie-break. The exact scoring table (ippon=10 etc.)
  // is a caller/event concern per docs/zempo-modelos/rodizio.md — the
  // engine just sums whatever it's given. Ignored by EliminationEngine.
  points?: number
}

export interface Match {
  matchNumber: number
  round: number
  stage: MatchStage
  athleteAId: string | null
  athleteBId: string | null
  // Set instead of playing the match when one side has no opponent.
  byeAthleteId: string | null
  // Where this match's winner advances to (null = terminal: final or a
  // repechage bout whose winner only feeds getFinalRankings, not another match).
  nextMatchNumber: number | null
  nextMatchSlot: 'A' | 'B' | null
  // Only set on semifinal matches when repechageType is 'simples' — the
  // bronze match's participants are fully known from bracket structure
  // alone (loser of SF1 vs loser of SF2), so it's wired at generate() time
  // and filled in by the same propagation as nextMatchNumber, just for the
  // loser instead of the winner.
  loserNextMatchNumber: number | null
  loserNextMatchSlot: 'A' | 'B' | null
  // For bronze/repechage-stage matches: the main-bracket match this bout is
  // tied to (its semifinal or final "parent") — used to avoid generating
  // the same repechage match twice and to explain the bout's purpose in the UI.
  groupMatchNumber: number | null
  result: { winnerId: string; isWalkover: boolean; method?: string; points?: number } | null
}

export interface BracketState {
  format: BracketFormat
  size?: BracketSize
  repechageType?: RepechageType
  seed: number
  matches: Match[]
  slots: AthleteSlot[]
}

export interface AthleteRanking {
  athleteId: string
  place: number // 1, 2, 3 (awarded to 2 athletes in judo — no single 4th), 5, 7...
}

export interface AdvanceResult {
  updatedMatches: Match[]
  newRepechageMatches: Match[]
}

export interface BracketEngine {
  generate(athletes: AthleteSlot[], config: BracketConfig): BracketState
  getReadyMatches(state: BracketState): Match[]
  advanceMatch(state: BracketState, result: MatchResultInput): AdvanceResult
  calculateRepechage(state: BracketState, type: RepechageType, completedRound: Match[]): Match[]
  getFinalRankings(state: BracketState): AthleteRanking[]
}

export class BracketEngineError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'BracketEngineError'
  }
}
