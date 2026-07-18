import { Schema, model, type Types } from 'mongoose'
import type { BracketFormat, BracketSize, RepechageType } from '@arena/shared'

export interface BracketAthleteSlotSub {
  athleteId: Types.ObjectId
  seed: number | null
  // Opaque same-club-separation key, NOT a foreign key: BracketService fills
  // it with the athlete's free-form clubName when present (visiting athletes,
  // Fase 3D) or the academyId string otherwise. Only ever compared for
  // equality by the draw engine.
  clubId: string | null
}

export interface BracketDocument {
  _id: Types.ObjectId
  eventId: Types.ObjectId
  divisionId: Types.ObjectId
  format: BracketFormat
  size?: BracketSize
  repechageType?: RepechageType
  seed: number
  // The eligible-athlete list generate() was called with (not the engine's
  // internal positional BracketState.slots, which for elimination brackets
  // contains raw `null` entries for bye positions — an implementation detail
  // no persisted/rebuilt state needs, since only RodizioEngine.getFinalRankings
  // reads state.slots at all, and only for the plain athleteId list).
  slots: BracketAthleteSlotSub[]
  status: 'active' | 'archived'
  version: number
  generatedBy: Types.ObjectId
  createdAt: Date
  updatedAt: Date
}

const bracketSlotSchema = new Schema<BracketAthleteSlotSub>(
  {
    athleteId: { type: Schema.Types.ObjectId, ref: 'Athlete', required: true },
    seed: { type: Number, default: null },
    clubId: { type: String, default: null },
  },
  { _id: false },
)

const bracketSchema = new Schema<BracketDocument>(
  {
    eventId: { type: Schema.Types.ObjectId, ref: 'Event', required: true },
    divisionId: { type: Schema.Types.ObjectId, ref: 'Division', required: true },
    format: { type: String, required: true, enum: ['elimination', 'rodizio'] },
    size: { type: Number },
    repechageType: { type: String, enum: ['nenhuma', 'simples', 'normal', 'dupla', 'finalistas'] },
    seed: { type: Number, required: true },
    slots: { type: [bracketSlotSchema], required: true },
    status: { type: String, required: true, enum: ['active', 'archived'], default: 'active' },
    version: { type: Number, required: true },
    generatedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true },
)

// Only one active bracket per division at a time — regenerating archives the
// previous one (BracketService.generateBracket) instead of replacing it, so
// past brackets/results are never lost.
bracketSchema.index({ eventId: 1, divisionId: 1 }, { unique: true, partialFilterExpression: { status: 'active' } })

export const BracketModel = model<BracketDocument>('Bracket', bracketSchema)
