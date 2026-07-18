import { z } from 'zod'

// Judo-wide vocabulary used by both products: the dojo keeps the athlete's
// belt progression, the arena uses belt/gender for divisions and seeding, and
// both record weights (dojo tracking vs. event weigh-in).
export const BELT_VALUES = [
  'white', 'burgundy', 'gray', 'blue', 'yellow', 'orange', 'green', 'purple', 'brown',
  'black-1dan', 'black-2dan', 'black-3dan', 'black-4dan', 'black-5dan',
  'coral-6dan', 'coral-7dan', 'coral-8dan',
  'red-9dan', 'red-10dan',
] as const

export const Belt = z.enum(BELT_VALUES)
export type Belt = z.infer<typeof Belt>

export const Gender = z.enum(['male', 'female', 'not_informed'])
export type Gender = z.infer<typeof Gender>

export const WeightSource = z.enum(['manual', 'scale', 'import', 'corrected'])
export type WeightSource = z.infer<typeof WeightSource>
