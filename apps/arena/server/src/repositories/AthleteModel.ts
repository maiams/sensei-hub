import { Schema, model, type Types } from 'mongoose'
import { BELT_VALUES, type Gender, type Belt } from '@sensei-hub/shared'

// Arena competitor registry. The mongoose model name stays 'Athlete' so every
// athleteId ref (EventEntry, Bracket, Match, Scoreboard, Attendance,
// WeightRecord) is unchanged, but the schema is the slim championship shape —
// no anamnese/medical, no enrollment/status, guardian as plain text.
export interface AthleteDocument {
  _id: Types.ObjectId
  academyId: Types.ObjectId
  fullName: string
  preferredName?: string
  gender: Gender
  birthDate: string // YYYY-MM-DD
  cpf?: string
  currentBelt: Belt
  clubName?: string
  federationNumber?: string
  zempoNumber?: string
  email?: string
  phone?: string
  guardianName?: string
  guardianPhone?: string
  termsAccepted: boolean
  notes?: string
  latestWeightKg?: number
  createdAt: Date
  updatedAt: Date
}

const athleteSchema = new Schema<AthleteDocument>(
  {
    academyId: { type: Schema.Types.ObjectId, ref: 'Academy', required: true, index: true },
    fullName: { type: String, required: true, trim: true, maxlength: 120 },
    preferredName: { type: String, trim: true, maxlength: 60 },
    gender: { type: String, required: true, enum: ['male', 'female', 'not_informed'] },
    birthDate: { type: String, required: true },
    cpf: { type: String, trim: true },
    currentBelt: { type: String, required: true, enum: BELT_VALUES },
    clubName: { type: String, trim: true, maxlength: 120 },
    federationNumber: { type: String, trim: true },
    zempoNumber: { type: String, trim: true },
    email: { type: String, trim: true, lowercase: true },
    phone: { type: String, trim: true },
    guardianName: { type: String, trim: true, maxlength: 120 },
    guardianPhone: { type: String, trim: true },
    termsAccepted: { type: Boolean, required: true, default: false },
    notes: { type: String, maxlength: 1000 },
    latestWeightKg: { type: Number },
  },
  { timestamps: true },
)

athleteSchema.index({ academyId: 1, fullName: 1 })
// CPF unique per organization, only when present
athleteSchema.index(
  { academyId: 1, cpf: 1 },
  { unique: true, partialFilterExpression: { cpf: { $type: 'string' } } },
)

export const AthleteModel = model<AthleteDocument>('Athlete', athleteSchema)
