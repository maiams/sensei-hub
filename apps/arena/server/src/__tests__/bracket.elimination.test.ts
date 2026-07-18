import { describe, it, expect } from 'vitest'
import { EliminationEngine } from '../domain/bracket/EliminationEngine.js'
import type { AthleteSlot, BracketState, Match, RepechageType } from '../domain/bracket/types.js'

function seededAthletes(n: number): AthleteSlot[] {
  return Array.from({ length: n }, (_, i) => ({ athleteId: `seed${i + 1}`, seed: i + 1, clubId: null }))
}

function findByNumber(state: BracketState, matchNumber: number): Match {
  const m = state.matches.find((mm) => mm.matchNumber === matchNumber)
  if (!m) throw new Error(`match ${matchNumber} not found in state`)
  return m
}

function applyUpdates(state: BracketState, updates: Match[]): BracketState {
  const matches = state.matches.map((m) => updates.find((u) => u.matchNumber === m.matchNumber) ?? m)
  for (const u of updates) {
    if (!matches.some((m) => m.matchNumber === u.matchNumber)) matches.push(u)
  }
  return { ...state, matches }
}

function win(engine: EliminationEngine, state: BracketState, matchNumber: number, winnerId: string): BracketState {
  const { updatedMatches } = engine.advanceMatch(state, { matchNumber, winnerId, isWalkover: false })
  return applyUpdates(state, updatedMatches)
}

describe('EliminationEngine.generate — Chave-8 structure', () => {
  const engine = new EliminationEngine()

  it('numbers matches 1-7 for 8 seeded athletes and pairs by the standard seeding table', () => {
    const state = engine.generate(seededAthletes(8), { format: 'elimination', size: 8 })
    expect(state.matches.filter((m) => m.stage === 'round')).toHaveLength(7)

    const m1 = findByNumber(state, 1)
    const m2 = findByNumber(state, 2)
    const m3 = findByNumber(state, 3)
    const m4 = findByNumber(state, 4)
    expect([m1.athleteAId, m1.athleteBId]).toEqual(['seed1', 'seed8'])
    expect([m2.athleteAId, m2.athleteBId]).toEqual(['seed4', 'seed5'])
    expect([m3.athleteAId, m3.athleteBId]).toEqual(['seed2', 'seed7'])
    expect([m4.athleteAId, m4.athleteBId]).toEqual(['seed3', 'seed6'])

    expect(m1.nextMatchNumber).toBe(5)
    expect(m1.nextMatchSlot).toBe('A')
    expect(m2.nextMatchNumber).toBe(5)
    expect(m2.nextMatchSlot).toBe('B')
    expect(m3.nextMatchNumber).toBe(6)
    expect(m4.nextMatchNumber).toBe(6)

    const final = findByNumber(state, 7)
    expect(final.round).toBe(3)
    expect(final.nextMatchNumber).toBeNull()
  })

  it('getReadyMatches returns only round-1 matches initially', () => {
    const state = engine.generate(seededAthletes(8), { format: 'elimination', size: 8 })
    const ready = engine.getReadyMatches(state)
    expect(ready.map((m) => m.matchNumber).sort()).toEqual([1, 2, 3, 4])
  })

  it('is deterministic: same athletes + same seed produce an identical bracket', () => {
    const athletes = seededAthletes(6)
    const a = engine.generate(athletes, { format: 'elimination', seed: 99 })
    const b = engine.generate(athletes, { format: 'elimination', seed: 99 })
    expect(a).toEqual(b)
  })

  it('auto-selects the smallest bracket size that fits when size is omitted', () => {
    const state = engine.generate(seededAthletes(9), { format: 'elimination' })
    expect(state.size).toBe(16)
  })

  it('rejects fewer than 2 athletes', () => {
    expect(() => engine.generate(seededAthletes(1), { format: 'elimination' })).toThrow()
  })
})

