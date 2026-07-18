import { z } from 'zod'

// A single row in a weight-category ladder (e.g. "Leve — até 73kg").
export const WeightCategoryRow = z.object({
  label: z.string().min(1).max(40),
  maxKg: z.number().positive().max(300).nullable(), // null = open/heaviest category
})
export type WeightCategoryRow = z.infer<typeof WeightCategoryRow>

// Match rules for every bracket of a division: fight duration, golden score
// and osaekomi thresholds. Rules vary by age class (a Sub-13 fight is 2min,
// an adult one 4min), so they live on the division, always editable.
export const MatchRules = z
  .object({
    matchDurationSeconds: z.number().int().min(30).max(1200),
    goldenScoreEnabled: z.boolean(),
    goldenScoreDurationSeconds: z.number().int().min(30).max(1200).nullable(), // null = unlimited; irrelevant when GS disabled
    osaekomiYukoSeconds: z.number().int().min(1).max(60),
    osaekomiWazaariSeconds: z.number().int().min(1).max(60),
    osaekomiIpponSeconds: z.number().int().min(1).max(60),
  })
  .refine((r) => r.osaekomiYukoSeconds < r.osaekomiWazaariSeconds && r.osaekomiWazaariSeconds < r.osaekomiIpponSeconds, {
    message: 'Osaekomi thresholds must be strictly increasing (yuko < waza-ari < ippon)',
  })
export type MatchRules = z.infer<typeof MatchRules>

// CBJ RNC 2025 (v2, 25/03/2025, cbj.com.br), p.29: senior/Sub-23/junior/cadete
// fights last 4 minutes; every class has golden score with no time limit;
// osaekomi scores yuko at 5s, waza-ari at 10s, ippon at 20s.
export const CBJ_DEFAULT_MATCH_RULES: MatchRules = {
  matchDurationSeconds: 240,
  goldenScoreEnabled: true,
  goldenScoreDurationSeconds: null,
  osaekomiYukoSeconds: 5,
  osaekomiWazaariSeconds: 10,
  osaekomiIpponSeconds: 20,
}

// A division is an age bracket (or none — minAge/maxAge both absent) an academy
// configures for its competitions. It has no notion of gender/split baked in —
// that's entirely up to the groups nested inside it (see below).
export const CreateDivisionTemplateInput = z.object({
  label: z.string().min(1).max(80),
  minAge: z.number().int().min(0).max(120).nullable().optional(),
  maxAge: z.number().int().min(0).max(120).nullable().optional(),
  matchRules: MatchRules.optional(), // omitted = CBJ_DEFAULT_MATCH_RULES
})
export type CreateDivisionTemplateInput = z.infer<typeof CreateDivisionTemplateInput>

export const UpdateDivisionTemplateInput = CreateDivisionTemplateInput.partial()
export type UpdateDivisionTemplateInput = z.infer<typeof UpdateDivisionTemplateInput>

// A group is a free-form split within a division — "Masculino", "Feminino",
// "Misto", "Cadeirantes", "Único"... whatever the person running the
// competition wants. Each group has its own independent weight-category ladder.
export const CreateDivisionGroupInput = z.object({
  label: z.string().min(1).max(60),
  categories: z.array(WeightCategoryRow).min(1).max(15),
})
export type CreateDivisionGroupInput = z.infer<typeof CreateDivisionGroupInput>

export const UpdateDivisionGroupInput = z.object({
  label: z.string().min(1).max(60).optional(),
  categories: z.array(WeightCategoryRow).min(1).max(15).optional(),
})
export type UpdateDivisionGroupInput = z.infer<typeof UpdateDivisionGroupInput>

export const DivisionGroupDTO = z.object({
  id: z.string(),
  label: z.string(),
  order: z.number().int(),
  categories: z.array(WeightCategoryRow),
  canRestoreFromPreset: z.boolean(), // true only when this group originated from loadFpjPreset
})
export type DivisionGroupDTO = z.infer<typeof DivisionGroupDTO>

export const DivisionTemplateDTO = z.object({
  id: z.string(),
  key: z.string(),
  label: z.string(),
  minAge: z.number().int().nullable(),
  maxAge: z.number().int().nullable(),
  matchRules: MatchRules,
  order: z.number().int(),
  groups: z.array(DivisionGroupDTO),
})
export type DivisionTemplateDTO = z.infer<typeof DivisionTemplateDTO>
