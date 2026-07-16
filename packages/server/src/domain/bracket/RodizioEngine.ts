import type {
  AthleteRanking,
  AthleteSlot,
  BracketConfig,
  BracketEngine,
  BracketState,
  AdvanceResult,
  Match,
  MatchResultInput,
  RepechageType,
} from './types.js'
import { BracketEngineError } from './types.js'
import { mulberry32 } from './seeding.js'
import { RODIZIO_SCHEDULES, isRodizioSize, orderRodizioAthletes, type RodizioSize } from './rodizioSchedule.js'

export class RodizioEngine implements BracketEngine {
  generate(athletes: AthleteSlot[], config: BracketConfig): BracketState {
    if (config.format !== 'rodizio') {
      throw new BracketEngineError(`RodizioEngine cannot generate a '${config.format}' bracket`)
    }
    const n = athletes.length
    if (!isRodizioSize(n)) {
      throw new BracketEngineError(`Rodízio only supports 3–6 athletes (got ${n})`)
    }
    const seed = config.seed ?? 0
    const ordered = orderRodizioAthletes(athletes, seed)
    const schedule = RODIZIO_SCHEDULES[n as RodizioSize]

    const matches: Match[] = schedule.map(([posA, posB], i) => ({
      matchNumber: i + 1,
      round: 1,
      stage: 'round',
      athleteAId: (ordered[posA - 1] as AthleteSlot).athleteId,
      athleteBId: (ordered[posB - 1] as AthleteSlot).athleteId,
      byeAthleteId: null,
      nextMatchNumber: null,
      nextMatchSlot: null,
      loserNextMatchNumber: null,
      loserNextMatchSlot: null,
      groupMatchNumber: null,
      result: null,
    }))

    return { format: 'rodizio', seed, matches, slots: ordered }
  }

  getReadyMatches(state: BracketState): Match[] {
    // Every rodízio match is independent — there's no bracket dependency,
    // so all unplayed matches are always ready.
    return state.matches.filter((m) => m.result === null)
  }

  advanceMatch(state: BracketState, input: MatchResultInput): AdvanceResult {
    const match = state.matches.find((m) => m.matchNumber === input.matchNumber)
    if (!match) {
      throw new BracketEngineError(`Match ${input.matchNumber} not found`)
    }
    if (match.result !== null) {
      throw new BracketEngineError(`Match ${input.matchNumber} already has a result`)
    }
    if (input.winnerId !== match.athleteAId && input.winnerId !== match.athleteBId) {
      throw new BracketEngineError(`${input.winnerId} is not a participant of match ${input.matchNumber}`)
    }
    const updatedMatch: Match = {
      ...match,
      result: {
        winnerId: input.winnerId,
        isWalkover: input.isWalkover,
        ...(input.method !== undefined ? { method: input.method } : {}),
        ...(input.points !== undefined ? { points: input.points } : {}),
      },
    }
    return { updatedMatches: [updatedMatch], newRepechageMatches: [] }
  }

  calculateRepechage(_state: BracketState, _type: RepechageType, _completedRound: Match[]): Match[] {
    throw new BracketEngineError('Rodízio has no repechage — every athlete plays every round')
  }

  // Tie-break order per docs/zempo-modelos/rodizio.md: wins, then
  // accumulated points, then head-to-head, then a deterministic draw seeded
  // from state.seed. For a group of 3+ still tied after wins+points,
  // "confronto direto" is computed as wins *within that tied group* — this
  // resolves both the simple 2-way case and a 3-way group where one athlete
  // clearly beat the other tied members. A genuine head-to-head cycle (A
  // beat B, B beat C, C beat A, all still tied) has no consistent total
  // order, so whatever's still tied after that falls to the draw.
  getFinalRankings(state: BracketState): AthleteRanking[] {
    if (state.format !== 'rodizio') {
      throw new BracketEngineError('getFinalRankings (rodizio tie-break rules) only applies to rodizio brackets')
    }
    const athleteIds = state.slots.map((s) => s.athleteId)
    const stats = new Map<string, { wins: number; points: number }>()
    for (const id of athleteIds) stats.set(id, { wins: 0, points: 0 })
    const resultOf = new Map<string, string>()

    for (const m of state.matches) {
      if (!m.result || !m.athleteAId || !m.athleteBId) continue
      const s = stats.get(m.result.winnerId)
      if (s) {
        s.wins++
        s.points += m.result.points ?? 0
      }
      resultOf.set([m.athleteAId, m.athleteBId].sort().join('|'), m.result.winnerId)
    }

    const rand = mulberry32(state.seed)
    const drawOrder = new Map(athleteIds.map((id) => [id, rand()]))

    const byKey = new Map<string, string[]>()
    for (const id of athleteIds) {
      const s = stats.get(id) as { wins: number; points: number }
      const key = `${s.wins}|${s.points}`
      const arr = byKey.get(key) ?? []
      arr.push(id)
      byKey.set(key, arr)
    }
    const groupKeys = [...byKey.keys()].sort((ka, kb) => {
      const [wa, pa] = ka.split('|').map(Number) as [number, number]
      const [wb, pb] = kb.split('|').map(Number) as [number, number]
      if (wa !== wb) return wb - wa
      return pb - pa
    })

    const winsWithinGroup = (id: string, group: string[]): number =>
      group.reduce((count, other) => {
        if (other === id) return count
        const winner = resultOf.get([id, other].sort().join('|'))
        return winner === id ? count + 1 : count
      }, 0)

    const finalOrder: string[] = []
    for (const key of groupKeys) {
      const group = byKey.get(key) as string[]
      if (group.length === 1) {
        finalOrder.push(group[0] as string)
        continue
      }
      const ordered = [...group].sort((x, y) => {
        const diff = winsWithinGroup(y, group) - winsWithinGroup(x, group)
        if (diff !== 0) return diff
        return (drawOrder.get(x) as number) - (drawOrder.get(y) as number)
      })
      finalOrder.push(...ordered)
    }

    return finalOrder.map((athleteId, i) => ({ athleteId, place: i + 1 }))
  }
}
