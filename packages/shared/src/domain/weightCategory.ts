import { z } from 'zod'
import { AgeClass, Gender } from './athlete.js'

// A single row in a weight-category ladder (e.g. "Leve — até 73kg").
export const WeightCategoryRow = z.object({
  label: z.string().min(1).max(40),
  maxKg: z.number().positive().max(300).nullable(), // null = open/heaviest category
})
export type WeightCategoryRow = z.infer<typeof WeightCategoryRow>

// PUT /api/weight-categories/:groupKey/:gender
export const UpdateWeightCategoriesInput = z.object({
  categories: z.array(WeightCategoryRow).min(1).max(15),
})
export type UpdateWeightCategoriesInput = z.infer<typeof UpdateWeightCategoriesInput>

export const WeightCategoryGroupDTO = z.object({
  groupKey: z.string(),
  label: z.string(),
  gender: Gender,
  categories: z.array(WeightCategoryRow),
  isDefault: z.boolean(), // false once the academy has saved a custom override
})
export type WeightCategoryGroupDTO = z.infer<typeof WeightCategoryGroupDTO>

// Groups the fine-grained AgeClass enum into the editable units shown in the
// settings grid. `junior`/`senior`/`veteran_*` share a single "Adulto" group
// because that's how the source federation table (and this codebase's default
// ladder) presents them — one weight ladder for every non-youth class. Splitting
// them apart in the DB model is still possible later; this is a UI/editing
// grouping, not a storage constraint.
export const AGE_CLASS_GROUPS = [
  { key: 'pre_mirim', label: 'Pré-mirim (Sub-09)', ageClasses: ['pre_mirim'] },
  { key: 'mirim', label: 'Mirim (Sub-11)', ageClasses: ['mirim'] },
  { key: 'infantil', label: 'Infantil (Sub-13)', ageClasses: ['infantil'] },
  { key: 'infanto_juvenil', label: 'Infanto-juvenil (Sub-15)', ageClasses: ['infanto_juvenil'] },
  { key: 'juvenil', label: 'Juvenil (Cadete/Sub-18)', ageClasses: ['juvenil'] },
  {
    key: 'adulto',
    label: 'Adulto (Júnior, Sênior, Veteranos)',
    ageClasses: ['junior', 'senior', 'veteran_j1', 'veteran_j2', 'veteran_m3', 'veteran_m4', 'veteran_m5'],
  },
] as const satisfies ReadonlyArray<{ key: string; label: string; ageClasses: AgeClass[] }>

export type AgeClassGroupKey = (typeof AGE_CLASS_GROUPS)[number]['key']

export function findAgeClassGroup(groupKey: string) {
  return AGE_CLASS_GROUPS.find((g) => g.key === groupKey)
}
