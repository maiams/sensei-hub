import { Schema, model, type Types } from 'mongoose'

export interface DivisionTemplateDocument {
  _id: Types.ObjectId
  academyId: Types.ObjectId
  key: string // slug, server-generated, immutable after creation
  label: string
  minAge: number | null
  maxAge: number | null // null = open-ended
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
    order: { type: Number, required: true, default: 0 },
  },
  { timestamps: true },
)

divisionTemplateSchema.index({ academyId: 1, key: 1 }, { unique: true })
divisionTemplateSchema.index({ academyId: 1, order: 1 })

export const DivisionTemplateModel = model<DivisionTemplateDocument>('DivisionTemplate', divisionTemplateSchema)
