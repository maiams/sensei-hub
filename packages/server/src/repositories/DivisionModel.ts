import { Schema, model, type Types } from 'mongoose'

export interface DivisionDocument {
  _id: Types.ObjectId
  eventId: Types.ObjectId
  name: string
  minAge: number | null
  maxAge: number | null
  weightLimitKg: number | null // null = open/heaviest bracket
  // Optional traceability back to the academy DivisionTemplate/DivisionGroup
  // this row was generated from (POST .../divisions/import-from-templates).
  // A division is independently editable/deletable afterwards regardless.
  sourceTemplateKey?: string
  sourceGroupId?: Types.ObjectId
  createdAt: Date
  updatedAt: Date
}

const divisionSchema = new Schema<DivisionDocument>(
  {
    eventId: { type: Schema.Types.ObjectId, ref: 'Event', required: true },
    name: { type: String, required: true, trim: true, maxlength: 120 },
    minAge: { type: Number, default: null },
    maxAge: { type: Number, default: null },
    weightLimitKg: { type: Number, default: null },
    sourceTemplateKey: { type: String },
    sourceGroupId: { type: Schema.Types.ObjectId, ref: 'DivisionGroup' },
  },
  { timestamps: true },
)

divisionSchema.index({ eventId: 1 })

export const DivisionModel = model<DivisionDocument>('Division', divisionSchema)
