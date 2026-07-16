import type { AthleteSlot } from './types.js'
import { BracketEngineError } from './types.js'
import { deterministicShuffle } from './seeding.js'

export type RodizioSize = 3 | 4 | 5 | 6

// Fixed fight orders from docs/zempo-modelos/rodizio.md, chosen to spread
// rest between an athlete's consecutive bouts as evenly as possible. Pairs
// are 1-based athlete positions (position 1 = best seed).
export const RODIZIO_SCHEDULES: Record<RodizioSize, Array<[number, number]>> = {
  3: [
    [1, 2],
    [1, 3],
    [2, 3],
  ],
  4: [
    [1, 2],
    [3, 4],
    [1, 4],
    [2, 3],
    [1, 3],
    [2, 4],
  ],
  5: [
    [1, 2],
    [3, 4],
    [1, 5],
    [2, 3],
    [4, 5],
    [1, 3],
    [2, 4],
    [3, 5],
    [1, 4],
    [2, 5],
  ],
  6: [
    [1, 2],
    [3, 4],
    [5, 6],
    [1, 3],
    [4, 5],
    [2, 6],
    [1, 4],
    [2, 5],
    [3, 6],
    [1, 5],
    [4, 6],
    [2, 3],
    [1, 6],
    [2, 4],
    [3, 5],
  ],
}

export function isRodizioSize(n: number): n is RodizioSize {
  return n === 3 || n === 4 || n === 5 || n === 6
}

// Same "explicit seed keeps its number, unseeded fills the gaps
// deterministically" convention as elimination's assignSlots, minus the
// bracket-size/byes/club-separation concerns rodizio doesn't have.
export function orderRodizioAthletes(athletes: AthleteSlot[], prngSeed: number): AthleteSlot[] {
  const seeded = athletes.filter((a) => a.seed !== null).sort((a, b) => (a.seed as number) - (b.seed as number))
  const seededNumbers = new Set(seeded.map((a) => a.seed as number))
  const dup = seeded.find((a, i) => i > 0 && a.seed === seeded[i - 1]!.seed)
  if (dup) {
    throw new BracketEngineError(`Duplicate seed number: ${dup.seed}`)
  }

  const unseeded = deterministicShuffle(
    athletes.filter((a) => a.seed === null),
    prngSeed,
  )

  const bySeed = new Map<number, AthleteSlot>()
  for (const a of seeded) bySeed.set(a.seed as number, a)
  let nextGap = 1
  for (const a of unseeded) {
    while (seededNumbers.has(nextGap)) nextGap++
    bySeed.set(nextGap, a)
    nextGap++
  }

  const order: AthleteSlot[] = []
  for (let i = 1; i <= athletes.length; i++) {
    const a = bySeed.get(i)
    if (!a) throw new BracketEngineError(`Missing athlete for position ${i}`)
    order.push(a)
  }
  return order
}
