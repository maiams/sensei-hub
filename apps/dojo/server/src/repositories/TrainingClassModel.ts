import { Schema, model, type Types } from 'mongoose'

export interface TrainingClassDocument {
  _id: Types.ObjectId
  academyId: Types.ObjectId
  name: string
  nameNormalized: string
  description?: string
  active: boolean
  createdAt: Date
  updatedAt: Date
}

const trainingClassSchema = new Schema<TrainingClassDocument>({
  academyId: { type: Schema.Types.ObjectId, ref: 'Academy', required: true },
  name: { type: String, required: true, trim: true, maxlength: 120 },
  nameNormalized: { type: String, required: true, trim: true },
  description: { type: String, trim: true, maxlength: 500 },
  active: { type: Boolean, required: true, default: true },
}, { timestamps: true })

trainingClassSchema.index({ academyId: 1, nameNormalized: 1 }, { unique: true })
trainingClassSchema.index({ academyId: 1, active: 1, name: 1 })

export const TrainingClassModel = model<TrainingClassDocument>('TrainingClass', trainingClassSchema)
