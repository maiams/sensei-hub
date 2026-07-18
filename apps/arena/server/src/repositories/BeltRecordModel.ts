import { Schema, model, type Types } from 'mongoose'
import { BELT_VALUES, type Belt } from '@sensei-hub/shared'

export interface BeltRecordDocument {
  _id: Types.ObjectId
  athleteId: Types.ObjectId
  belt: Belt
  grantedAt: string // YYYY-MM-DD, civil date
  grantedBy: Types.ObjectId // User who recorded the grading
  notes?: string
  createdAt: Date
  updatedAt: Date
}

const beltRecordSchema = new Schema<BeltRecordDocument>(
  {
    athleteId: { type: Schema.Types.ObjectId, ref: 'Athlete', required: true },
    belt: {
      type: String,
      required: true,
      enum: BELT_VALUES,
    },
    grantedAt: { type: String, required: true },
    grantedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    notes: { type: String, maxlength: 500 },
  },
  { timestamps: true },
)

beltRecordSchema.index({ athleteId: 1, grantedAt: -1 })

export const BeltRecordModel = model<BeltRecordDocument>('BeltRecord', beltRecordSchema)
