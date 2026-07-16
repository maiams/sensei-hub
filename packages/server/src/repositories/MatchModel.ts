import { Schema, model, type Types } from 'mongoose'
import type { MatchStage } from '@sensei-hub/shared'

export interface MatchResultSub {
  winnerId: Types.ObjectId
  isWalkover: boolean
  method?: string
  points?: number
}

export interface MatchDocument {
  _id: Types.ObjectId
  bracketId: Types.ObjectId
  eventId: Types.ObjectId
  divisionId: Types.ObjectId
  matchNumber: number
  round: number
  stage: MatchStage
  athleteAId: Types.ObjectId | null
  athleteBId: Types.ObjectId | null
  byeAthleteId: Types.ObjectId | null
  nextMatchNumber: number | null
  nextMatchSlot: 'A' | 'B' | null
  loserNextMatchNumber: number | null
  loserNextMatchSlot: 'A' | 'B' | null
  groupMatchNumber: number | null
  result?: MatchResultSub
  createdAt: Date
  updatedAt: Date
}

const matchResultSchema = new Schema<MatchResultSub>(
  {
    winnerId: { type: Schema.Types.ObjectId, ref: 'Athlete', required: true },
    isWalkover: { type: Boolean, required: true },
    method: { type: String },
    points: { type: Number },
  },
  { _id: false },
)

const matchSchema = new Schema<MatchDocument>(
  {
    bracketId: { type: Schema.Types.ObjectId, ref: 'Bracket', required: true },
    eventId: { type: Schema.Types.ObjectId, ref: 'Event', required: true },
    divisionId: { type: Schema.Types.ObjectId, ref: 'Division', required: true },
    matchNumber: { type: Number, required: true },
    round: { type: Number, required: true },
    stage: { type: String, required: true, enum: ['round', 'bronze', 'repechage', 'repechage_round2'] },
    athleteAId: { type: Schema.Types.ObjectId, ref: 'Athlete', default: null },
    athleteBId: { type: Schema.Types.ObjectId, ref: 'Athlete', default: null },
    byeAthleteId: { type: Schema.Types.ObjectId, ref: 'Athlete', default: null },
    nextMatchNumber: { type: Number, default: null },
    nextMatchSlot: { type: String, enum: ['A', 'B'], default: null },
    loserNextMatchNumber: { type: Number, default: null },
    loserNextMatchSlot: { type: String, enum: ['A', 'B'], default: null },
    groupMatchNumber: { type: Number, default: null },
    result: { type: matchResultSchema, default: undefined },
  },
  { timestamps: true },
)

matchSchema.index({ bracketId: 1, matchNumber: 1 }, { unique: true })
matchSchema.index({ eventId: 1, divisionId: 1 })

export const MatchModel = model<MatchDocument>('Match', matchSchema)
