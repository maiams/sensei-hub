import { z } from 'zod'

export const EventStatus = z.enum(['draft', 'registration', 'in_progress', 'completed', 'cancelled'])
export type EventStatus = z.infer<typeof EventStatus>

export const EventEntryStatus = z.enum([
  'incomplete',   // missing required data
  'registered',   // imported/entered, awaiting check-in
  'checked_in',   // present at venue
  'weighed_in',   // weigh-in done, category pending confirmation
  'confirmed',    // category confirmed, eligible for bracket
  'withdrawn',    // pulled out
])
export type EventEntryStatus = z.infer<typeof EventEntryStatus>

export const RegistrationMethod = z.enum(['import', 'manual'])
export type RegistrationMethod = z.infer<typeof RegistrationMethod>

// POST /api/events
export const CreateEventInput = z.object({
  hostAcademyId: z.string(),
  name: z.string().min(2).max(200),
  description: z.string().optional(),
  eventDate: z.string().date(),
  venue: z.string().optional(),
})
export type CreateEventInput = z.infer<typeof CreateEventInput>

// PATCH /api/events/:id
export const UpdateEventInput = CreateEventInput.omit({ hostAcademyId: true }).partial().extend({
  status: EventStatus.optional(),
})
export type UpdateEventInput = z.infer<typeof UpdateEventInput>

// Full document stored in MongoDB
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

// POST /api/events/:id/divisions
export const CreateDivisionInput = z.object({
  name: z.string().min(1).max(120),
  gender: z.enum(['male', 'female', 'mixed']),
  ageClass: z.string(),              // AgeClass value
  weightLimitKg: z.number().positive().optional(),
})
export type CreateDivisionInput = z.infer<typeof CreateDivisionInput>

export const DivisionSchema = z.object({
  _id: z.string(),
  eventId: z.string(),
  name: z.string(),
  gender: z.enum(['male', 'female', 'mixed']),
  ageClass: z.string(),
  weightLimitKg: z.number().positive().optional(),
  createdAt: z.string().datetime(),
})
export type Division = z.infer<typeof DivisionSchema>

export const EventEntrySchema = z.object({
  _id: z.string(),
  eventId: z.string(),
  divisionId: z.string(),
  confirmedDivisionId: z.string().optional(),
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
