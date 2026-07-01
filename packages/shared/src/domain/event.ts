import { z } from 'zod'

export const EventStatus = z.enum(['draft', 'registration', 'in_progress', 'completed', 'cancelled'])
export type EventStatus = z.infer<typeof EventStatus>

export const EventEntryStatus = z.enum([
  'incomplete',  // missing required data
  'registered',  // imported/entered, awaiting check-in
  'checked_in',  // present at venue
  'weighed_in',  // weigh-in done, category pending confirmation
  'confirmed',   // category confirmed, eligible for bracket
  'withdrawn',   // pulled out
])
export type EventEntryStatus = z.infer<typeof EventEntryStatus>

export const RegistrationMethod = z.enum(['import', 'manual'])
export type RegistrationMethod = z.infer<typeof RegistrationMethod>

export const EventSchema = z.object({
  _id: z.string(),
  hostAcademyId: z.string(),
  name: z.string().min(2).max(200),
  description: z.string().optional(),
  eventDate: z.string().date(),
  venue: z.string().optional(),
  status: EventStatus,
  createdBy: z.string(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
})
export type Event = z.infer<typeof EventSchema>

export const DivisionSchema = z.object({
  _id: z.string(),
  eventId: z.string(),
  name: z.string(),             // e.g. "Masculino Adulto Médio -90kg"
  gender: z.enum(['male', 'female', 'mixed']),
  ageClass: z.string(),         // AgeClass enum value
  weightLimitKg: z.number().positive().optional(),  // null = absoluto
  createdAt: z.string().datetime(),
})
export type Division = z.infer<typeof DivisionSchema>

export const EventEntrySchema = z.object({
  _id: z.string(),
  eventId: z.string(),
  divisionId: z.string(),
  confirmedDivisionId: z.string().optional(),  // may differ after weigh-in
  athleteId: z.string(),
  academyId: z.string(),
  registrationMethod: RegistrationMethod,
  importJobId: z.string().optional(),
  status: EventEntryStatus,
  declaredWeightKg: z.number().positive().optional(),
  confirmedWeightKg: z.number().positive().optional(),
  notes: z.string().optional(),
  withdrawnReason: z.string().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
})
export type EventEntry = z.infer<typeof EventEntrySchema>

export const ImportJobSchema = z.object({
  _id: z.string(),
  eventId: z.string(),
  filename: z.string(),
  importedBy: z.string(),
  importedAt: z.string().datetime(),
  totalRows: z.number().int().nonnegative(),
  successCount: z.number().int().nonnegative(),
  errorCount: z.number().int().nonnegative(),
  errors: z.array(z.object({
    row: z.number().int(),
    field: z.string().optional(),
    message: z.string(),
  })),
})
export type ImportJob = z.infer<typeof ImportJobSchema>
