import { Schema, model, type Types } from 'mongoose'
import type { GuardianRelationship } from '@sensei-hub/shared'

export interface GuardianDocument {
  _id: Types.ObjectId
  athleteId: Types.ObjectId
  name: string
  relationship: GuardianRelationship
  phone: string
  email?: string
  cpf?: string
  userId?: Types.ObjectId // link to a guardian's own login — out of scope until guardian auth ships
  termsAccepted: boolean
  imageAuthorizationAccepted: boolean
  createdAt: Date
  updatedAt: Date
}

const guardianSchema = new Schema<GuardianDocument>(
  {
    athleteId: { type: Schema.Types.ObjectId, ref: 'Athlete', required: true },
    name: { type: String, required: true, trim: true, maxlength: 120 },
    relationship: { type: String, required: true, enum: ['father', 'mother', 'guardian', 'other'] },
    phone: { type: String, required: true, trim: true },
    email: { type: String, trim: true, lowercase: true },
    cpf: { type: String, trim: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User' },
    termsAccepted: { type: Boolean, required: true },
    imageAuthorizationAccepted: { type: Boolean, required: true, default: false },
  },
  { timestamps: true },
)

// One guardian record per athlete in the MVP — see status-e-plano.md Fase 2.
guardianSchema.index({ athleteId: 1 }, { unique: true })
guardianSchema.index({ userId: 1 }, { sparse: true })

export const GuardianModel = model<GuardianDocument>('Guardian', guardianSchema)
