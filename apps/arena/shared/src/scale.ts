import { z } from 'zod'

// GET /api/scale/reading — result of ScaleAdapter.getLatestReading() (see
// apps/arena/server/src/adapters/ScaleAdapter.ts). Not tied to a specific
// event: a physical scale at the venue just reports its latest reading: the
// operator picks which athlete/entry it belongs to and confirms manually
// before it becomes an official WeightRecord (CLAUDE.md Weigh-In
// Integration — "all readings must be confirmable by an operator").
export const ScaleReadingDTO = z.object({
  connected: z.boolean(),
  reading: z
    .object({
      weightKg: z.number().positive(),
      timestamp: z.string().datetime(),
    })
    .nullable(),
})
export type ScaleReadingDTO = z.infer<typeof ScaleReadingDTO>
