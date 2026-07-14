import { z } from 'zod'

export const AthleteScope = z.enum(['academy', 'event-only'])
export type AthleteScope = z.infer<typeof AthleteScope>

export const AthleteStatus = z.enum(['active', 'inactive', 'suspended', 'pending'])
export type AthleteStatus = z.infer<typeof AthleteStatus>

export const Belt = z.enum([
  'white', 'yellow', 'orange', 'green', 'blue', 'brown',
  'black-1dan', 'black-2dan', 'black-3dan', 'black-4dan', 'black-5dan',
  'black-6dan', 'black-7dan', 'black-8dan', 'black-9dan', 'black-10dan',
])
export type Belt = z.infer<typeof Belt>

export const Gender = z.enum(['male', 'female', 'not_informed'])
export type Gender = z.infer<typeof Gender>

// Age classes per IJF/CBJ — derived from birthDate at event time, never stored as a fixed field
export const AgeClass = z.enum([
  'pre_mirim',       // 7–9
  'mirim',           // 10–11
  'infantil',        // 12–13
  'infanto_juvenil', // 14–15
  'juvenil',         // 16–17
  'junior',          // 18–20
  'senior',          // 15+ (open adult)
  'veteran_j1',      // 30–39
  'veteran_j2',      // 40–49
  'veteran_m3',      // 50–59
  'veteran_m4',      // 60–69
  'veteran_m5',      // 70+
])
export type AgeClass = z.infer<typeof AgeClass>

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
  federationNumber: z.string().optional(),
  hasMedicalRestriction: z.boolean().default(false),
  termsAccepted: z.boolean().default(false),
  imageAuthorizationAccepted: z.boolean().default(false),
}

// POST /api/athletes
export const CreateAthleteInput = z.object({
  academyId: z.string(),
  scope: AthleteScope.default('academy'),
  eventOnlyEventId: z.string().optional(),
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
  scope: AthleteScope,
  eventOnlyEventId: z.string().optional(),
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
  latestWeightKg: z.number().positive().optional(),
  hasMedicalRestriction: z.boolean(),    // flag visible to staff; notes are role-restricted server-side
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
