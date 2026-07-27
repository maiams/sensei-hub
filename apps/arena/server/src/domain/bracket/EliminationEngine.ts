import type {
  AthleteRanking,
  AthleteSlot,
  BracketConfig,
  BracketEngine,
  BracketState,
  AdvanceResult,
  Match,
  MatchStage,
  MatchResultInput,
  RepechageType,
} from './types.js'
import { BRACKET_SIZES, BracketEngineError } from './types.js'
import { assignSlots, smallestBracketSize } from './seeding.js'
import { matchNumberFor, matchesInRound, numRounds } from './bracketTree.js'

function emptyMatch(matchNumber: number, round: number, stage: MatchStage): Match {
  return {
    matchNumber,
    round,
    stage,
    athleteAId: null,
    athleteBId: null,
    byeAthleteId: null,
    nextMatchNumber: null,
    nextMatchSlot: null,
    loserNextMatchNumber: null,
    loserNextMatchSlot: null,
    groupMatchNumber: null,
    result: null,
  }
}

function loserOf(m: Match): string {
  if (!m.result) throw new BracketEngineError(`Match ${m.matchNumber} has no result`)
  return m.result.winnerId === m.athleteAId ? (m.athleteBId as string) : (m.athleteAId as string)
}

function resolveByeIfNeeded(m: Match, matches: Match[]): void {
  const hasA = m.athleteAId !== null
  const hasB = m.athleteBId !== null
  if (hasA === hasB) return // both filled (normal match) or both empty (double-bye, nothing to propagate)
  const advancing = (hasA ? m.athleteAId : m.athleteBId) as string
  m.byeAthleteId = advancing
  if (m.nextMatchNumber !== null && m.nextMatchSlot !== null) {
    const next = matches.find((mm) => mm.matchNumber === m.nextMatchNumber)
    if (next) {
      if (m.nextMatchSlot === 'A') next.athleteAId = advancing
      else next.athleteBId = advancing
    }
  }
}

