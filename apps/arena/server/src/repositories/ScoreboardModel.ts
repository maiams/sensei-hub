import { Schema, model, type Types } from 'mongoose'
import type { MatchRules, ScoreboardPhase, ScoreboardStatus, SideKey } from '@arena/shared'
import { matchRulesSchemaDefinition } from './DivisionTemplateModel.js'

// Live scoreboard for one match. Athlete names (both the full one for the
// operator and the privacy-filtered public one) are denormalized here at
// start time so WebSocket broadcasts and public reads never join or leak —
// the public payload is built exclusively from `publicName`/`clubName`.
export interface ScoreboardSideSub {
  athleteId: Types.ObjectId
  fullName: string
  publicName: string // = fullName unless Event.publicHideNamesUnderAge applies
  clubName: string | null
  // Resolved via resolveAthleteIdentity at scoreboard creation time (see
  // ScoreboardService#newSide) — denormalized same as fullName/publicName,
  // operator-only (ScoreboardService#toDTO nulls it out on the public DTO).
  identity: string
  ippon: number
  wazaari: number
  yuko: number
  shido: number
  hansokuMake: boolean
}

export interface ScoreboardClockSub {
  clockMs: number
  running: boolean
  lastStartedAt: Date | null
  countsUp: boolean
}

export interface ScoreboardDocument {
  _id: Types.ObjectId
  eventId: Types.ObjectId
  divisionId: Types.ObjectId
  divisionName: string
  areaId: Types.ObjectId
  matchId: Types.ObjectId
  matchNumber: number
  phase: ScoreboardPhase
  status: ScoreboardStatus
  matchRules: MatchRules
  clock: ScoreboardClockSub
  osaekomi: { holder: SideKey; startedAt: Date } | null
  sides: { A: ScoreboardSideSub; B: ScoreboardSideSub }
  winner: { athleteId: Types.ObjectId; method: string } | null
  abortReason?: string
  createdBy: Types.ObjectId
  createdAt: Date
  updatedAt: Date
}

const sideSchema = new Schema<ScoreboardSideSub>(
  {
    athleteId: { type: Schema.Types.ObjectId, ref: 'Athlete', required: true },
    fullName: { type: String, required: true },
    publicName: { type: String, required: true },
    clubName: { type: String, default: null },
    identity: { type: String, required: true },
    ippon: { type: Number, required: true, default: 0 },
    wazaari: { type: Number, required: true, default: 0 },
    yuko: { type: Number, required: true, default: 0 },
    shido: { type: Number, required: true, default: 0 },
    hansokuMake: { type: Boolean, required: true, default: false },
  },
  { _id: false },
)

const scoreboardSchema = new Schema<ScoreboardDocument>(
  {
    eventId: { type: Schema.Types.ObjectId, ref: 'Event', required: true },
    divisionId: { type: Schema.Types.ObjectId, ref: 'Division', required: true },
    divisionName: { type: String, required: true },
    areaId: { type: Schema.Types.ObjectId, ref: 'Area', required: true },
    matchId: { type: Schema.Types.ObjectId, ref: 'Match', required: true },
    matchNumber: { type: Number, required: true },
    phase: { type: String, required: true, enum: ['regular', 'golden_score'], default: 'regular' },
    status: { type: String, required: true, enum: ['active', 'completed', 'aborted'], default: 'active' },
    matchRules: { type: new Schema(matchRulesSchemaDefinition, { _id: false }), required: true },
    clock: {
      type: new Schema<ScoreboardClockSub>(
        {
          clockMs: { type: Number, required: true },
          running: { type: Boolean, required: true, default: false },
          lastStartedAt: { type: Date, default: null },
          countsUp: { type: Boolean, required: true, default: false },
        },
        { _id: false },
      ),
      required: true,
    },
    osaekomi: {
      type: new Schema(
        {
          holder: { type: String, enum: ['A', 'B'], required: true },
          startedAt: { type: Date, required: true },
        },
        { _id: false },
      ),
      default: null,
    },
    sides: {
      A: { type: sideSchema, required: true },
      B: { type: sideSchema, required: true },
    },
    winner: {
      type: new Schema(
        {
          athleteId: { type: Schema.Types.ObjectId, ref: 'Athlete', required: true },
          method: { type: String, required: true },
        },
        { _id: false },
      ),
      default: null,
    },
    abortReason: { type: String },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  {
    timestamps: true,
    // Monotonic version guard: every `.save()` checks the document's `__v`
    // hasn't moved since it was read, and increments it on success. Two
    // requests racing on the SAME live scoreboard (e.g. a "waza-ari" and a
    // "declare winner" landing back-to-back) can otherwise both read the
    // pre-mutation document and both write, silently applying the score
    // after the fight was already decided. With this on, the loser of the
    // race gets a Mongoose VersionError instead of a stale write — see
    // ScoreboardService#save, which turns that into a 409 the operator can
    // retry. (The scoreboard's own status field — 'active' vs 'completed'/
    // 'aborted' — already blocks late mutations in the common, ordered
    // case; this closes the genuinely-concurrent gap that status alone
    // can't.)
    optimisticConcurrency: true,
  },
)

// One live scoreboard per match at a time (aborted/completed ones remain as history).
scoreboardSchema.index({ matchId: 1 }, { unique: true, partialFilterExpression: { status: 'active' } })
// Public display looks up the latest scoreboard of an area.
scoreboardSchema.index({ areaId: 1, updatedAt: -1 })

export const ScoreboardModel = model<ScoreboardDocument>('Scoreboard', scoreboardSchema)
