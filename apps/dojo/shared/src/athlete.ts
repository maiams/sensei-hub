import { z } from 'zod'
import { Belt, Gender, WeightSource } from '@sensei-hub/shared'

export const AthleteStatus = z.enum(['active', 'inactive', 'suspended', 'pending'])
export type AthleteStatus = z.infer<typeof AthleteStatus>

// Mutable fields an operator can provide when creating an athlete
const AthleteWritableFields = {
  fullName: z.string().min(2).max(120),
  preferredName: z.string().max(60).optional(),
  gender: Gender,
  birthDate: z.string().date(),           // YYYY-MM-DD, timezone-neutral civil date
  nationality: z.string().default('Brazilian'),
  email: z.string().email().optional(),
  phone: z.string().optional(),
  cpf: z.string().optional(),             // unique per academy when present
  currentBelt: Belt,
  federationNumber: z.string().optional(), // FPJ; legacy field name kept for stored-data compatibility
  zempoNumber: z.string().optional(),       // national CBJ registration in Zempo
  // Home club/academy label shown on exports — distinct from `academyId`,
  // which is always the single installed academy in this deployment.
  clubName: z.string().max(120).optional(),
  hasMedicalRestriction: z.boolean().default(false),
  medicalNotes: z.string().max(2000).optional(),   // select: false at the model level; coach+ only
  allergies: z.string().max(1000).optional(),      // select: false at the model level; coach+ only
  termsAccepted: z.boolean().default(false),
  imageAuthorizationAccepted: z.boolean().default(false),
}

const GuardianRelationship = z.enum(['father', 'mother', 'guardian', 'other'])
export type GuardianRelationship = z.infer<typeof GuardianRelationship>

// Embedded in POST /api/athletes when the athlete is a minor
export const CreateGuardianInput = z.object({
  name: z.string().min(2).max(120),
  relationship: GuardianRelationship,
  phone: z.string().min(8),
  email: z.string().email().optional(),
  cpf: z.string().optional(),
  termsAccepted: z.literal(true),
  imageAuthorizationAccepted: z.boolean().default(false),
})
export type CreateGuardianInput = z.infer<typeof CreateGuardianInput>

export const GuardianDTO = z.object({
  _id: z.string(),
  athleteId: z.string(),
  name: z.string(),
  relationship: GuardianRelationship,
  phone: z.string(),
  email: z.string().email().optional(),
  cpf: z.string().optional(),
  userId: z.string().optional(),
  termsAccepted: z.boolean(),
  imageAuthorizationAccepted: z.boolean(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
})
export type GuardianDTO = z.infer<typeof GuardianDTO>

// POST /api/athletes
export const CreateAthleteInput = z.object({
  academyId: z.string(),
  guardian: CreateGuardianInput.optional(),   // required by the service when the athlete is a minor
  ...AthleteWritableFields,
})
export type CreateAthleteInput = z.infer<typeof CreateAthleteInput>

// PATCH /api/athletes/:id (all fields optional)
export const UpdateAthleteInput = z.object(AthleteWritableFields).partial()
export type UpdateAthleteInput = z.infer<typeof UpdateAthleteInput>

// API response — omits server-restricted fields (medical notes, raw cpf sent back carefully)
export const AthleteDTO = z.object({
  _id: z.string(),
  academyId: z.string(),
  status: AthleteStatus,
  enrollmentNumber: z.string(),
  fullName: z.string(),
  preferredName: z.string().optional(),
  gender: Gender,
  birthDate: z.string().date(),
  nationality: z.string(),
  email: z.string().email().optional(),
  phone: z.string().optional(),
  currentBelt: Belt,
  federationNumber: z.string().optional(),
  zempoNumber: z.string().optional(),
  clubName: z.string().max(120).optional(),
  latestWeightKg: z.number().positive().optional(),
  hasMedicalRestriction: z.boolean(),    // flag visible to staff; notes are role-restricted server-side
  medicalNotes: z.string().optional(),   // only present in the response for coach+ roles
  allergies: z.string().optional(),      // only present in the response for coach+ roles
  termsAccepted: z.boolean(),
  imageAuthorizationAccepted: z.boolean(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
})
export type AthleteDTO = z.infer<typeof AthleteDTO>

// Internal document schema (includes all fields stored in MongoDB)
export const AthleteDocumentSchema = AthleteDTO.extend({
  cpf: z.string().optional(),
})
export type AthleteDocument = z.infer<typeof AthleteDocumentSchema>

// Kept for backward compat with existing imports
export const AthleteSchema = AthleteDocumentSchema
export type Athlete = AthleteDocument

// ─── Belt records ────────────────────────────────────────────────────────────

// POST /api/athletes/:id/belts
export const CreateBeltRecordInput = z.object({
  belt: Belt,
  grantedAt: z.string().date(),
  notes: z.string().max(500).optional(),
})
export type CreateBeltRecordInput = z.infer<typeof CreateBeltRecordInput>

export const BeltRecordDTO = z.object({
  _id: z.string(),
  athleteId: z.string(),
  belt: Belt,
  grantedAt: z.string().date(),
  grantedBy: z.string(),
  notes: z.string().optional(),
  createdAt: z.string().datetime(),
})
export type BeltRecordDTO = z.infer<typeof BeltRecordDTO>

// ─── Weight records ──────────────────────────────────────────────────────────

// POST /api/athletes/:id/weights
export const RecordWeightInput = z.object({
  weightKg: z.number().positive().max(300),
})
export type RecordWeightInput = z.infer<typeof RecordWeightInput>

// POST /api/athletes/:id/weights/:wid/correct
export const CorrectWeightInput = z.object({
  weightKg: z.number().positive().max(300),
  reason: z.string().min(3).max(500),
})
export type CorrectWeightInput = z.infer<typeof CorrectWeightInput>

export const WeightRecordDTO = z.object({
  _id: z.string(),
  athleteId: z.string(),
  weightKg: z.number().positive(),
  source: WeightSource,
  operatorId: z.string(),
  recordedAt: z.string().datetime(),
  correctionReason: z.string().optional(),
  originalRecordId: z.string().optional(),
})
export type WeightRecordDTO = z.infer<typeof WeightRecordDTO>