// Judo awards two bronze medals (no 3rd-vs-4th decider) except in 'simples',
// the only format with a real bronze bout — see docs/zempo-modelos/repescagem.md.
export class EliminationEngine implements BracketEngine {
  generate(athletes: AthleteSlot[], config: BracketConfig): BracketState {
    if (config.format !== 'elimination') {
      throw new BracketEngineError(`EliminationEngine cannot generate a '${config.format}' bracket`)
    }
    if (athletes.length < 2) {
      throw new BracketEngineError('At least 2 athletes are required')
    }
    const size = config.size ?? smallestBracketSize(athletes.length)
    if (!BRACKET_SIZES.includes(size)) {
      throw new BracketEngineError(`Invalid bracket size: ${size}`)
    }
    if (athletes.length > size) {
      throw new BracketEngineError(`${athletes.length} athletes do not fit in a Chave-${size}`)
    }
    const repechageType: RepechageType = config.repechageType ?? 'nenhuma'
    const seed = config.seed ?? 0

    const { slots } = assignSlots(athletes, size, seed)
    const rounds = numRounds(size)
    const matches: Match[] = []

    for (let round = 1; round <= rounds; round++) {
      const count = matchesInRound(size, round)
      for (let i = 0; i < count; i++) {
        matches.push(emptyMatch(matchNumberFor(size, round, i), round, 'round'))
      }
    }

    const findMatch = (matchNumber: number) => matches.find((m) => m.matchNumber === matchNumber) as Match

    for (let round = 1; round < rounds; round++) {
      const count = matchesInRound(size, round)
      for (let i = 0; i < count; i++) {
        const m = findMatch(matchNumberFor(size, round, i))
        m.nextMatchNumber = matchNumberFor(size, round + 1, Math.floor(i / 2))
        m.nextMatchSlot = i % 2 === 0 ? 'A' : 'B'
      }
    }

    const round1Count = matchesInRound(size, 1)
    for (let i = 0; i < round1Count; i++) {
      const m = findMatch(matchNumberFor(size, 1, i))
      m.athleteAId = slots[2 * i]?.athleteId ?? null
      m.athleteBId = slots[2 * i + 1]?.athleteId ?? null
    }

    if (repechageType === 'simples') {
      const bronzeNumber = size
      const bronze = emptyMatch(bronzeNumber, rounds, 'bronze')
      matches.push(bronze)
      const sfRound = rounds - 1
      const sfCount = matchesInRound(size, sfRound)
      for (let i = 0; i < sfCount; i++) {
        const sf = findMatch(matchNumberFor(size, sfRound, i))
        sf.loserNextMatchNumber = bronzeNumber
        sf.loserNextMatchSlot = i % 2 === 0 ? 'A' : 'B'
      }
    }

    // Resolve byes bottom-up (round 1 first). A match may only be marked as
    // a bye/phantom — "nobody needs to fight here, the outcome is already
    // known at generation time" — when it's a round-1 match (fill status is
    // 100% structural there) OR a later-round match whose BOTH feeders are
    // themselves already phantom. If either feeder is a genuine two-athlete
    // contest (decided or not — generation always happens before any match
    // is played), the downstream slot MUST stay pending: resolving it early
    // would silently promote the bye recipient past an undecided real match,
    // making the next round — or even the final — look "ready" before the
    // actual semifinal has been fought. This was a real bug: with 5 or 6
    // athletes in a Chave-8, a round-1 bye recipient was auto-advanced two
    // rounds into the final while their true semifinal opponent's match had
    // not even been played yet. See bracket.eliminationByeIntegrity.test.ts.
    const phantom = new Set<number>()
    for (let round = 1; round < rounds; round++) {
      const count = matchesInRound(size, round)
      for (let i = 0; i < count; i++) {
        const m = findMatch(matchNumberFor(size, round, i))
        if (round > 1) {
          const leftFeeder = findMatch(matchNumberFor(size, round - 1, i * 2))
          const rightFeeder = findMatch(matchNumberFor(size, round - 1, i * 2 + 1))
          if (!phantom.has(leftFeeder.matchNumber) || !phantom.has(rightFeeder.matchNumber)) {
            continue // at least one feeder is a live, undecided contest
          }
        }
        if (m.athleteAId !== null && m.athleteBId !== null) continue // genuine contest, not phantom
        phantom.add(m.matchNumber)
        resolveByeIfNeeded(m, matches)
      }
    }

    return { format: 'elimination', size, repechageType, seed, matches, slots }
  }

  getReadyMatches(state: BracketState): Match[] {
    return state.matches.filter((m) => m.athleteAId !== null && m.athleteBId !== null && m.result === null)
  }

  advanceMatch(state: BracketState, input: MatchResultInput): AdvanceResult {
    const match = state.matches.find((m) => m.matchNumber === input.matchNumber)
    if (!match) {
      throw new BracketEngineError(`Match ${input.matchNumber} not found`)
    }
    if (match.result !== null) {
      throw new BracketEngineError(`Match ${input.matchNumber} already has a result`)
    }
    if (match.athleteAId === null || match.athleteBId === null) {
      throw new BracketEngineError(`Match ${input.matchNumber} is not ready — missing an athlete`)
    }
    if (input.winnerId !== match.athleteAId && input.winnerId !== match.athleteBId) {
      throw new BracketEngineError(`${input.winnerId} is not a participant of match ${input.matchNumber}`)
    }
    const loserId = input.winnerId === match.athleteAId ? match.athleteBId : match.athleteAId

    const updatedMatch: Match = {
      ...match,
      result: {
        winnerId: input.winnerId,
        isWalkover: input.isWalkover,
        ...(input.method !== undefined ? { method: input.method } : {}),
      },
    }
    const updatedMatches: Match[] = [updatedMatch]

    if (match.nextMatchNumber !== null && match.nextMatchSlot !== null) {
      const next = state.matches.find((m) => m.matchNumber === match.nextMatchNumber)
      if (next) {
        const updatedNext: Match = { ...next }
        if (match.nextMatchSlot === 'A') updatedNext.athleteAId = input.winnerId
        else updatedNext.athleteBId = input.winnerId
        updatedMatches.push(updatedNext)
      }
    }

    if (match.loserNextMatchNumber !== null && match.loserNextMatchSlot !== null) {
      const next = state.matches.find((m) => m.matchNumber === match.loserNextMatchNumber)
      if (next) {
        const updatedNext: Match = { ...next }
        if (match.loserNextMatchSlot === 'A') updatedNext.athleteAId = loserId
        else updatedNext.athleteBId = loserId
        updatedMatches.push(updatedNext)
      }
    }

    return { updatedMatches, newRepechageMatches: [] }
  }

