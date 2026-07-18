import { Schema, model, type Types } from 'mongoose'
import type { MatchRules } from '@arena/shared'

// Shared sub-schema shape for MatchRules (also used by DivisionModel).
// Documents created before this field existed won't have it — readers must
// fall back to CBJ_DEFAULT_MATCH_RULES when mapping to DTOs (Mongoose does
// not apply defaults when reading pre-existing documents).
export const matchRulesSchemaDefinition = {
  matchDurationSeconds: { type: Number, required: true },
  goldenScoreEnabled: { type: Boolean, required: true },
  goldenScoreDurationSeconds: { type: Number, default: null },
  osaekomiYukoSeconds: { type: Number, required: true },
  osaekomiWazaariSeconds: { type: Number, required: true },
  osaekomiIpponSeconds: { type: Number, required: true },
} as const

export interface DivisionTemplateDocument {
  _id: Types.ObjectId
  academyId: Types.ObjectId
  key: string // slug, server-generated, immutable after creation
  label: string
  minAge: number | null
  maxAge: number | null // null = open-ended
  matchRules?: MatchRules
  order: number
  createdAt: Date
  updatedAt: Date
}

const divisionTemplateSchema = new Schema<DivisionTemplateDocument>(
  {
    academyId: { type: Schema.Types.ObjectId, ref: 'Academy', required: true },
    key: { type: String, required: true, trim: true },
    label: { type: String, required: true, trim: true, maxlength: 80 },
    minAge: { type: Number, default: null },
    maxAge: { type: Number, default: null },
    matchRules: { type: new Schema(matchRulesSchemaDefinition, { _id: false }), default: undefined },
    order: { type: Number, required: true, default: 0 },
  },
  { timestamps: true },
)

divisionTemplateSchema.index({ academyId: 1, key: 1 }, { unique: true })
divisionTemplateSchema.index({ academyId: 1, order: 1 })

export const DivisionTemplateModel = model<DivisionTemplateDocument>('DivisionTemplate', divisionTemplateSchema)
