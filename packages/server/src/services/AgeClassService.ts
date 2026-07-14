import type { AgeClass, Gender } from '@sensei-hub/shared'

// Pure domain logic — no I/O, no Mongoose. Age class is always derived at the moment
// of use from birthDate + eventDate; it is never persisted as a fixed athlete field.

export class AgeClassServiceError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AgeClassServiceError'
  }
}

export interface WeightCategory {
  label: string
  maxKg: number | null // null = open category ("acima de X kg")
}

interface AgeBoundary {
  ageClass: AgeClass
  minAge: number
  maxAge: number | null // null = no upper bound
}

// Youth boundaries (pre_mirim..juvenil) follow FPJ's "Tabelas de Classes e Categorias
// 2026" (Divisão Aspirante, v2, 03/02/2026 — https://fpj.com.br), which states it
// follows the CBJ table: Sub-09 (7-8), Sub-11 (9-10), Sub-13 (11-12), Sub-15 (13-14),
// Cadete/Sub-18 (15-17). `junior`/`senior`/`veteran_*` are this codebase's own
// partition of the PDF's single "Adulto" bucket ("acima de 15 anos"): the source
// table doesn't subdivide adults by age, only by weight, so the 21-29 senior
// boundary is our assumption to fill the gap between junior (ends 20) and
// veteran_j1 (starts 30). Revisit if a specific competition's rule differs — and
// note that weight categories, unlike these age boundaries, are meant to be
// overridable per event/division (Fase 3A DivisionModel), since organizers of
// smaller tournaments often need to merge sparse brackets (e.g. Sub-13 Pesado +
// Super Pesado into one division when there aren't enough athletes to fill both).
const AGE_BOUNDARIES: AgeBoundary[] = [
  { ageClass: 'pre_mirim', minAge: 7, maxAge: 8 },
  { ageClass: 'mirim', minAge: 9, maxAge: 10 },
  { ageClass: 'infantil', minAge: 11, maxAge: 12 },
  { ageClass: 'infanto_juvenil', minAge: 13, maxAge: 14 },
  { ageClass: 'juvenil', minAge: 15, maxAge: 17 },
  { ageClass: 'junior', minAge: 18, maxAge: 20 },
  { ageClass: 'senior', minAge: 21, maxAge: 29 },
  { ageClass: 'veteran_j1', minAge: 30, maxAge: 39 },
  { ageClass: 'veteran_j2', minAge: 40, maxAge: 49 },
  { ageClass: 'veteran_m3', minAge: 50, maxAge: 59 },
  { ageClass: 'veteran_m4', minAge: 60, maxAge: 69 },
  { ageClass: 'veteran_m5', minAge: 70, maxAge: null },
]

function calculateAge(birthDate: string, eventDate: string): number {
  const birth = new Date(`${birthDate}T00:00:00Z`)
  const event = new Date(`${eventDate}T00:00:00Z`)

  let age = event.getUTCFullYear() - birth.getUTCFullYear()
  const monthDiff = event.getUTCMonth() - birth.getUTCMonth()
  const dayDiff = event.getUTCDate() - birth.getUTCDate()
  if (monthDiff < 0 || (monthDiff === 0 && dayDiff < 0)) {
    age--
  }
  return age
}

export function calculateAgeClass(birthDate: string, eventDate: string): AgeClass {
  const age = calculateAge(birthDate, eventDate)
  if (age < 0) {
    throw new AgeClassServiceError('Event date is before birth date')
  }

  const boundary = AGE_BOUNDARIES.find((b) => age >= b.minAge && (b.maxAge === null || age <= b.maxAge))
  if (!boundary) {
    throw new AgeClassServiceError(`No age class configured for age ${age}`)
  }
  return boundary.ageClass
}