  // Intentionally idempotent and derived entirely from `state.matches`, not
  // from `completedRound` — accepted per the BracketEngine interface, but a
  // caller can call this after every advanceMatch without tracking exactly
  // which round just finished; already-generated repechage matches (found
  // via `groupMatchNumber`) are never duplicated.
  calculateRepechage(state: BracketState, type: RepechageType, _completedRound: Match[]): Match[] {
    if (state.format !== 'elimination' || !state.size) {
      throw new BracketEngineError('calculateRepechage only applies to elimination brackets')
    }
    if (type === 'nenhuma' || type === 'simples') return []

    const size = state.size
    const rounds = numRounds(size)
    const qfRound = rounds - 2
    const sfRound = rounds - 1
    const newMatches: Match[] = []
    let nextNumber = Math.max(size, ...state.matches.map((m) => m.matchNumber)) + 1

    const hasRepechageFor = (groupMatchNumber: number, stage: MatchStage) =>
      state.matches.some((m) => m.stage === stage && m.groupMatchNumber === groupMatchNumber) ||
      newMatches.some((m) => m.stage === stage && m.groupMatchNumber === groupMatchNumber)

    if (type === 'normal' || type === 'dupla') {
      const qfBySfParent = new Map<number, Match[]>()
      for (const m of state.matches) {
        if (m.round === qfRound && m.stage === 'round' && m.result !== null && m.nextMatchNumber !== null) {
          const arr = qfBySfParent.get(m.nextMatchNumber) ?? []
          arr.push(m)
          qfBySfParent.set(m.nextMatchNumber, arr)
        }
      }
      for (const [sfMatchNumber, group] of qfBySfParent) {
        if (group.length < 2) continue
        if (hasRepechageFor(sfMatchNumber, 'repechage')) continue
        const [q1, q2] = [...group].sort((a, b) => a.matchNumber - b.matchNumber)
        newMatches.push({
          ...emptyMatch(nextNumber++, sfRound, 'repechage'),
          athleteAId: loserOf(q1 as Match),
          athleteBId: loserOf(q2 as Match),
          groupMatchNumber: sfMatchNumber,
        })
      }
    }

    if (type === 'dupla') {
      const repRound1 = [...state.matches, ...newMatches].filter(
        (m) => m.stage === 'repechage' && m.groupMatchNumber !== null,
      )
      for (const rep of repRound1) {
        const sfMatchNumber = rep.groupMatchNumber as number
        const sf = state.matches.find((m) => m.matchNumber === sfMatchNumber)
        if (!sf || sf.result === null || rep.result === null) continue
        if (hasRepechageFor(sfMatchNumber, 'repechage_round2')) continue
        newMatches.push({
          ...emptyMatch(nextNumber++, sfRound, 'repechage_round2'),
          athleteAId: rep.result.winnerId,
          athleteBId: loserOf(sf),
          groupMatchNumber: sfMatchNumber,
        })
      }
    }

    if (type === 'finalistas') {
      const finalMatchNumber = size - 1
      const final = state.matches.find((m) => m.matchNumber === finalMatchNumber)
      if (final && final.athleteAId !== null && final.athleteBId !== null) {
        for (const finalistId of [final.athleteAId, final.athleteBId]) {
          const sf = state.matches.find(
            (m) => m.round === sfRound && m.stage === 'round' && m.result?.winnerId === finalistId,
          )
          if (!sf) continue
          const qf = state.matches.find(
            (m) =>
              m.round === qfRound &&
              m.stage === 'round' &&
              m.nextMatchNumber === sf.matchNumber &&
              m.result?.winnerId === finalistId,
          )
          if (!qf) continue
          if (hasRepechageFor(sf.matchNumber, 'repechage')) continue
          newMatches.push({
            ...emptyMatch(nextNumber++, sfRound, 'repechage'),
            athleteAId: loserOf(qf),
            athleteBId: loserOf(sf),
            groupMatchNumber: sf.matchNumber,
          })
        }
      }
    }

    return newMatches
  }

