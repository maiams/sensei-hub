import { z } from 'zod'

// A single row in a weight-category ladder (e.g. "Leve — até 73kg").
export const WeightCategoryRow = z.object({
  label: z.string().min(1).max(40),
  maxKg: z.number().positive().max(300).nullable(), // null = open/heaviest category
})
export type WeightCategoryRow = z.infer<typeof WeightCategoryRow>

// A division is an age bracket (or none — minAge/maxAge both absent) an academy
// configures for its competitions. It has no notion of gender/split baked in —
// that's entirely up to the groups nested inside it (see below).
export const CreateDivisionTemplateInput = z.object({
  label: z.string().min(1).max(80),
  minAge: z.number().int().min(0).max(120).nullable().optional(),
  maxAge: z.number().int().min(0).max(120).nullable().optional(),
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
  order: z.number().int(),
  groups: z.array(DivisionGroupDTO),
})
export type DivisionTemplateDTO = z.infer<typeof DivisionTemplateDTO>
