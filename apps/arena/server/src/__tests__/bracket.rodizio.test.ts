import { describe, it, expect } from 'vitest'
import { RodizioEngine } from '../domain/bracket/RodizioEngine.js'
import type { AthleteSlot, BracketState, Match } from '../domain/bracket/types.js'

function seededAthletes(n: number): AthleteSlot[] {
  return Array.from({ length: n }, (_, i) => ({ athleteId: `a${i + 1}`, seed: i + 1, clubId: null }))
}

function applyUpdates(state: BracketState, updates: Match[]): BracketState {
  const matches = state.matches.map((m) => updates.find((u) => u.matchNumber === m.matchNumber) ?? m)
  return { ...state, matches }
}

function win(
  engine: RodizioEngine,
  state: BracketState,
  matchNumber: number,
  winnerId: string,
  points = 10,
): BracketState {
  const { updatedMatches } = engine.advanceMatch(state, { matchNumber, winnerId, isWalkover: false, points })
  return applyUpdates(state, updatedMatches)
}

describe('RodizioEngine.generate — fixed schedules', () => {
  const engine = new RodizioEngine()

  it('Rodízio-3: 1-2, 1-3, 2-3', () => {
    const state = engine.generate(seededAthletes(3), { format: 'rodizio' })
    expect(state.matches.map((m) => [m.athleteAId, m.athleteBId])).toEqual([
      ['a1', 'a2'],
      ['a1', 'a3'],
      ['a2', 'a3'],
    ])
  })

  it('Rodízio-4: 6 matches in the documented order', () => {
    const state = engine.generate(seededAthletes(4), { format: 'rodizio' })
    expect(state.matches.map((m) => [m.athleteAId, m.athleteBId])).toEqual([
      ['a1', 'a2'],
      ['a3', 'a4'],
      ['a1', 'a4'],
      ['a2', 'a3'],
      ['a1', 'a3'],
      ['a2', 'a4'],
    ])
  })

  it('Rodízio-5: 10 matches in the documented order', () => {
    const state = engine.generate(seededAthletes(5), { format: 'rodizio' })
    expect(state.matches).toHaveLength(10)
    expect(state.matches.map((m) => [m.athleteAId, m.athleteBId])).toEqual([
      ['a1', 'a2'],
      ['a3', 'a4'],
      ['a1', 'a5'],
      ['a2', 'a3'],
      ['a4', 'a5'],
      ['a1', 'a3'],
      ['a2', 'a4'],
      ['a3', 'a5'],
      ['a1', 'a4'],
      ['a2', 'a5'],
    ])
  })

  it('Rodízio-6: 15 matches in the documented order', () => {
    const state = engine.generate(seededAthletes(6), { format: 'rodizio' })
    expect(state.matches).toHaveLength(15)
    expect(state.matches[0]).toMatchObject({ athleteAId: 'a1', athleteBId: 'a2' })
    expect(state.matches[14]).toMatchObject({ athleteAId: 'a3', athleteBId: 'a5' })
  })

  it('rejects sizes outside 3-6', () => {
    expect(() => engine.generate(seededAthletes(2), { format: 'rodizio' })).toThrow()
    expect(() => engine.generate(seededAthletes(7), { format: 'rodizio' })).toThrow()
  })

  it('every match is ready immediately (no bracket dependency)', () => {
    const state = engine.generate(seededAthletes(4), { format: 'rodizio' })
    expect(engine.getReadyMatches(state)).toHaveLength(6)
  })

  it('has no repechage', () => {
    const state = engine.generate(seededAthletes(4), { format: 'rodizio' })
    expect(() => engine.calculateRepechage(state, 'normal', [])).toThrow()
  })
})

describe('RodizioEngine.getFinalRankings — Rodízio-3', () => {
  const engine = new RodizioEngine()

  it('ranks purely by wins when there are no ties', () => {
    let state = engine.generate(seededAthletes(3), { format: 'rodizio' })
    state = win(engine, state, 1, 'a1') // a1 beats a2
    state = win(engine, state, 2, 'a1') // a1 beats a3
    state = win(engine, state, 3, 'a2') // a2 beats a3
    const rankings = engine.getFinalRankings(state)
    expect(rankings.find((r) => r.athleteId === 'a1')?.place).toBe(1) // 2 wins
    expect(rankings.find((r) => r.athleteId === 'a2')?.place).toBe(2) // 1 win
    expect(rankings.find((r) => r.athleteId === 'a3')?.place).toBe(3) // 0 wins
  })

  it('breaks a win-tie with accumulated points', () => {
    let state = engine.generate(seededAthletes(3), { format: 'rodizio' })
    // a1 and a2 both end with 1 win; a2 scores more points in its win
    state = win(engine, state, 1, 'a1', 7) // a1 beats a2 (waza-ari)
    state = win(engine, state, 2, 'a3', 10) // a3 beats a1
    state = win(engine, state, 3, 'a2', 10) // a2 beats a3 (ippon)
    const rankings = engine.getFinalRankings(state)
    // wins: a1=1, a2=1, a3=1 -> all tied on wins! points: a1=7, a2=10, a3=10
    // a2 and a3 tied on wins+points -> head-to-head: a2 beat a3 in match3
    const place = (id: string) => rankings.find((r) => r.athleteId === id)?.place
    expect(place('a2')).toBe(1)
    expect(place('a3')).toBe(2)
    expect(place('a1')).toBe(3)
  })

  it('breaks a full win+points tie with a deterministic draw', () => {
    let state = engine.generate(seededAthletes(3), { format: 'rodizio', seed: 5 })
    // Force a 3-way cycle with identical wins(1) and points(10) each:
    // a1 > a2, a2 > a3, a3 > a1
    state = win(engine, state, 1, 'a1', 10)
    state = win(engine, state, 2, 'a3', 10)
    state = win(engine, state, 3, 'a2', 10)
    const first = engine.getFinalRankings(state)
    const second = engine.getFinalRankings(state)
    expect(first).toEqual(second) // deterministic given the same seed
    expect(first.map((r) => r.place).sort()).toEqual([1, 2, 3])
  })
})

describe('RodizioEngine — advanceMatch validation', () => {
  const engine = new RodizioEngine()

  it('rejects a non-participant winner and a repeated result', () => {
    const state = engine.generate(seededAthletes(3), { format: 'rodizio' })
    expect(() => engine.advanceMatch(state, { matchNumber: 1, winnerId: 'a3', isWalkover: false })).toThrow()
    const after = win(engine, state, 1, 'a1')
    expect(() => engine.advanceMatch(after, { matchNumber: 1, winnerId: 'a1', isWalkover: false })).toThrow()
  })
})
