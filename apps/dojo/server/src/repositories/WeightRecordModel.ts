import { Schema, model, type Types } from 'mongoose'
import type { WeightSource } from '@sensei-hub/shared'

export interface WeightRecordDocument {
  _id: Types.ObjectId
  athleteId: Types.ObjectId
  weightKg: number
  source: WeightSource
  operatorId: Types.ObjectId
  recordedAt: Date
  // Corrections are append-only: a new record is created with source 'corrected'
  // referencing the original. The original is never mutated or deleted.
  correctionReason?: string
  originalRecordId?: Types.ObjectId
  createdAt: Date
  updatedAt: Date
}

const weightRecordSchema = new Schema<WeightRecordDocument>(
  {
    athleteId: { type: Schema.Types.ObjectId, ref: 'Athlete', required: true },
    weightKg: { type: Number, required: true, min: 0, max: 300 },
    source: { type: String, required: true, enum: ['manual', 'scale', 'import', 'corrected'] },
    operatorId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    recordedAt: { type: Date, required: true, default: () => new Date() },
    correctionReason: { type: String, maxlength: 500 },
    originalRecordId: { type: Schema.Types.ObjectId, ref: 'WeightRecord' },
  },
  { timestamps: true },
)

weightRecordSchema.index({ athleteId: 1, recordedAt: -1 })

export const WeightRecordModel = model<WeightRecordDocument>('WeightRecord', weightRecordSchema)