describe('EliminationEngine — byes', () => {
  const engine = new EliminationEngine()

  it('gives the top 3 seeds a bye when 5 athletes fill a Chave-8', () => {
    const state = engine.generate(seededAthletes(5), { format: 'elimination', size: 8 })
    // seedPositions(8) = [1,8,4,5,2,7,3,6] -> only seeds 1..5 are real;
    // matches: (seed1,bye)->bye seed1; (seed4,seed5)->real match;
    // (seed2,bye)->bye seed2; (seed3,bye)->bye seed3.
    expect(findByNumber(state, 1).byeAthleteId).toBe('seed1')
    expect(findByNumber(state, 2).byeAthleteId).toBeNull() // seed4 vs seed5, real match
    expect(findByNumber(state, 3).byeAthleteId).toBe('seed2')
    expect(findByNumber(state, 4).byeAthleteId).toBe('seed3')

    // byes already propagated into the semifinal — SF6 (seed2 vs seed3) is
    // in fact immediately playable too, since both its feeders were byes
    expect(findByNumber(state, 5).athleteAId).toBe('seed1')
    expect(findByNumber(state, 6).athleteAId).toBe('seed2')
    expect(findByNumber(state, 6).athleteBId).toBe('seed3')

    const ready = engine.getReadyMatches(state)
    expect(ready.map((m) => m.matchNumber).sort()).toEqual([2, 6])
  })

  it('cascades a double bye through two rounds when only 2 athletes fill a Chave-8', () => {
    const state = engine.generate(seededAthletes(2), { format: 'elimination', size: 8 })
    // seed1 (pos0) byes match1; match2 (pos2,pos3) is a double bye (both empty);
    // seed2 (pos4) byes match3; match4 is a double bye.
    expect(findByNumber(state, 1).byeAthleteId).toBe('seed1')
    expect(findByNumber(state, 2).byeAthleteId).toBeNull()
    expect(findByNumber(state, 2).athleteAId).toBeNull()
    expect(findByNumber(state, 3).byeAthleteId).toBe('seed2')

    // SF5 = seed1 vs (nobody from match2) -> itself a bye for seed1
    const sf5 = findByNumber(state, 5)
    expect(sf5.athleteAId).toBe('seed1')
    expect(sf5.athleteBId).toBeNull()
    expect(sf5.byeAthleteId).toBe('seed1')

    // The two survivors meet for real in the final
    const final = findByNumber(state, 7)
    expect(final.athleteAId).toBe('seed1')
    expect(final.athleteBId).toBe('seed2')
    expect(engine.getReadyMatches(state).map((m) => m.matchNumber)).toEqual([7])
  })
})

describe('EliminationEngine — advanceMatch', () => {
  const engine = new EliminationEngine()

  it('rejects a winner who is not a participant, a repeat result, and an unready match', () => {
    const state = engine.generate(seededAthletes(8), { format: 'elimination', size: 8 })
    expect(() => engine.advanceMatch(state, { matchNumber: 1, winnerId: 'seed4', isWalkover: false })).toThrow()
    expect(() => engine.advanceMatch(state, { matchNumber: 5, winnerId: 'seed1', isWalkover: false })).toThrow() // not ready
    const after = win(engine, state, 1, 'seed1')
    expect(() => engine.advanceMatch(after, { matchNumber: 1, winnerId: 'seed1', isWalkover: false })).toThrow()
  })

  it('preserves the walkover flag on the result', () => {
    const state = engine.generate(seededAthletes(8), { format: 'elimination', size: 8 })
    const { updatedMatches } = engine.advanceMatch(state, { matchNumber: 1, winnerId: 'seed1', isWalkover: true })
    expect(updatedMatches[0]?.result?.isWalkover).toBe(true)
  })
})

// Shared QF/SF playthrough used by every repechage-type test below:
//   M1 seed1 > seed8   M2 seed4 > seed5   M3 seed2 > seed7   M4 seed3 > seed6
//   SF5 seed1 > seed4  SF6 seed2 > seed3  Final seed1 > seed2
function playQfAndSf(engine: EliminationEngine, state: BracketState): BracketState {
  state = win(engine, state, 1, 'seed1')
  state = win(engine, state, 2, 'seed4')
  state = win(engine, state, 3, 'seed2')
  state = win(engine, state, 4, 'seed3')
  state = win(engine, state, 5, 'seed1')
  state = win(engine, state, 6, 'seed2')
  return state
}

function generateWith(engine: EliminationEngine, type: RepechageType): BracketState {
  return engine.generate(seededAthletes(8), { format: 'elimination', size: 8, repechageType: type })
}

