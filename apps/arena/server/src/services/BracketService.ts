import type { ClientSession } from 'mongoose'
import { BracketModel, type BracketDocument } from '../repositories/BracketModel.js'
import { MatchModel, type MatchDocument } from '../repositories/MatchModel.js'
import { EventModel } from '../repositories/EventModel.js'
import { DivisionModel } from '../repositories/DivisionModel.js'
import { EventEntryModel } from '../repositories/EventEntryModel.js'
import { AthleteModel } from '../repositories/AthleteModel.js'
import { AuditLogModel } from '@sensei-hub/core-server'
import { EliminationEngine } from '../domain/bracket/EliminationEngine.js'
import { RodizioEngine } from '../domain/bracket/RodizioEngine.js'
import { BracketEngineError } from '../domain/bracket/types.js'
import type { AthleteSlot, BracketConfig, BracketEngine, BracketState, Match as EngineMatch } from '../domain/bracket/types.js'
import type { AuthCtx } from '@sensei-hub/core-server'
import type { CorrectMatchResultInput, GenerateBracketInput, RecordMatchResultInput } from '@arena/shared'

export class BracketService {
  async generateBracket(
    eventId: string,
    academyId: string,
    divisionId: string,
    input: GenerateBracketInput,
    ctx: AuthCtx,
  ) {
    await this.#findEvent(eventId, academyId)
    const division = await DivisionModel.findOne({ _id: divisionId, eventId })
    if (!division) {
      throw new BracketServiceError('Division not found', 404)
    }

    const existing = await BracketModel.findOne({ eventId, divisionId, status: 'active' })
    if (existing && !input.force) {
      throw new BracketServiceError('A bracket already exists for this division — pass force to regenerate', 409)
    }

    const entries = await EventEntryModel.find({ eventId, status: 'confirmed' })
    const eligible = entries.filter((e) => (e.confirmedDivisionId ?? e.divisionId).toString() === divisionId)
    if (eligible.length === 0) {
      throw new BracketServiceError('No confirmed entries in this division', 400)
    }

    // No seeding UI yet — every athlete enters unseeded; the draw order is
    // decided deterministically by `seed`, same as any other unseeded
    // athlete in the engine.
    //
    // clubId: prefers the competitor's clubName (free-text home club, set on
    // import or manual registration) so same-club separation actually
    // distinguishes clubs from each other. Falls back to the entry's
    // academyId — the host organization — which groups everyone with no club
    // under one bucket.
    const athletes = await AthleteModel.find({ _id: { $in: eligible.map((e) => e.athleteId) } })
    const clubNameByAthleteId = new Map(athletes.map((a) => [a._id.toString(), a.clubName]))
    const slots: AthleteSlot[] = eligible.map((e) => ({
      athleteId: e.athleteId.toString(),
      seed: null,
      clubId: clubNameByAthleteId.get(e.athleteId.toString()) || e.academyId.toString(),
    }))

    const seed = input.seed ?? Date.now()
    const config: BracketConfig =
      input.format === 'elimination'
        ? { format: 'elimination', repechageType: input.repechageType ?? 'nenhuma', seed }
        : { format: 'rodizio', seed }

    const engine = this.#engineFor(input.format)
    let state: BracketState
    try {
      state = engine.generate(slots, config)
    } catch (err) {
      if (err instanceof BracketEngineError) throw new BracketServiceError(err.message, 400)
      throw err
    }

    if (existing) {
      existing.status = 'archived'
      await existing.save()
      await AuditLogModel.create({
        userId: ctx.userId,
        entityType: 'Bracket',
        entityId: existing._id,
        action: 'update',
        fieldName: 'status',
        oldValue: 'active',
        newValue: 'archived',
        reason: 'Regenerado',
        sessionId: ctx.sessionId,
        ip: ctx.ip,
      })
    }

    const bracket = await BracketModel.create({
      eventId,
      divisionId,
      format: state.format,
      ...(state.size !== undefined ? { size: state.size } : {}),
      ...(state.repechageType !== undefined ? { repechageType: state.repechageType } : {}),
      seed: state.seed,
      slots,
      status: 'active',
      version: existing ? existing.version + 1 : 1,
      generatedBy: ctx.userId,
    })

    await MatchModel.insertMany(
      state.matches.map((m) => this.#matchDocFields(bracket, m)),
    )

    await AuditLogModel.create({
      userId: ctx.userId,
      entityType: 'Bracket',
      entityId: bracket._id,
      action: 'create',
      sessionId: ctx.sessionId,
      ip: ctx.ip,
    })

    return this.#bracketToDTO(bracket)
  }

  // Read-only check used by EventEntryService before moving an entry, to
  // decide whether the move is destructive (and therefore requires a
  // reason) without archiving anything yet.
  async hasActiveBracket(eventId: string, divisionId: string): Promise<boolean> {
    const bracket = await BracketModel.findOne({ eventId, divisionId, status: 'active' }).select('_id')
    return bracket !== null
  }

  // Called by EventEntryService when an entry is moved into or out of a
  // division that already has an active bracket — the bracket's slot list
  // (and any matches already fought) no longer reflects who is actually
  // registered in the division, so it's archived rather than silently left
  // pointing at a stale roster. Matches already recorded are NOT deleted —
  // same "archive, never destroy" rule generateBracket's own force-regenerate
  // path already follows (see above); the manager generates a fresh bracket
  // for the division afterwards. Returns whether anything was archived, so
  // the caller can tell whether the move actually touched a bracket.
  async archiveActiveBracketForEntryMove(
    eventId: string,
    divisionId: string,
    reason: string,
    ctx: AuthCtx,
    session?: ClientSession,
  ): Promise<boolean> {
    const bracket = await BracketModel.findOne({ eventId, divisionId, status: 'active' }).session(session ?? null)
    if (!bracket) return false
    bracket.status = 'archived'
    await bracket.save(session ? { session } : undefined)
    await AuditLogModel.create(
      [
        {
          userId: ctx.userId,
          entityType: 'Bracket',
          entityId: bracket._id,
          action: 'update',
          fieldName: 'status',
          oldValue: 'active',
          newValue: 'archived',
          reason,
          sessionId: ctx.sessionId,
          ip: ctx.ip,
        },
      ],
      session ? { session } : undefined,
    )
    return true
  }

  async getBracket(eventId: string, academyId: string, divisionId: string) {
    await this.#findEvent(eventId, academyId)
    const bracket = await BracketModel.findOne({ eventId, divisionId, status: 'active' })
    if (!bracket) {
      throw new BracketServiceError('No active bracket for this division', 404)
    }
    return this.#bracketToDTO(bracket)
  }

  async listMatches(eventId: string, academyId: string, divisionId: string) {
    await this.#findEvent(eventId, academyId)
    const bracket = await BracketModel.findOne({ eventId, divisionId, status: 'active' })
    if (!bracket) {
      throw new BracketServiceError('No active bracket for this division', 404)
    }
    const matches = await MatchModel.find({ bracketId: bracket._id }).sort({ matchNumber: 1 })
    return matches.map((m) => this.#matchToDTO(m))
  }

  async recordResult(
    eventId: string,
    academyId: string,
    divisionId: string,
    matchNumber: number,
    input: RecordMatchResultInput,
    ctx: AuthCtx,
  ) {
    const { bracket, matches } = await this.#loadActiveBracketState(eventId, academyId, divisionId)
    const match = matches.find((m) => m.matchNumber === matchNumber)
    if (!match) {
      throw new BracketServiceError('Match not found', 404)
    }
    if (match.result) {
      throw new BracketServiceError('Match already has a result — use the correction endpoint', 409)
    }

    const engine = this.#engineFor(bracket.format)
    const state = this.#toEngineState(bracket, matches)
    let updatedMatches: EngineMatch[]
    try {
      const result = engine.advanceMatch(state, {
        matchNumber,
        winnerId: input.winnerId,
        isWalkover: input.isWalkover,
        ...(input.method !== undefined ? { method: input.method } : {}),
        ...(input.points !== undefined ? { points: input.points } : {}),
      })
      updatedMatches = result.updatedMatches
    } catch (err) {
      if (err instanceof BracketEngineError) throw new BracketServiceError(err.message, 400)
      throw err
    }

    await this.#persistMatchUpdates(bracket._id, updatedMatches)

    if (bracket.format === 'elimination' && bracket.repechageType && bracket.repechageType !== 'nenhuma') {
      const refreshedMatches = await MatchModel.find({ bracketId: bracket._id })
      const refreshedState = this.#toEngineState(bracket, refreshedMatches)
      const newRepechage = (engine as EliminationEngine).calculateRepechage(refreshedState, bracket.repechageType, [])
      if (newRepechage.length > 0) {
        await MatchModel.insertMany(newRepechage.map((m) => this.#matchDocFields(bracket, m)))
      }
    }

    const recorded = updatedMatches.find((m) => m.matchNumber === matchNumber) as EngineMatch
    await AuditLogModel.create({
      userId: ctx.userId,
      entityType: 'Match',
      entityId: match._id,
      action: 'update',
      fieldName: 'result',
      newValue: recorded.result,
      sessionId: ctx.sessionId,
      ip: ctx.ip,
    })

    const updated = await MatchModel.findOne({ bracketId: bracket._id, matchNumber })
    return this.#matchToDTO(updated as MatchDocument)
  }

  // Only allowed while the old result hasn't propagated anywhere else in the
  // bracket yet (the old winner/loser don't appear as a participant in any
  // other match, decided or not) — same "no cascading undo, document the
  // limitation" approach already used for EventEntry's terminal statuses.
  async correctResult(
    eventId: string,
    academyId: string,
    divisionId: string,
    matchNumber: number,
    input: CorrectMatchResultInput,
    ctx: AuthCtx,
  ) {
    const { bracket, matches } = await this.#loadActiveBracketState(eventId, academyId, divisionId)
    const match = matches.find((m) => m.matchNumber === matchNumber)
    if (!match) {
      throw new BracketServiceError('Match not found', 404)
    }
    if (!match.result) {
      throw new BracketServiceError('Match has no result yet — use the result endpoint', 409)
    }
    const athleteAId = match.athleteAId?.toString() ?? null
    const athleteBId = match.athleteBId?.toString() ?? null
    if (input.winnerId !== athleteAId && input.winnerId !== athleteBId) {
      throw new BracketServiceError(`${input.winnerId} is not a participant of this match`, 400)
    }

    const oldWinnerId = match.result.winnerId.toString()
    const oldLoserId = oldWinnerId === athleteAId ? athleteBId : athleteAId

    // Overwriting the winner just re-patches whichever match(es) it already
    // advanced into (same propagation advanceMatch would have done originally)
    // — safe as long as none of those downstream matches has itself been
    // fought yet. Once a downstream match has a real result, undoing this one
    // would retroactively invalidate an already-decided bout, which has no
    // cascading-undo support (same accepted limitation as EventEntry's
    // terminal statuses). Repechage matches generated from this one via
    // calculateRepechage() are matched by participant, not by direct wiring,
    // so a still-*unplayed* repechage bout referencing the old loser is not
    // re-patched by this correction — a narrower, documented gap.
    const propagated = matches.some((m) => {
      if (m.matchNumber === matchNumber || !m.result) return false
      const a = m.athleteAId?.toString() ?? null
      const b = m.athleteBId?.toString() ?? null
      return a === oldWinnerId || b === oldWinnerId || a === oldLoserId || b === oldLoserId
    })
    if (propagated) {
      throw new BracketServiceError('Cannot correct: a subsequent match already has a recorded result for an athlete from this match', 409)
    }

    const engine = this.#engineFor(bracket.format)
    const state = this.#toEngineState(bracket, matches)
    const clonedState: BracketState = {
      ...state,
      matches: state.matches.map((m) => (m.matchNumber === matchNumber ? { ...m, result: null } : m)),
    }
    let updatedMatches: EngineMatch[]
    try {
      const result = engine.advanceMatch(clonedState, {
        matchNumber,
        winnerId: input.winnerId,
        isWalkover: input.isWalkover,
        ...(input.method !== undefined ? { method: input.method } : {}),
        ...(input.points !== undefined ? { points: input.points } : {}),
      })
      updatedMatches = result.updatedMatches
    } catch (err) {
      if (err instanceof BracketEngineError) throw new BracketServiceError(err.message, 400)
      throw err
    }

    await this.#persistMatchUpdates(bracket._id, updatedMatches)

    const corrected = updatedMatches.find((m) => m.matchNumber === matchNumber) as EngineMatch
    await AuditLogModel.create({
      userId: ctx.userId,
      entityType: 'Match',
      entityId: match._id,
      action: 'update',
      fieldName: 'result',
      oldValue: { winnerId: oldWinnerId, isWalkover: match.result.isWalkover, method: match.result.method },
      newValue: corrected.result,
      reason: input.reason,
      sessionId: ctx.sessionId,
      ip: ctx.ip,
    })

    const updated = await MatchModel.findOne({ bracketId: bracket._id, matchNumber })
    return this.#matchToDTO(updated as MatchDocument)
  }

  // Final standings of the division's active bracket, straight from the pure
  // engine (Fase 3B) — throws 409 while the bracket can't be ranked yet
  // (matches still missing results).
  async getRankings(eventId: string, academyId: string, divisionId: string) {
    const { bracket, matches } = await this.#loadActiveBracketState(eventId, academyId, divisionId)

    // Both engines return partial standings for an unfinished bracket without
    // complaining — final standings only make sense once every fightable
    // match (both participants known) has a result, so gate it here.
    const undecided = matches.some((m) => m.athleteAId && m.athleteBId && !m.result)
    if (undecided) {
      throw new BracketServiceError('Bracket is not fully decided yet', 409)
    }

    const engine = this.#engineFor(bracket.format)
    const state = this.#toEngineState(bracket, matches)
    let rankings
    try {
      rankings = engine.getFinalRankings(state)
    } catch (err) {
      if (err instanceof BracketEngineError) throw new BracketServiceError(err.message, 409)
      throw err
    }
    if (rankings.length === 0) {
      throw new BracketServiceError('Bracket is not fully decided yet', 409)
    }

    const athleteIds = rankings.map((r) => r.athleteId)
    const athletes = await AthleteModel.find({ _id: { $in: athleteIds } })
    const byId = new Map(athletes.map((a) => [a._id.toString(), a]))
    return rankings.map((r) => {
      const athlete = byId.get(r.athleteId)
      return {
        place: r.place,
        athleteId: r.athleteId,
        fullName: athlete?.fullName ?? '—',
        clubName: athlete?.clubName ?? null,
      }
    })
  }

  async #loadActiveBracketState(eventId: string, academyId: string, divisionId: string) {
    await this.#findEvent(eventId, academyId)
    const bracket = await BracketModel.findOne({ eventId, divisionId, status: 'active' })
    if (!bracket) {
      throw new BracketServiceError('No active bracket for this division', 404)
    }
    const matches = await MatchModel.find({ bracketId: bracket._id })
    return { bracket, matches }
  }

  async #persistMatchUpdates(bracketId: BracketDocument['_id'], updatedMatches: EngineMatch[]) {
    for (const m of updatedMatches) {
      await MatchModel.updateOne(
        { bracketId, matchNumber: m.matchNumber },
        {
          $set: {
            athleteAId: m.athleteAId,
            athleteBId: m.athleteBId,
            byeAthleteId: m.byeAthleteId,
            // decidedAt is stamped here, not in the pure engine, so the
            // bracket engine (domain/bracket/*) stays I/O-free — it's the
            // only source of "when did this athlete's last match end",
            // used by MatchDispatchService for the rest-time rule between
            // an athlete's fights.
            ...(m.result ? { result: { ...m.result, decidedAt: new Date() } } : {}),
          },
        },
      )
    }
  }

  #matchDocFields(bracket: BracketDocument, m: EngineMatch) {
    return {
      bracketId: bracket._id,
      eventId: bracket.eventId,
      divisionId: bracket.divisionId,
      matchNumber: m.matchNumber,
      round: m.round,
      stage: m.stage,
      athleteAId: m.athleteAId,
      athleteBId: m.athleteBId,
      byeAthleteId: m.byeAthleteId,
      nextMatchNumber: m.nextMatchNumber,
      nextMatchSlot: m.nextMatchSlot,
      loserNextMatchNumber: m.loserNextMatchNumber,
      loserNextMatchSlot: m.loserNextMatchSlot,
      groupMatchNumber: m.groupMatchNumber,
      ...(m.result ? { result: m.result } : {}),
    }
  }

  #engineFor(format: 'elimination' | 'rodizio'): BracketEngine {
    return format === 'elimination' ? new EliminationEngine() : new RodizioEngine()
  }

