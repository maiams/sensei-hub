import { describe, it, expect } from 'vitest'
import { EliminationEngine } from '../domain/bracket/EliminationEngine.js'
import type { AthleteSlot, BracketState, Match } from '../domain/bracket/types.js'

// Regression coverage for a real bug found while exercising the elimination
// engine end-to-end against seeded event data (Chave-8, 5 confirmed
// entries): EliminationEngine.generate() used to resolve a match as a
// "phantom" (bye/void — nobody needs to fight, the outcome is already
// known) purely by checking "exactly one side is currently filled",
// without checking WHY the other side was empty. For round 1 that's a safe
// check (fill status there is 100% structural). But for round 2+, a slot
// can *also* be empty simply because the real round-1 match feeding it
// hasn't been played yet — which is completely different from "this slot
// will never be filled". The bug: a round-1 bye recipient was auto-advanced
// straight into the NEXT round's slot (and, if the other bracket half
// finished first, all the way into an apparently-"ready" FINAL) before
// their true semifinal opponent had even been decided by a real fight.
//
// See the fix in EliminationEngine.generate() (the `phantom` Set) — a
// downstream match is only resolved early when BOTH its feeders are
// themselves already phantom (bye or double-bye), never when a feeder is a
// genuine two-athlete contest awaiting a real result.

function seededAthletes(n: number, prefix = 'a'): AthleteSlot[] {
  return Array.from({ length: n }, (_, i) => ({ athleteId: `${prefix}${i + 1}`, seed: i + 1, clubId: null }))
}

function findByNumber(state: BracketState, matchNumber: number): Match {
  const m = state.matches.find((mm) => mm.matchNumber === matchNumber)
  if (!m) throw new Error(`match ${matchNumber} not found`)
  return m
}

function applyUpdates(state: BracketState, updates: Match[]): BracketState {
  const matches = state.matches.map((m) => updates.find((u) => u.matchNumber === m.matchNumber) ?? m)
  return { ...state, matches }
}

function win(engine: EliminationEngine, state: BracketState, matchNumber: number, winnerId: string): BracketState {
  const { updatedMatches } = engine.advanceMatch(state, { matchNumber, winnerId, isWalkover: false })
  return applyUpdates(state, updatedMatches)
}

describe('EliminationEngine — bye/real-match boundary (regression)', () => {
  const engine = new EliminationEngine()

  it('5 athletes in a Chave-8: the bye recipient must NOT be pre-advanced into the final before their real semifinal is decided', () => {
    const state = engine.generate(seededAthletes(5), { format: 'elimination', size: 8 })

    // Round-1: seed1 byes (match1), seed4 vs seed5 real (match2), seed2 byes
    // (match3), seed3 byes (match4).
    expect(findByNumber(state, 1).byeAthleteId).toBe('a1')
    expect(findByNumber(state, 2).byeAthleteId).toBeNull()

    // SF5 (fed by match1's bye + match2's still-undecided real result) must
    // stay pending: no premature byeAthleteId, and nothing propagated into
    // the final.
    const sf5 = findByNumber(state, 5)
    expect(sf5.athleteAId).toBe('a1') // the bye winner's slot IS filled
    expect(sf5.athleteBId).toBeNull() // ...but the real opponent isn't decided yet
    expect(sf5.byeAthleteId).toBeNull() // must NOT be resolved as a bye

    const final = findByNumber(state, 7)
    expect(final.athleteAId).toBeNull() // must NOT be pre-filled
    expect(final.athleteBId).toBeNull()
    expect(engine.getReadyMatches(state).map((m) => m.matchNumber)).not.toContain(7)

    // Play it out for real: match2 decides who a1 actually has to fight.
    let s = win(engine, state, 2, 'a4')
    let sf5After = findByNumber(s, 5)
    expect(sf5After.athleteAId).toBe('a1')
    expect(sf5After.athleteBId).toBe('a4') // now a genuine, fightable semifinal

    // The other branch (both byes) was correctly a real, immediately
    // playable semifinal from the start.
    s = win(engine, s, 6, 'a2')

    // Even with the OTHER semifinal already decided, the final must still
    // not be ready — SF5 (a1 vs a4) hasn't been fought yet.
    expect(engine.getReadyMatches(s).map((m) => m.matchNumber)).not.toContain(7)

    s = win(engine, s, 5, 'a1')
    // Only now, with BOTH real semifinals actually decided, is the final ready.
    expect(engine.getReadyMatches(s).map((m) => m.matchNumber)).toContain(7)

    s = win(engine, s, 7, 'a1')
    const rankings = engine.getFinalRankings(s)
    const place = (id: string) => rankings.find((r) => r.athleteId === id)?.place
    expect(place('a1')).toBe(1)
    expect(place('a2')).toBe(2)
    expect(place('a4')).toBe(3)
  })

  it('6 athletes in a Chave-8: BOTH bye-fed semifinal slots must stay pending on their real feeder, not just one', () => {
    const state = engine.generate(seededAthletes(6), { format: 'elimination', size: 8 })
    // seedPositions(8)=[1,8,4,5,2,7,3,6]: match1=bye(seed1), match2=seed4 vs
    // seed5 (real), match3=bye(seed2), match4=seed3 vs seed6 (real).
    expect(findByNumber(state, 1).byeAthleteId).toBe('a1')
    expect(findByNumber(state, 2).byeAthleteId).toBeNull()
    expect(findByNumber(state, 3).byeAthleteId).toBe('a2')
    expect(findByNumber(state, 4).byeAthleteId).toBeNull()

    for (const mn of [5, 6]) {
      const sf = findByNumber(state, mn)
      expect(sf.byeAthleteId).toBeNull()
    }
    const final = findByNumber(state, 7)
    expect(final.athleteAId).toBeNull()
    expect(final.athleteBId).toBeNull()

    let s = win(engine, state, 2, 'a4')
    let s2 = win(engine, s, 4, 'a3')
    expect(findByNumber(s2, 5).athleteBId).toBe('a4')
    expect(findByNumber(s2, 6).athleteBId).toBe('a3')
    // still nothing in the final — both semifinals are real and undecided
    expect(findByNumber(s2, 7).athleteAId).toBeNull()
    expect(findByNumber(s2, 7).athleteBId).toBeNull()

    s2 = win(engine, s2, 5, 'a1')
    s2 = win(engine, s2, 6, 'a2')
    const finalReady = findByNumber(s2, 7)
    expect(finalReady.athleteAId).toBe('a1')
    expect(finalReady.athleteBId).toBe('a2')

    s2 = win(engine, s2, 7, 'a1')
    const rankings = engine.getFinalRankings(s2)
    expect(rankings.find((r) => r.athleteId === 'a1')?.place).toBe(1)
    expect(rankings.find((r) => r.athleteId === 'a2')?.place).toBe(2)
  })

  it('remains deterministic after the fix: same athletes + seed + size produce an identical bracket, byes included', () => {
    const athletes = seededAthletes(5, 'x')
    const config = { format: 'elimination' as const, size: 8 as const, seed: 555 }
    const a = engine.generate(athletes, config)
    const b = engine.generate(athletes, config)
    expect(a).toEqual(b)
  })

  it('a pure double-bye chain (2 athletes in a Chave-8) is unaffected by the fix — still auto-advances with no real match ever pending', () => {
    const state = engine.generate(seededAthletes(2, 'y'), { format: 'elimination', size: 8 })
    const final = findByNumber(state, 7)
    expect(final.athleteAId).toBe('y1')
    expect(final.athleteBId).toBe('y2')
    expect(engine.getReadyMatches(state).map((m) => m.matchNumber)).toEqual([7])
  })
})
