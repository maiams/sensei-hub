import { Schema, model, type Types } from 'mongoose'

export interface WeightCategoryRowSubdoc {
  label: string
  maxKg: number | null
}

export interface SourcePresetSubdoc {
  templateKey: string
  groupLabel: 'male' | 'female'
}

export interface DivisionGroupDocument {
  _id: Types.ObjectId
  academyId: Types.ObjectId
  divisionTemplateId: Types.ObjectId
  label: string // free text: "Masculino", "Misto", "Cadeirantes", "Único"...
  order: number
  categories: WeightCategoryRowSubdoc[]
  // Set only when this group was created by loadFpjPreset — tracks which preset
  // ladder it came from so "restaurar valores da FPJ" still works after a rename.
  // Never surfaced as an editable field to the user.
  sourcePreset: SourcePresetSubdoc | null
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

const sourcePresetSchema = new Schema<SourcePresetSubdoc>(
  {
    templateKey: { type: String, required: true },
    groupLabel: { type: String, required: true, enum: ['male', 'female'] },
  },
  { _id: false },
)

const divisionGroupSchema = new Schema<DivisionGroupDocument>(
  {
    academyId: { type: Schema.Types.ObjectId, ref: 'Academy', required: true },
    divisionTemplateId: { type: Schema.Types.ObjectId, ref: 'DivisionTemplate', required: true },
    label: { type: String, required: true, trim: true, maxlength: 60 },
    order: { type: Number, required: true, default: 0 },
    categories: { type: [weightCategoryRowSchema], required: true },
    sourcePreset: { type: sourcePresetSchema, default: null },
  },
  { timestamps: true },
)

divisionGroupSchema.index({ academyId: 1, divisionTemplateId: 1, order: 1 })

export const DivisionGroupModel = model<DivisionGroupDocument>('DivisionGroup', divisionGroupSchema)
