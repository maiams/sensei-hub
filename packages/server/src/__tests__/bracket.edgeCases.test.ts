import { describe, it, expect } from 'vitest'
import { EliminationEngine } from '../domain/bracket/EliminationEngine.js'
import { RodizioEngine } from '../domain/bracket/RodizioEngine.js'
import type { AthleteSlot, BracketState, Match } from '../domain/bracket/types.js'

function seededAthletes(n: number): AthleteSlot[] {
  return Array.from({ length: n }, (_, i) => ({ athleteId: `a${i + 1}`, seed: i + 1, clubId: null }))
}

function applyUpdates(state: BracketState, updates: Match[]): BracketState {
  const matches = state.matches.map((m) => updates.find((u) => u.matchNumber === m.matchNumber) ?? m)
  for (const u of updates) {
    if (!matches.some((m) => m.matchNumber === u.matchNumber)) matches.push(u)
  }
  return { ...state, matches }
}

describe('Edge case — odd number of athletes (byes)', () => {
  it('7 athletes in a Chave-8: one bye, six real round-1 athletes', () => {
    const engine = new EliminationEngine()
    const state = engine.generate(seededAthletes(7), { format: 'elimination', size: 8 })
    const byeMatches = state.matches.filter((m) => m.round === 1 && m.byeAthleteId !== null)
    expect(byeMatches).toHaveLength(1)
    // the single bye must go to the top seed
    expect(byeMatches[0]?.byeAthleteId).toBe('a1')
    expect(engine.getReadyMatches(state).filter((m) => m.round === 1)).toHaveLength(3)
  })
})

describe('Edge case — athlete withdraws after generation (automatic WO)', () => {
  it('recording a walkover result advances the remaining athlete like any other win', () => {
    const engine = new EliminationEngine()
    const state = engine.generate(seededAthletes(8), { format: 'elimination', size: 8 })
    // a8 withdraws before match 1 is fought — the operator records a WO for a1
    const { updatedMatches } = engine.advanceMatch(state, { matchNumber: 1, winnerId: 'a1', isWalkover: true })
    const m1 = updatedMatches.find((m) => m.matchNumber === 1)
    expect(m1?.result).toEqual({ winnerId: 'a1', isWalkover: true })
    const sf5 = updatedMatches.find((m) => m.matchNumber === 5)
    expect(sf5?.athleteAId).toBe('a1') // still advances normally
  })
})

describe('Edge case — determinism', () => {
  it('generate() is byte-for-byte identical given the same athletes, config and seed (elimination)', () => {
    const engine = new EliminationEngine()
    const athletes = [
      { athleteId: 'a1', seed: 1, clubId: 'x' },
      { athleteId: 'a2', seed: null, clubId: 'y' },
      { athleteId: 'a3', seed: null, clubId: 'x' },
      { athleteId: 'a4', seed: 4, clubId: null },
      { athleteId: 'a5', seed: null, clubId: null },
    ]
    const config = { format: 'elimination' as const, seed: 2026 }
    expect(engine.generate(athletes, config)).toEqual(engine.generate(athletes, config))
  })

  it('generate() is byte-for-byte identical given the same athletes, config and seed (rodizio)', () => {
    const engine = new RodizioEngine()
    const athletes = seededAthletes(5)
    const config = { format: 'rodizio' as const, seed: 777 }
    expect(engine.generate(athletes, config)).toEqual(engine.generate(athletes, config))
  })
})

describe('Edge case — Rodízio with a resolvable triple tie (confronto direto)', () => {
  it('a 3-way tie on wins+points is broken by wins within the tied group, not the draw', () => {
    const engine = new RodizioEngine()
    let state = engine.generate(seededAthletes(5), { format: 'rodizio', seed: 1 })
    const win = (m: number, id: string) => {
      state = applyUpdates(
        state,
        engine.advanceMatch(state, { matchNumber: m, winnerId: id, isWalkover: false, points: 10 }).updatedMatches,
      )
    }
    // Rodízio-5 schedule: [1,2],[3,4],[1,5],[2,3],[4,5],[1,3],[2,4],[3,5],[1,4],[2,5]
    win(1, 'a1') // a1 > a2
    win(2, 'a3') // a3 > a4
    win(3, 'a5') // a5 > a1
    win(4, 'a2') // a2 > a3
    win(5, 'a5') // a5 > a4
    win(6, 'a1') // a1 > a3
    win(7, 'a2') // a2 > a4
    win(8, 'a3') // a3 > a5
    win(9, 'a4') // a4 > a1
    win(10, 'a5') // a5 > a2

    // wins: a5=3 (clear 1st), a1=a2=a3=2 each (tied, 20pts each), a4=1 (clear last)
    // within the {a1,a2,a3} tied group: a1 beat both a2 and a3 (2 within-group
    // wins), a2 beat only a3 (1), a3 beat neither (0) — fully resolvable,
    // no cycle, so confronto direto alone decides it.
    const rankings = engine.getFinalRankings(state)
    const place = (id: string) => rankings.find((r) => r.athleteId === id)?.place
    expect(place('a5')).toBe(1)
    expect(place('a1')).toBe(2)
    expect(place('a2')).toBe(3)
    expect(place('a3')).toBe(4)
    expect(place('a4')).toBe(5)
  })
})
