import { z } from 'zod'
import { MatchRules } from './divisionTemplate.js'

export const EventStatus = z.enum(['draft', 'registration', 'in_progress', 'completed', 'cancelled'])
export type EventStatus = z.infer<typeof EventStatus>

export const EventEntryStatus = z.enum([
  'incomplete',   // missing required data
  'registered',   // imported/entered, awaiting check-in
  'checked_in',   // present at venue
  'weighed_in',   // weigh-in done, category pending confirmation
  'confirmed',    // category confirmed, eligible for bracket
  'disqualified', // weigh-in exceeded the division limit and the event's policy is to disqualify
  'withdrawn',    // pulled out
])
export type EventEntryStatus = z.infer<typeof EventEntryStatus>

export const RegistrationMethod = z.enum(['import', 'manual'])
export type RegistrationMethod = z.infer<typeof RegistrationMethod>

// How an event handles a weigh-in that exceeds the division's weightLimitKg:
// 'reallocate' moves the athlete into the lightest sibling division (same
// sourceGroupId) whose limit still fits the actual weight; 'disqualify' ends
// the entry immediately. Reallocation only has a signal to work with for
// divisions imported together from the same academy DivisionGroup — a
// manually created division has no siblings, so 'reallocate' falls back to
// disqualifying when no fitting target exists.
export const OverweightPolicy = z.enum(['disqualify', 'reallocate'])
export type OverweightPolicy = z.infer<typeof OverweightPolicy>

// Minimum rest time (minutes) an athlete must have between two matches,
// enforced by the area/mat dispatcher (see MatchDispatchService on the
// server). Default of 10 is the CBJ national rule (RNC 2025, p.28: "Para
// todas as classes, o tempo mínimo de intervalo entre os combates de um
// mesmo atleta será de 10 minutos") — kept editable per event since other
// federations or local tournaments may set a different value. The default
// itself lives in the Mongoose schema (EventModel), same as overweightPolicy.

// POST /api/events
export const CreateEventInput = z.object({
  hostAcademyId: z.string(),
  name: z.string().min(2).max(200),
  description: z.string().optional(),
  eventDate: z.string().date(),
  venue: z.string().optional(),
  overweightPolicy: OverweightPolicy.optional(), // defaults to 'disqualify'
  restMinutesBetweenMatches: z.number().int().min(0).max(120).optional(), // defaults to 10 (CBJ RNC 2025)
  // Athletes younger than this at the event date are shown on PUBLIC screens
  // (scoreboard display, next-matches board, printed public sheets) as
  // "FirstName L." instead of their full name. null (default) shows full
  // names for everyone. Operator/staff views always show full names.
  publicHideNamesUnderAge: z.number().int().min(1).max(21).nullable().optional(),
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
  overweightPolicy: OverweightPolicy,
  restMinutesBetweenMatches: z.number().int().min(0).max(120),
  publicHideNamesUnderAge: z.number().int().nullable(),
  createdBy: z.string(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
})
export type Event = z.infer<typeof EventSchema>

// A Division is one concrete bracket for an event — one age range, one weight
// limit. It has no fixed "gender"/"ageClass" enum: like DivisionTemplate/
// DivisionGroup (see domain/divisionTemplate.ts), age range is free (null/null
// = no restriction) and the group label (Masculino, Misto, Cadeirantes...) is
// just part of `name`. `sourceTemplateKey`/`sourceGroupId` are optional
// traceability back to the academy template a division was generated from via
// POST /api/events/:id/divisions/import-from-templates — a division created
// this way is a normal, independently editable/deletable row afterwards.
//
// POST /api/events/:id/divisions
export const CreateDivisionInput = z.object({
  name: z.string().min(1).max(120),
  minAge: z.number().int().min(0).max(120).nullable().optional(),
  maxAge: z.number().int().min(0).max(120).nullable().optional(),
  weightLimitKg: z.number().positive().max(300).nullable().optional(), // null = open/heaviest
  matchRules: MatchRules.optional(), // omitted = CBJ_DEFAULT_MATCH_RULES (or the source template's rules on import)
})
export type CreateDivisionInput = z.infer<typeof CreateDivisionInput>

export const UpdateDivisionInput = CreateDivisionInput.partial()
export type UpdateDivisionInput = z.infer<typeof UpdateDivisionInput>

// POST /api/events/:id/divisions/import-from-templates
export const ImportDivisionsFromTemplatesInput = z.object({
  templateKeys: z.array(z.string()).optional(), // omit = import every academy template
})
export type ImportDivisionsFromTemplatesInput = z.infer<typeof ImportDivisionsFromTemplatesInput>

export const DivisionSchema = z.object({
  _id: z.string(),
  eventId: z.string(),
  name: z.string(),
  minAge: z.number().int().nullable(),
  maxAge: z.number().int().nullable(),
  weightLimitKg: z.number().positive().nullable(),
  matchRules: MatchRules,
  sourceTemplateKey: z.string().optional(),
  sourceGroupId: z.string().optional(),
  createdAt: z.string().datetime(),
})
export type Division = z.infer<typeof DivisionSchema>

// POST /api/events/:id/entries
export const CreateEventEntryInput = z.object({
  divisionId: z.string(),
  athleteId: z.string(),
  declaredWeightKg: z.number().positive().max(300).optional(),
  notes: z.string().max(500).optional(),
})
export type CreateEventEntryInput = z.infer<typeof CreateEventEntryInput>

// PATCH /api/events/:id/entries/:eid/weighin
export const RecordWeighInInput = z.object({
  weightKg: z.number().positive().max(300),
})
export type RecordWeighInInput = z.infer<typeof RecordWeighInInput>

// PATCH /api/events/:id/entries/:eid/confirm
export const ConfirmEntryInput = z.object({
  confirmedDivisionId: z.string().optional(), // omit = confirm into the current divisionId
})
export type ConfirmEntryInput = z.infer<typeof ConfirmEntryInput>

// PATCH /api/events/:id/entries/:eid/withdraw
export const WithdrawEntryInput = z.object({
  reason: z.string().min(3).max(500),
})
export type WithdrawEntryInput = z.infer<typeof WithdrawEntryInput>

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
  disqualifiedReason: z.string().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
})
export type EventEntry = z.infer<typeof EventEntrySchema>