// Default weight-category ladders — FPJ "Tabelas de Classes e Categorias 2026"
// (Divisão Aspirante, v2, 03/02/2026, https://fpj.com.br, "conforme tabela da
// CBJ"). `junior`/`senior`/`veteran_*` all share the PDF's single "Adulto" ladder.
//
// These are *defaults* for pre-filling event/division setup, not a hard rule
// enforced here: Fase 3A's DivisionModel lets an event manually merge or adjust
// categories per event (e.g. combine Sub-13 Pesado + Super Pesado into one open
// division when there aren't enough athletes to fill both) — that flexibility
// belongs at the division level, not in this shared reference table.
const WEIGHT_CATEGORIES: Record<Gender, Partial<Record<AgeClass, WeightCategory[]>>> = {
  male: {
    pre_mirim: [
      { label: 'Super Ligeiro', maxKg: 23 },
      { label: 'Ligeiro', maxKg: 26 },
      { label: 'Meio Leve', maxKg: 29 },
      { label: 'Leve', maxKg: 32 },
      { label: 'Meio Médio', maxKg: 36 },
      { label: 'Médio', maxKg: 40 },
      { label: 'Meio Pesado', maxKg: 45 },
      { label: 'Pesado', maxKg: 50 },
      { label: 'Super Pesado', maxKg: 55 },
      { label: 'Extra Pesado', maxKg: null },
    ],
    mirim: [
      { label: 'Super Ligeiro', maxKg: 28 },
      { label: 'Ligeiro', maxKg: 30 },
      { label: 'Meio Leve', maxKg: 33 },
      { label: 'Leve', maxKg: 36 },
      { label: 'Meio Médio', maxKg: 40 },
      { label: 'Médio', maxKg: 45 },
      { label: 'Meio Pesado', maxKg: 50 },
      { label: 'Pesado', maxKg: 55 },
      { label: 'Super Pesado', maxKg: 60 },
      { label: 'Extra Pesado', maxKg: null },
    ],
    infantil: [
      { label: 'Super Ligeiro', maxKg: 35 },
      { label: 'Ligeiro', maxKg: 40 },
      { label: 'Meio Leve', maxKg: 45 },
      { label: 'Leve', maxKg: 50 },
      { label: 'Meio Médio', maxKg: 55 },
      { label: 'Médio', maxKg: 60 },
      { label: 'Meio Pesado', maxKg: 66 },
      { label: 'Pesado', maxKg: 73 },
      { label: 'Super Pesado', maxKg: null },
    ],
    infanto_juvenil: [
      { label: 'Super Ligeiro', maxKg: 40 },
      { label: 'Ligeiro', maxKg: 45 },
      { label: 'Meio Leve', maxKg: 50 },
      { label: 'Leve', maxKg: 55 },
      { label: 'Meio Médio', maxKg: 60 },
      { label: 'Médio', maxKg: 66 },
      { label: 'Meio Pesado', maxKg: 73 },
      { label: 'Pesado', maxKg: 81 },
      { label: 'Super Pesado', maxKg: null },
    ],
    juvenil: [
      { label: 'Super Ligeiro', maxKg: 50 },
      { label: 'Ligeiro', maxKg: 55 },
      { label: 'Meio Leve', maxKg: 60 },
      { label: 'Leve', maxKg: 66 },
      { label: 'Meio Médio', maxKg: 73 },
      { label: 'Médio', maxKg: 81 },
      { label: 'Meio Pesado', maxKg: 90 },
      { label: 'Pesado', maxKg: null },
    ],
  },
  female: {
    pre_mirim: [
      { label: 'Super Ligeiro', maxKg: 23 },
      { label: 'Ligeiro', maxKg: 26 },
      { label: 'Meio Leve', maxKg: 29 },
      { label: 'Leve', maxKg: 32 },
      { label: 'Meio Médio', maxKg: 36 },
      { label: 'Médio', maxKg: 40 },
      { label: 'Meio Pesado', maxKg: 45 },
      { label: 'Pesado', maxKg: 50 },
      { label: 'Super Pesado', maxKg: 55 },
      { label: 'Extra Pesado', maxKg: null },
    ],
    mirim: [
      { label: 'Super Ligeiro', maxKg: 28 },
      { label: 'Ligeiro', maxKg: 30 },
      { label: 'Meio Leve', maxKg: 33 },
      { label: 'Leve', maxKg: 36 },
      { label: 'Meio Médio', maxKg: 40 },
      { label: 'Médio', maxKg: 45 },
      { label: 'Meio Pesado', maxKg: 50 },
      { label: 'Pesado', maxKg: 55 },
      { label: 'Super Pesado', maxKg: 60 },
      { label: 'Extra Pesado', maxKg: null },
    ],
    infantil: [
      { label: 'Super Ligeiro', maxKg: 32 },
      { label: 'Ligeiro', maxKg: 36 },
      { label: 'Meio Leve', maxKg: 40 },
      { label: 'Leve', maxKg: 44 },
      { label: 'Meio Médio', maxKg: 48 },
      { label: 'Médio', maxKg: 52 },
      { label: 'Meio Pesado', maxKg: 57 },
      { label: 'Pesado', maxKg: 63 },
      { label: 'Super Pesado', maxKg: null },
    ],
    infanto_juvenil: [
      { label: 'Super Ligeiro', maxKg: 36 },
      { label: 'Ligeiro', maxKg: 40 },
      { label: 'Meio Leve', maxKg: 44 },
      { label: 'Leve', maxKg: 48 },
      { label: 'Meio Médio', maxKg: 52 },
      { label: 'Médio', maxKg: 57 },
      { label: 'Meio Pesado', maxKg: 63 },
      { label: 'Pesado', maxKg: 70 },
      { label: 'Super Pesado', maxKg: null },
    ],
    juvenil: [
      { label: 'Super Ligeiro', maxKg: 40 },
      { label: 'Ligeiro', maxKg: 44 },
      { label: 'Meio Leve', maxKg: 48 },
      { label: 'Leve', maxKg: 52 },
      { label: 'Meio Médio', maxKg: 57 },
      { label: 'Médio', maxKg: 63 },
      { label: 'Meio Pesado', maxKg: 70 },
      { label: 'Pesado', maxKg: null },
    ],
  },
  not_informed: {},
}