  getFinalRankings(state: BracketState): AthleteRanking[] {
    if (state.format !== 'elimination' || !state.size) {
      throw new BracketEngineError('getFinalRankings only applies to elimination brackets')
    }
    const size = state.size
    const rounds = numRounds(size)
    const qfRound = rounds - 2
    const sfRound = rounds - 1
    const finalMatchNumber = size - 1
    const type = state.repechageType ?? 'nenhuma'
    const rankings: AthleteRanking[] = []
    const push = (athleteId: string | null | undefined, place: number) => {
      if (athleteId) rankings.push({ athleteId, place })
    }

    const final = state.matches.find((m) => m.matchNumber === finalMatchNumber)
    if (final?.result) {
      push(final.result.winnerId, 1)
      push(loserOf(final), 2)
    }

    const sfMatches = state.matches.filter((m) => m.round === sfRound && m.stage === 'round')

    if (type === 'simples') {
      const bronze = state.matches.find((m) => m.stage === 'bronze')
      if (bronze?.result) {
        push(bronze.result.winnerId, 3)
        push(loserOf(bronze), 4)
      }
      return rankings
    }

    if (type === 'nenhuma' || type === 'normal') {
      for (const sf of sfMatches) {
        if (sf.result) push(loserOf(sf), 3)
      }
      if (type === 'nenhuma') {
        // No fight decides 5th vs 7th — assign by bracket half (lower SF
        // match number = 5th) as a stable, documented display convention.
        const sorted = [...sfMatches].sort((a, b) => a.matchNumber - b.matchNumber)
        const qfBySfParent = new Map<number, Match[]>()
        for (const m of state.matches) {
          if (m.round === qfRound && m.stage === 'round' && m.nextMatchNumber !== null) {
            const arr = qfBySfParent.get(m.nextMatchNumber) ?? []
            arr.push(m)
            qfBySfParent.set(m.nextMatchNumber, arr)
          }
        }
        sorted.forEach((sf, half) => {
          const group = qfBySfParent.get(sf.matchNumber) ?? []
          for (const qf of group) {
            if (qf.result) push(loserOf(qf), half === 0 ? 5 : 7)
          }
        })
      } else {
        const repechageMatches = state.matches.filter((m) => m.stage === 'repechage')
        for (const rep of repechageMatches) {
          if (!rep.result) continue
          push(rep.result.winnerId, 5)
          push(loserOf(rep), 7)
        }
      }
      return rankings
    }

    if (type === 'dupla') {
      const round2 = state.matches.filter((m) => m.stage === 'repechage_round2')
      for (const m of round2) {
        if (!m.result) continue
        push(m.result.winnerId, 3)
        push(loserOf(m), 5)
      }
      const round1 = state.matches.filter((m) => m.stage === 'repechage')
      for (const m of round1) {
        if (m.result) push(loserOf(m), 7)
      }
      return rankings
    }

    if (type === 'finalistas') {
      const repechageMatches = state.matches.filter((m) => m.stage === 'repechage')
      const onPathSfNumbers = new Set(repechageMatches.map((m) => m.groupMatchNumber))
      for (const rep of repechageMatches) {
        if (!rep.result) continue
        push(rep.result.winnerId, 3)
        push(loserOf(rep), 5)
      }
      for (const qf of state.matches) {
        if (qf.round !== qfRound || qf.stage !== 'round' || !qf.result) continue
        if (qf.nextMatchNumber !== null && onPathSfNumbers.has(qf.nextMatchNumber)) {
          // still need to check this SPECIFIC qf match is the on-path one,
          // not just that it feeds an on-path SF (the other QF feeding the
          // same SF, whose winner lost the SF, is NOT on the finalist's path)
          const rep = repechageMatches.find((r) => r.groupMatchNumber === qf.nextMatchNumber)
          const loser = loserOf(qf)
          if (rep && (rep.athleteAId === loser || rep.athleteBId === loser)) continue
        }
        push(loserOf(qf), 7)
      }
      return rankings
    }

    return rankings
  }
}
