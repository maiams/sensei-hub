import { Schema, model, type Types } from 'mongoose'
import type { AthleteScope, AthleteStatus, Gender, Belt } from '@sensei-hub/shared'

export interface AthleteDocument {
  _id: Types.ObjectId
  academyId: Types.ObjectId
  scope: AthleteScope
  eventOnlyEventId?: Types.ObjectId
  status: AthleteStatus
  enrollmentNumber: string
  fullName: string
  preferredName?: string
  gender: Gender
  birthDate: string // YYYY-MM-DD
  nationality: string
  email?: string
  phone?: string
  cpf?: string
  currentBelt: Belt
  federationNumber?: string
  latestWeightKg?: number
  hasMedicalRestriction: boolean
  medical?: {
    notes?: string
    allergies?: string
  }
  termsAccepted: boolean
  imageAuthorizationAccepted: boolean
  deactivatedReason?: string
  createdAt: Date
  updatedAt: Date
}

const athleteSchema = new Schema<AthleteDocument>(
  {
    academyId: { type: Schema.Types.ObjectId, ref: 'Academy', required: true, index: true },
    scope: { type: String, required: true, enum: ['academy', 'event-only'], default: 'academy' },
    eventOnlyEventId: { type: Schema.Types.ObjectId, ref: 'Event' },
    status: { type: String, required: true, enum: ['active', 'inactive', 'suspended', 'pending'], default: 'active' },
    enrollmentNumber: { type: String, required: true },
    fullName: { type: String, required: true, trim: true, maxlength: 120 },
    preferredName: { type: String, trim: true, maxlength: 60 },
    gender: { type: String, required: true, enum: ['male', 'female', 'not_informed'] },
    birthDate: { type: String, required: true },
    nationality: { type: String, required: true, default: 'Brazilian' },
    email: { type: String, trim: true, lowercase: true },
    phone: { type: String, trim: true },
    cpf: { type: String, trim: true },
    currentBelt: {
      type: String,
      required: true,
      enum: [
        'white', 'yellow', 'orange', 'green', 'blue', 'brown',
        'black-1dan', 'black-2dan', 'black-3dan', 'black-4dan', 'black-5dan',
        'black-6dan', 'black-7dan', 'black-8dan', 'black-9dan', 'black-10dan',
      ],
    },
    federationNumber: { type: String, trim: true },
    latestWeightKg: { type: Number },
    hasMedicalRestriction: { type: Boolean, required: true, default: false },
    medical: {
      type: new Schema(
        {
          notes: { type: String, maxlength: 2000 },
          allergies: { type: String, maxlength: 1000 },
        },
        { _id: false },
      ),
      select: false,
    },
    termsAccepted: { type: Boolean, required: true, default: false },
    imageAuthorizationAccepted: { type: Boolean, required: true, default: false },
    deactivatedReason: { type: String },
  },
  { timestamps: true },
)

athleteSchema.index({ academyId: 1, status: 1 })
athleteSchema.index({ academyId: 1, enrollmentNumber: 1 }, { unique: true })
// CPF unique per academy, only when present — visiting event-only athletes may
// already exist as a permanent athlete in another academy (see status-e-plano.md).
athleteSchema.index(
  { academyId: 1, cpf: 1 },
  { unique: true, partialFilterExpression: { cpf: { $type: 'string' } } },
)

export const AthleteModel = model<AthleteDocument>('Athlete', athleteSchema)