describe('Repechage — nenhuma', () => {
  const engine = new EliminationEngine()

  it('two bronzes (SF losers), 5th/7th split by bracket half, no extra matches', () => {
    let state = generateWith(engine, 'nenhuma')
    state = playQfAndSf(engine, state)
    expect(state.matches.filter((m) => m.stage !== 'round')).toHaveLength(0)
    state = win(engine, state, 7, 'seed1')

    expect(engine.calculateRepechage(state, 'nenhuma', [])).toEqual([])

    const rankings = engine.getFinalRankings(state)
    const place = (id: string) => rankings.find((r) => r.athleteId === id)?.place
    expect(place('seed1')).toBe(1)
    expect(place('seed2')).toBe(2)
    expect(place('seed4')).toBe(3)
    expect(place('seed3')).toBe(3)
    expect(place('seed8')).toBe(5) // SF5's QF group
    expect(place('seed5')).toBe(5)
    expect(place('seed7')).toBe(7) // SF6's QF group
    expect(place('seed6')).toBe(7)
  })
})

describe('Repechage — simples', () => {
  const engine = new EliminationEngine()

  it('bronze match distinguishes 3rd from 4th', () => {
    let state = generateWith(engine, 'simples')
    state = playQfAndSf(engine, state)
    // bronze match (number 8) is ready once both SF losers are known
    const ready = engine.getReadyMatches(state).map((m) => m.matchNumber)
    expect(ready).toContain(8)
    const bronze = findByNumber(state, 8)
    expect([bronze.athleteAId, bronze.athleteBId].sort()).toEqual(['seed3', 'seed4'])

    state = win(engine, state, 8, 'seed4')
    state = win(engine, state, 7, 'seed1')

    const rankings = engine.getFinalRankings(state)
    const place = (id: string) => rankings.find((r) => r.athleteId === id)?.place
    expect(place('seed1')).toBe(1)
    expect(place('seed2')).toBe(2)
    expect(place('seed4')).toBe(3)
    expect(place('seed3')).toBe(4)
  })
})

describe('Repechage — normal (Quartas de Final)', () => {
  const engine = new EliminationEngine()

  it('QF losers grouped by SF half fight for 5th/7th; 3rd stays with SF losers', () => {
    let state = generateWith(engine, 'normal')
    // repechage can't be computed before QF is done
    expect(engine.calculateRepechage(state, 'normal', [])).toEqual([])

    state = win(engine, state, 1, 'seed1')
    state = win(engine, state, 2, 'seed4')
    state = win(engine, state, 3, 'seed2')
    state = win(engine, state, 4, 'seed3')

    const rep1 = engine.calculateRepechage(state, 'normal', [])
    expect(rep1).toHaveLength(2)
    // group fed into SF5 (matches 1,2) -> losers seed8, seed5
    const repA = rep1.find((m) => m.groupMatchNumber === 5)!
    expect([repA.athleteAId, repA.athleteBId].sort()).toEqual(['seed5', 'seed8'])
    const repB = rep1.find((m) => m.groupMatchNumber === 6)!
    expect([repB.athleteAId, repB.athleteBId].sort()).toEqual(['seed6', 'seed7'])
    state = applyUpdates(state, rep1)

    // calling again before results doesn't duplicate
    expect(engine.calculateRepechage(state, 'normal', [])).toEqual([])

    state = win(engine, state, 5, 'seed1')
    state = win(engine, state, 6, 'seed2')
    state = win(engine, state, 7, 'seed1')
    state = win(engine, state, repA.matchNumber, 'seed8')
    state = win(engine, state, repB.matchNumber, 'seed6')

    const rankings = engine.getFinalRankings(state)
    const place = (id: string) => rankings.find((r) => r.athleteId === id)?.place
    expect(place('seed1')).toBe(1)
    expect(place('seed2')).toBe(2)
    expect(place('seed4')).toBe(3)
    expect(place('seed3')).toBe(3)
    expect(place('seed8')).toBe(5)
    expect(place('seed6')).toBe(5)
    expect(place('seed5')).toBe(7)
    expect(place('seed7')).toBe(7)
  })
})