  #toEngineState(bracket: BracketDocument, matches: MatchDocument[]): BracketState {
    return {
      format: bracket.format,
      ...(bracket.size !== undefined ? { size: bracket.size } : {}),
      ...(bracket.repechageType !== undefined ? { repechageType: bracket.repechageType } : {}),
      seed: bracket.seed,
      slots: bracket.slots.map((s) => ({
        athleteId: s.athleteId.toString(),
        seed: s.seed,
        clubId: s.clubId ? s.clubId.toString() : null,
      })),
      matches: matches.map((m) => ({
        matchNumber: m.matchNumber,
        round: m.round,
        stage: m.stage,
        athleteAId: m.athleteAId ? m.athleteAId.toString() : null,
        athleteBId: m.athleteBId ? m.athleteBId.toString() : null,
        byeAthleteId: m.byeAthleteId ? m.byeAthleteId.toString() : null,
        nextMatchNumber: m.nextMatchNumber,
        nextMatchSlot: m.nextMatchSlot,
        loserNextMatchNumber: m.loserNextMatchNumber,
        loserNextMatchSlot: m.loserNextMatchSlot,
        groupMatchNumber: m.groupMatchNumber,
        result: m.result
          ? {
              winnerId: m.result.winnerId.toString(),
              isWalkover: m.result.isWalkover,
              ...(m.result.method !== undefined ? { method: m.result.method } : {}),
              ...(m.result.points !== undefined ? { points: m.result.points } : {}),
            }
          : null,
      })),
    }
  }

  async #findEvent(eventId: string, academyId: string) {
    const event = await EventModel.findOne({ _id: eventId, hostAcademyId: academyId })
    if (!event) {
      throw new BracketServiceError('Event not found', 404)
    }
    return event
  }

  #matchToDTO(m: MatchDocument) {
    return {
      id: m._id.toString(),
      bracketId: m.bracketId.toString(),
      matchNumber: m.matchNumber,
      round: m.round,
      stage: m.stage,
      athleteAId: m.athleteAId ? m.athleteAId.toString() : null,
      athleteBId: m.athleteBId ? m.athleteBId.toString() : null,
      byeAthleteId: m.byeAthleteId ? m.byeAthleteId.toString() : null,
      nextMatchNumber: m.nextMatchNumber,
      nextMatchSlot: m.nextMatchSlot,
      loserNextMatchNumber: m.loserNextMatchNumber,
      loserNextMatchSlot: m.loserNextMatchSlot,
      groupMatchNumber: m.groupMatchNumber,
      result: m.result
        ? {
            winnerId: m.result.winnerId.toString(),
            isWalkover: m.result.isWalkover,
            method: m.result.method,
            points: m.result.points,
            decidedAt: m.result.decidedAt?.toISOString(),
          }
        : null,
      areaId: m.areaId ? m.areaId.toString() : null,
    }
  }

  #bracketToDTO(b: BracketDocument) {
    return {
      id: b._id.toString(),
      eventId: b.eventId.toString(),
      divisionId: b.divisionId.toString(),
      format: b.format,
      size: b.size,
      repechageType: b.repechageType,
      seed: b.seed,
      slots: b.slots.map((s) => ({
        athleteId: s.athleteId.toString(),
        seed: s.seed,
        clubId: s.clubId ? s.clubId.toString() : null,
      })),
      status: b.status,
      version: b.version,
      generatedBy: b.generatedBy.toString(),
      createdAt: b.createdAt.toISOString(),
      updatedAt: b.updatedAt.toISOString(),
    }
  }
}

export class BracketServiceError extends Error {
  constructor(
    message: string,
    public readonly statusCode: 400 | 404 | 409,
  ) {
    super(message)
    this.name = 'BracketServiceError'
  }
}
