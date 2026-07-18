import { z } from 'zod'
import { Belt, Gender } from '@sensei-hub/shared'

// Arena competitor — the organization-level athlete registry of the
// championship product. Deliberately slim compared to the dojo athlete:
// no anamnese/medical data, no enrollment, no guardian entity — just what a
// tournament needs to seed divisions, run weigh-in and print brackets.
// Guardian is free text (name/phone) captured for minors' consent trail;
// event participation lives in EventEntry, not here.
const CompetitorWritableFields = {
  fullName: z.string().min(2).max(120),
  preferredName: z.string().max(60).optional(),
  gender: Gender,
  birthDate: z.string().date(), // YYYY-MM-DD, timezone-neutral civil date
  cpf: z.string().optional(), // unique per organization when present
  currentBelt: Belt,
  // Home club/academy label — used by the bracket engine's same-club
  // separation and shown on public displays/printouts.
  clubName: z.string().max(120).optional(),
  federationNumber: z.string().optional(),
  zempoNumber: z.string().optional(),
  email: z.string().email().optional(),
  phone: z.string().optional(),
  guardianName: z.string().max(120).optional(),
  guardianPhone: z.string().optional(),
  termsAccepted: z.boolean().default(false),
  notes: z.string().max(1000).optional(),
}

// POST /api/athletes
export const CreateCompetitorInput = z.object(CompetitorWritableFields)
export type CreateCompetitorInput = z.infer<typeof CreateCompetitorInput>

// PATCH /api/athletes/:id
export const UpdateCompetitorInput = z.object(CompetitorWritableFields).partial()
export type UpdateCompetitorInput = z.infer<typeof UpdateCompetitorInput>

export const CompetitorDTO = z.object({
  id: z.string(),
  academyId: z.string(),
  fullName: z.string(),
  preferredName: z.string().optional(),
  gender: Gender,
  birthDate: z.string().date(),
  cpf: z.string().optional(),
  currentBelt: Belt,
  clubName: z.string().optional(),
  federationNumber: z.string().optional(),
  zempoNumber: z.string().optional(),
  email: z.string().optional(),
  phone: z.string().optional(),
  guardianName: z.string().optional(),
  guardianPhone: z.string().optional(),
  termsAccepted: z.boolean(),
  notes: z.string().optional(),
  latestWeightKg: z.number().positive().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
})
export type CompetitorDTO = z.infer<typeof CompetitorDTO>