describe('Repechage — dupla (Semi-finalistas)', () => {
  const engine = new EliminationEngine()

  it('round-1 winners face the SF loser of their half; round-2 winners take 3rd', () => {
    let state = generateWith(engine, 'dupla')
    state = win(engine, state, 1, 'seed1')
    state = win(engine, state, 2, 'seed4')
    state = win(engine, state, 3, 'seed2')
    state = win(engine, state, 4, 'seed3')

    const round1 = engine.calculateRepechage(state, 'dupla', [])
    expect(round1).toHaveLength(2)
    state = applyUpdates(state, round1)
    const repA = round1.find((m) => m.groupMatchNumber === 5)!
    const repB = round1.find((m) => m.groupMatchNumber === 6)!

    // round 2 can't be computed until the SF results are also known
    expect(engine.calculateRepechage(state, 'dupla', [])).toEqual([])

    state = win(engine, state, 5, 'seed1') // SF5 loser: seed4
    state = win(engine, state, 6, 'seed2') // SF6 loser: seed3
    state = win(engine, state, repA.matchNumber, 'seed8') // round1 A winner
    state = win(engine, state, repB.matchNumber, 'seed6') // round1 B winner

    const round2 = engine.calculateRepechage(state, 'dupla', [])
    expect(round2).toHaveLength(2)
    const round2A = round2.find((m) => m.groupMatchNumber === 5)!
    expect([round2A.athleteAId, round2A.athleteBId].sort()).toEqual(['seed4', 'seed8'])
    const round2B = round2.find((m) => m.groupMatchNumber === 6)!
    expect([round2B.athleteAId, round2B.athleteBId].sort()).toEqual(['seed3', 'seed6'])
    state = applyUpdates(state, round2)

    state = win(engine, state, 7, 'seed1')
    state = win(engine, state, round2A.matchNumber, 'seed4')
    state = win(engine, state, round2B.matchNumber, 'seed6')

    const rankings = engine.getFinalRankings(state)
    const place = (id: string) => rankings.find((r) => r.athleteId === id)?.place
    expect(place('seed1')).toBe(1)
    expect(place('seed2')).toBe(2)
    expect(place('seed4')).toBe(3)
    expect(place('seed6')).toBe(3)
    expect(place('seed8')).toBe(5)
    expect(place('seed3')).toBe(5)
    expect(place('seed5')).toBe(7)
    expect(place('seed7')).toBe(7)
  })
})

describe('Repechage — finalistas', () => {
  const engine = new EliminationEngine()

  it('only victims of the two actual finalists get repechage; the rest land at 7th', () => {
    let state = generateWith(engine, 'finalistas')
    state = playQfAndSf(engine, state)

    // both finalists (seed1, seed2) are now known via the final match's slots
    const rep = engine.calculateRepechage(state, 'finalistas', [])
    expect(rep).toHaveLength(2)
    state = applyUpdates(state, rep)

    // finalist1 (seed1) came through M1 (loser seed8); SF5 loser is seed4
    const repFor1 = rep.find((m) => m.groupMatchNumber === 5)!
    expect([repFor1.athleteAId, repFor1.athleteBId].sort()).toEqual(['seed4', 'seed8'])
    // finalist2 (seed2) came through M3 (loser seed7); SF6 loser is seed3
    const repFor2 = rep.find((m) => m.groupMatchNumber === 6)!
    expect([repFor2.athleteAId, repFor2.athleteBId].sort()).toEqual(['seed3', 'seed7'])

    state = win(engine, state, 7, 'seed1')
    state = win(engine, state, repFor1.matchNumber, 'seed4')
    state = win(engine, state, repFor2.matchNumber, 'seed3')

    const rankings = engine.getFinalRankings(state)
    const place = (id: string) => rankings.find((r) => r.athleteId === id)?.place
    expect(place('seed1')).toBe(1)
    expect(place('seed2')).toBe(2)
    expect(place('seed4')).toBe(3)
    expect(place('seed3')).toBe(3)
    expect(place('seed8')).toBe(5)
    expect(place('seed7')).toBe(5)
    // off-path QF losers (match2's loser seed5, match4's loser seed6) get 7th
    expect(place('seed5')).toBe(7)
    expect(place('seed6')).toBe(7)
  })
})
