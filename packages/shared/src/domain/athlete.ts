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

// Age classes per IJF/CBJ — computed from birthDate at event time, never stored fixed
export const AgeClass = z.enum([
  'pre_mirim',      // 7–9
  'mirim',          // 10–11
  'infantil',       // 12–13
  'infanto_juvenil',// 14–15
  'juvenil',        // 16–17
  'junior',         // 18–20
  'senior',         // 15+
  'veteran_j1',     // 30–39
  'veteran_j2',     // 40–49
  'veteran_m3',     // 50–59
  'veteran_m4',     // 60–69
  'veteran_m5',     // 70+
])
export type AgeClass = z.infer<typeof AgeClass>

export const AthleteSchema = z.object({
  _id: z.string(),
  academyId: z.string(),
  scope: AthleteScope,
  eventOnlyEventId: z.string().optional(),
  status: AthleteStatus,
  enrollmentNumber: z.string(),

  // Personal
  fullName: z.string().min(2).max(120),
  preferredName: z.string().max(60).optional(),
  gender: Gender,
  birthDate: z.string().date(),
  nationality: z.string().default('Brazilian'),

  // Contact
  email: z.string().email().optional(),
  phone: z.string().optional(),

  // Documents
  cpf: z.string().optional(),

  // Judo
  currentBelt: Belt,
  federationNumber: z.string().optional(),

  // Physical (latest reference — history in weightRecords)
  latestWeightKg: z.number().positive().optional(),

  // Medical flags — restricted access
  hasMedicalRestriction: z.boolean().default(false),

  // Consents
  termsAccepted: z.boolean().default(false),
  imageAuthorizationAccepted: z.boolean().default(false),

  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
})
export type Athlete = z.infer<typeof AthleteSchema>