const ADULT_LADDER: Record<'male' | 'female', WeightCategory[]> = {
  male: [
    { label: 'Ligeiro', maxKg: 60 },
    { label: 'Meio Leve', maxKg: 66 },
    { label: 'Leve', maxKg: 73 },
    { label: 'Meio Médio', maxKg: 81 },
    { label: 'Médio', maxKg: 90 },
    { label: 'Meio Pesado', maxKg: 100 },
    { label: 'Pesado', maxKg: null },
  ],
  female: [
    { label: 'Ligeiro', maxKg: 48 },
    { label: 'Meio Leve', maxKg: 52 },
    { label: 'Leve', maxKg: 57 },
    { label: 'Meio Médio', maxKg: 63 },
    { label: 'Médio', maxKg: 70 },
    { label: 'Meio Pesado', maxKg: 78 },
    { label: 'Pesado', maxKg: null },
  ],
}

const ADULT_AGE_CLASSES: ReadonlySet<AgeClass> = new Set([
  'junior', 'senior', 'veteran_j1', 'veteran_j2', 'veteran_m3', 'veteran_m4', 'veteran_m5',
])

export function getWeightCategories(gender: Gender, ageClass: AgeClass): WeightCategory[] {
  if (gender === 'not_informed') {
    throw new AgeClassServiceError('Cannot determine weight categories without a specified gender')
  }
  if (ADULT_AGE_CLASSES.has(ageClass)) {
    return ADULT_LADDER[gender]
  }
  const categories = WEIGHT_CATEGORIES[gender][ageClass]
  if (!categories) {
    throw new AgeClassServiceError(`Weight categories for age class "${ageClass}" are not configured`)
  }
  return categories
}

export function assignWeightCategory(weightKg: number, gender: Gender, ageClass: AgeClass): WeightCategory {
  const categories = getWeightCategories(gender, ageClass)
  const match = categories.find((c) => c.maxKg !== null && weightKg <= c.maxKg)
  const openCategory = categories[categories.length - 1]
  if (!openCategory) {
    throw new AgeClassServiceError(`No weight categories available for ${gender}/${ageClass}`)
  }
  return match ?? openCategory
}
