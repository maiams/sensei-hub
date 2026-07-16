import type { AthleteSlot, BracketSize } from './types.js'
import { BRACKET_SIZES, BracketEngineError } from './types.js'

// Deterministic PRNG (mulberry32) — same seed always produces the same
// sequence, which is what makes generate() reproducible given the same
// input + config.seed (required for audit: "mesma entrada + mesmo seed ⇒
// mesma chave").
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function smallestBracketSize(athleteCount: number): BracketSize {
  const found = BRACKET_SIZES.find((s) => s >= athleteCount)
  if (!found) {
    throw new BracketEngineError(`No bracket size fits ${athleteCount} athletes (max is 128)`)
  }
  return found
}

// The standard recursive tournament-seeding permutation: seed 1 and seed 2
// always land in opposite halves (meeting only in the final, if both win out),
// seeds 3/4 in the middle of each half, and so on. Returns an array indexed
// by bracket position (0-based) whose value is the seed number (1-based)
// that belongs there.
//
// Also protects the top seeds with byes "for free": when there are fewer
// real athletes than bracket slots, the empty slots are always the
// highest (worst) seed numbers, which this permutation places next to the
// best-protected seeds in round 1 — see seeding.test.ts for the worked
// example.
export function seedPositions(size: BracketSize): number[] {
  let order = [1]
  while (order.length < size) {
    const n = order.length * 2
    const next: number[] = []
    for (const s of order) {
      next.push(s, n + 1 - s)
    }
    order = next
  }
  return order
}

export interface SlotAssignment {
  slots: AthleteSlot[] // index = bracket position (0-based), length = size
}

// Places athletes into bracket positions: explicitly seeded athletes go to
// their standard seeding position; unseeded athletes fill the remaining
// seed numbers in a deterministic order (by input order, then shuffled
// deterministically by `prngSeed` only to decide ties among unseeded
// athletes — see docs/zempo-modelos/chave-eliminacao.md "ou sorteio").
// Empty slots (byes) are left as null.
//
// Then applies a best-effort, deterministic same-club separation pass on
// round 1: swaps unseeded athletes' slots to avoid same-club pairings when
// possible. Seeded athletes' positions are never moved — their placement is
// a competitive protection, not just a draw convenience — so a same-club
// pairing that's forced by two SEEDED athletes landing adjacent cannot be
// resolved by this pass (documented limitation, see bracket tests).
export function assignSlots(athletes: AthleteSlot[], size: BracketSize, prngSeed: number): SlotAssignment {
  if (athletes.length > size) {
    throw new BracketEngineError(`${athletes.length} athletes do not fit in a bracket of size ${size}`)
  }
  const order = seedPositions(size)

  const seeded = athletes.filter((a) => a.seed !== null).sort((a, b) => (a.seed as number) - (b.seed as number))
  const seededNumbers = new Set(seeded.map((a) => a.seed as number))
  const dup = seeded.find((a, i) => i > 0 && a.seed === seeded[i - 1]!.seed)
  if (dup) {
    throw new BracketEngineError(`Duplicate seed number: ${dup.seed}`)
  }

  const unseeded = athletes.filter((a) => a.seed === null)
  const shuffled = deterministicShuffle(unseeded, prngSeed)

  // Assign every real athlete a "virtual seed" 1..athletes.length: explicit
  // seeds keep their number, unseeded athletes fill the gaps in ascending
  // order.
  const bySeed = new Map<number, AthleteSlot>()
  for (const a of seeded) bySeed.set(a.seed as number, a)
  let nextGap = 1
  for (const a of shuffled) {
    while (seededNumbers.has(nextGap)) nextGap++
    bySeed.set(nextGap, a)
    nextGap++
  }

  const slots: (AthleteSlot | null)[] = new Array(size).fill(null)
  for (const [seedNum, athlete] of bySeed) {
    const position = order.indexOf(seedNum)
    slots[position] = athlete
  }

  separateSameClubRound1(slots)

  return { slots: slots as AthleteSlot[] }
}

export function deterministicShuffle<T>(items: T[], seed: number): T[] {
  const rand = mulberry32(seed)
  const copy = [...items]
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    ;[copy[i], copy[j]] = [copy[j] as T, copy[i] as T]
  }
  return copy
}

function separateSameClubRound1(slots: (AthleteSlot | null)[]): void {
  // Only unseeded athletes are eligible to move — seeded athletes' round-1
  // positions are a competitive protection, not a convenience, so a
  // same-club collision forced by two SEEDED athletes landing adjacent is
  // left unresolved (documented limitation, covered by a test).
  const isMovable = (a: AthleteSlot | null): a is AthleteSlot => a !== null && a.seed === null
  const pairStart = (i: number) => (i % 2 === 0 ? i : i - 1)

  for (let i = 0; i < slots.length; i += 2) {
    const a = slots[i] ?? null
    const b = slots[i + 1] ?? null
    if (!a || !b || a.clubId === null || a.clubId !== b.clubId) continue

    const movingIndex = isMovable(b) ? i + 1 : isMovable(a) ? i : null
    if (movingIndex === null) continue
    const staying = movingIndex === i + 1 ? a : b
    const moving = slots[movingIndex] as AthleteSlot

    for (let j = 0; j < slots.length; j++) {
      if (pairStart(j) === i) continue // don't swap within the same pair
      const candidate = slots[j] ?? null
      if (!isMovable(candidate)) continue

      const candidatePartnerIndex = j % 2 === 0 ? j + 1 : j - 1
      const candidatePartner = slots[candidatePartnerIndex] ?? null

      const stayingPairOk = staying.clubId === null || staying.clubId !== candidate.clubId
      const candidatePairOk =
        candidatePartner === null || candidatePartner.clubId === null || candidatePartner.clubId !== moving.clubId

      if (stayingPairOk && candidatePairOk) {
        slots[movingIndex] = candidate
        slots[j] = moving
        break
      }
    }
  }
}
