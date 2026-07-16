import { describe, it, expect } from 'vitest'
import { seedPositions, assignSlots, smallestBracketSize, mulberry32 } from '../domain/bracket/seeding.js'
import type { AthleteSlot } from '../domain/bracket/types.js'

describe('seedPositions', () => {
  it('matches the standard Chave-8 seeding table: 1v8, 4v5, 2v7, 3v6', () => {
    const order = seedPositions(8)
    expect(order).toEqual([1, 8, 4, 5, 2, 7, 3, 6])
    // Round-1 pairs (position 2i, 2i+1):
    expect([order[0], order[1]]).toEqual([1, 8])
    expect([order[2], order[3]]).toEqual([4, 5])
    expect([order[4], order[5]]).toEqual([2, 7])
    expect([order[6], order[7]]).toEqual([3, 6])
  })

  it('keeps seed 1 and seed 2 on opposite halves for every bracket size', () => {
    for (const size of [8, 16, 32, 64, 128] as const) {
      const order = seedPositions(size)
      const pos1 = order.indexOf(1)
      const pos2 = order.indexOf(2)
      expect(pos1).toBeLessThan(size / 2)
      expect(pos2).toBeGreaterThanOrEqual(size / 2)
    }
  })
})

describe('smallestBracketSize', () => {
  it('picks the smallest power of two that fits', () => {
    expect(smallestBracketSize(1)).toBe(8)
    expect(smallestBracketSize(8)).toBe(8)
    expect(smallestBracketSize(9)).toBe(16)
    expect(smallestBracketSize(17)).toBe(32)
    expect(smallestBracketSize(128)).toBe(128)
  })

  it('throws for more than 128 athletes', () => {
    expect(() => smallestBracketSize(129)).toThrow()
  })
})

function slot(athleteId: string, seed: number | null, clubId: string | null = null): AthleteSlot {
  return { athleteId, seed, clubId }
}

describe('assignSlots — byes', () => {
  it('gives byes to the top seeds first (5 real athletes in a size-8 bracket)', () => {
    const athletes = [slot('a1', 1), slot('a2', 2), slot('a3', 3), slot('a4', 4), slot('a5', 5)]
    const { slots } = assignSlots(athletes, 8, 42)
    // seedPositions(8) = [1,8,4,5,2,7,3,6] -> positions holding seed 6,7,8 are empty
    // (position index 1 => seed8, index5 => seed7, index7 => seed6)
    expect(slots[1]).toBeNull()
    expect(slots[5]).toBeNull()
    expect(slots[7]).toBeNull()
    // seeds 1..5 (the real athletes) keep their standard positions
    expect(slots[0]?.athleteId).toBe('a1')
    expect(slots[4]?.athleteId).toBe('a2')
    expect(slots[2]?.athleteId).toBe('a4')
    expect(slots[3]?.athleteId).toBe('a5')
    expect(slots[6]?.athleteId).toBe('a3')
  })
})

describe('assignSlots — unseeded athletes', () => {
  it('places unseeded athletes deterministically given the same prngSeed', () => {
    const athletes = [slot('a1', null), slot('a2', null), slot('a3', null), slot('a4', null)]
    const first = assignSlots(athletes, 8, 7)
    const second = assignSlots(athletes, 8, 7)
    expect(first.slots.map((s) => s?.athleteId ?? null)).toEqual(second.slots.map((s) => s?.athleteId ?? null))
  })

  it('produces a different draw for a different prngSeed (sanity check, not guaranteed for every seed pair)', () => {
    const athletes = [slot('a1', null), slot('a2', null), slot('a3', null), slot('a4', null), slot('a5', null), slot('a6', null)]
    const a = assignSlots(athletes, 8, 1)
    const b = assignSlots(athletes, 8, 2)
    expect(a.slots.map((s) => s?.athleteId ?? null)).not.toEqual(b.slots.map((s) => s?.athleteId ?? null))
  })

  it('rejects duplicate explicit seed numbers', () => {
    const athletes = [slot('a1', 1), slot('a2', 1)]
    expect(() => assignSlots(athletes, 8, 1)).toThrow()
  })

  it('rejects more athletes than the bracket size', () => {
    const athletes = Array.from({ length: 9 }, (_, i) => slot(`a${i}`, null))
    expect(() => assignSlots(athletes, 8, 1)).toThrow()
  })
})

describe('assignSlots — same-club separation', () => {
  it('separates two unseeded athletes from the same club that would otherwise meet in round 1', () => {
    // a1/a2 are seeded (protected, fixed positions). The rest are unseeded
    // and two of them (u1, u2) share a club — force a scenario where a
    // naive draw could pair them by giving a deterministic seed where they
    // would otherwise land in the same round-1 pair.
    const athletes = [
      slot('seed1', 1),
      slot('seed2', 2),
      slot('u1', null, 'clubX'),
      slot('u2', null, 'clubX'),
      slot('u3', null, 'clubY'),
      slot('u4', null, 'clubZ'),
    ]
    // Try a range of seeds; the separation pass must hold for all of them
    // since the whole point is it's not left to chance.
    for (let prngSeed = 0; prngSeed < 20; prngSeed++) {
      const { slots } = assignSlots(athletes, 8, prngSeed)
      for (let i = 0; i < slots.length; i += 2) {
        const a = slots[i]
        const b = slots[i + 1]
        if (a?.clubId && b?.clubId) {
          expect(a.clubId, `seed ${prngSeed}: ${a.athleteId} vs ${b.athleteId}`).not.toBe(b.clubId)
        }
      }
    }
  })

  it('cannot separate two SEEDED athletes from the same club forced adjacent — documented limitation', () => {
    // Under seedPositions(8) = [1,8,4,5,2,7,3,6], seeds 4 and 5 always share
    // round-1 pair (positions 2,3). If both are explicitly seeded, the
    // separation pass must not move them (their positions are protected),
    // so the collision stands — that's the accepted limitation.
    const athletes = [slot('seed4', 4, 'clubX'), slot('seed5', 5, 'clubX')]
    const { slots } = assignSlots(athletes, 8, 1)
    expect(slots[2]?.athleteId).toBe('seed4')
    expect(slots[3]?.athleteId).toBe('seed5')
  })
})

describe('mulberry32', () => {
  it('is deterministic for the same seed', () => {
    const a = mulberry32(123)
    const b = mulberry32(123)
    expect(a()).toBe(b())
    expect(a()).toBe(b())
  })
})
