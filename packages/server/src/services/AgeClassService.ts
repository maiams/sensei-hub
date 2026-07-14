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

// Reference: docs/zempo-modelos/campos-cadastro-atleta.md — "Classes Etárias".
// The 21–29 boundary for `senior` is this codebase's own assumption: the source
// table lists senior as "15+ (open adult)", which overlaps every youth/veteran
// bracket by design in real tournaments (an athlete can often enter more than one
// class). For a *single derived class per age* we need a strict partition, so we
// fill the adult gap between junior (ends at 20) and veteran_j1 (starts at 30)
// with senior. Revisit if a specific federation's rule differs.
const AGE_BOUNDARIES: AgeBoundary[] = [
  { ageClass: 'pre_mirim', minAge: 7, maxAge: 9 },
  { ageClass: 'mirim', minAge: 10, maxAge: 11 },
  { ageClass: 'infantil', minAge: 12, maxAge: 13 },
  { ageClass: 'infanto_juvenil', minAge: 14, maxAge: 15 },
  { ageClass: 'juvenil', minAge: 16, maxAge: 17 },
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

// Standard IJF/CBJ senior weight categories. Veteran classes compete under the
// same ladder as senior in CBJ rules. Junior is treated the same as senior here
// as a reasonable default — some state federations use slightly narrower junior
// brackets; adjust this table if yours differs.
const ADULT_CATEGORIES: Record<Gender, WeightCategory[]> = {
  male: [
    { label: 'Leve Extra', maxKg: 60 },
    { label: 'Meio-Leve', maxKg: 66 },
    { label: 'Leve', maxKg: 73 },
    { label: 'Meio-Médio', maxKg: 81 },
    { label: 'Médio', maxKg: 90 },
    { label: 'Meio-Pesado', maxKg: 100 },
    { label: 'Pesado', maxKg: null },
  ],
  female: [
    { label: 'Ligeiro', maxKg: 48 },
    { label: 'Meio-Leve', maxKg: 52 },
    { label: 'Leve', maxKg: 57 },
    { label: 'Meio-Médio', maxKg: 63 },
    { label: 'Médio', maxKg: 70 },
    { label: 'Meio-Pesado', maxKg: 78 },
    { label: 'Pesado', maxKg: null },
  ],
  // No official not_informed ladder — the operator must record a specific gender
  // before a weight category can be assigned.
  not_informed: [],
}

const ADULT_AGE_CLASSES: ReadonlySet<AgeClass> = new Set([
  'junior', 'senior', 'veteran_j1', 'veteran_j2', 'veteran_m3', 'veteran_m4', 'veteran_m5',
])

// Youth weight categories (pre_mirim through juvenil) are intentionally NOT
// hardcoded here: they vary by state federation and by season, and publishing
// wrong numbers for a real tournament misclassifying children is worse than
// failing loudly. Configure them explicitly (e.g. via event/division setup in
// Fase 3A) before running a youth event through this function.
export function getWeightCategories(gender: Gender, ageClass: AgeClass): WeightCategory[] {
  if (gender === 'not_informed') {
    throw new AgeClassServiceError('Cannot determine weight categories without a specified gender')
  }
  if (!ADULT_AGE_CLASSES.has(ageClass)) {
    throw new AgeClassServiceError(
      `Weight categories for age class "${ageClass}" are not configured yet — youth brackets vary by federation`,
    )
  }
  return ADULT_CATEGORIES[gender]
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
