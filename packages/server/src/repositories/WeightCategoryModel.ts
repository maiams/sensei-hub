import { Schema, model, type Types } from 'mongoose'
import type { AgeClass } from '@sensei-hub/shared'

export interface WeightCategoryRowSubdoc {
  label: string
  maxKg: number | null
}

export interface WeightCategoryDocument {
  _id: Types.ObjectId
  academyId: Types.ObjectId
  gender: 'male' | 'female'
  ageClass: AgeClass
  categories: WeightCategoryRowSubdoc[]
  createdAt: Date
  updatedAt: Date
}

const weightCategoryRowSchema = new Schema<WeightCategoryRowSubdoc>(
  {
    label: { type: String, required: true, trim: true, maxlength: 40 },
    maxKg: { type: Number, default: null },
  },
  { _id: false },
)

const weightCategorySchema = new Schema<WeightCategoryDocument>(
  {
    academyId: { type: Schema.Types.ObjectId, ref: 'Academy', required: true },
    gender: { type: String, required: true, enum: ['male', 'female'] },
    ageClass: {
      type: String,
      required: true,
      enum: [
        'pre_mirim', 'mirim', 'infantil', 'infanto_juvenil', 'juvenil', 'junior', 'senior',
        'veteran_j1', 'veteran_j2', 'veteran_m3', 'veteran_m4', 'veteran_m5',
      ],
    },
    categories: { type: [weightCategoryRowSchema], required: true },
  },
  { timestamps: true },
)

// One override per academy/gender/ageClass — this is what makes the table
// per-academy editable instead of the hardcoded AgeClassService default.
weightCategorySchema.index({ academyId: 1, gender: 1, ageClass: 1 }, { unique: true })

export const WeightCategoryModel = model<WeightCategoryDocument>('WeightCategory', weightCategorySchema)