export const ImportRowError = z.object({
  row: z.number().int(), // 1-based Excel row number, as seen in the spreadsheet (header = row 1)
  field: z.string().optional(),
  message: z.string(),
})
export type ImportRowError = z.infer<typeof ImportRowError>

export const ImportJobSchema = z.object({
  _id: z.string(),
  eventId: z.string(),
  filename: z.string(),
  importedBy: z.string(),
  importedAt: z.string().datetime(),
  totalRows: z.number().int().nonnegative(),
  successCount: z.number().int().nonnegative(),
  errorCount: z.number().int().nonnegative(),
  errors: z.array(ImportRowError),
})
export type ImportJob = z.infer<typeof ImportJobSchema>

// An Area is a physical mat/table at a live event. A bracket is NOT confined
// to one area — its matches get dispatched across whichever areas are open,
// one at a time, by MatchDispatchService (server). `allowedDivisionIds: null`
// means the area accepts any division; a non-null list restricts it (e.g. a
// smaller mat reserved for Sub-11, or a PCD-only area) — set manually by the
// organizer, never inferred from division name/age (divisions are free-text
// by design, see DivisionTemplate/DivisionGroup).
export const AreaStatus = z.enum(['open', 'closed'])
export type AreaStatus = z.infer<typeof AreaStatus>

// POST /api/events/:id/areas
export const CreateAreaInput = z.object({
  name: z.string().min(1).max(60),
  allowedDivisionIds: z.array(z.string()).nullable().optional(), // omitted/undefined = null = any division
})
export type CreateAreaInput = z.infer<typeof CreateAreaInput>

// PATCH /api/events/:id/areas/:aid
export const UpdateAreaInput = z.object({
  name: z.string().min(1).max(60).optional(),
  allowedDivisionIds: z.array(z.string()).nullable().optional(),
})
export type UpdateAreaInput = z.infer<typeof UpdateAreaInput>

// PATCH /api/events/:id/areas/:aid/close
// POST /api/events/:id/areas/:aid/force-match — manual dispatch override
// ("this match on this mat, now"). Ignores the area's allowedDivisionIds by
// design; still enforces athlete rest unless ignoreRest is explicitly true.
export const ForceMatchInput = z.object({
  matchId: z.string(),
  ignoreRest: z.boolean().optional(),
})
export type ForceMatchInput = z.infer<typeof ForceMatchInput>

export const CloseAreaInput = z.object({
  reason: z.string().min(3).max(500),
})
export type CloseAreaInput = z.infer<typeof CloseAreaInput>

export const AreaSchema = z.object({
  _id: z.string(),
  eventId: z.string(),
  name: z.string(),
  allowedDivisionIds: z.array(z.string()).nullable(),
  status: AreaStatus,
  closedReason: z.string().optional(),
  closedAt: z.string().datetime().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
})
export type Area = z.infer<typeof AreaSchema>

// POST /api/events/:id/areas/:aid/next-match
export const NextMatchSchema = z.object({
  match: z
    .object({
      id: z.string(),
      matchNumber: z.number().int(),
      divisionId: z.string(),
      athleteAId: z.string(),
      athleteBId: z.string(),
    })
    .nullable(), // null = area has nothing eligible to dispatch right now (not an error)
})
export type NextMatch = z.infer<typeof NextMatchSchema>
