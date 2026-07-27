import { EventEmitter } from 'node:events'
import { ScoreboardModel, type ScoreboardDocument, type ScoreboardSideSub } from '../repositories/ScoreboardModel.js'
import { MatchModel } from '../repositories/MatchModel.js'
import { AreaModel } from '../repositories/AreaModel.js'
import { EventModel, type EventDocument } from '../repositories/EventModel.js'
import { DivisionModel } from '../repositories/DivisionModel.js'
import { AthleteModel, type AthleteDocument } from '../repositories/AthleteModel.js'
import { AuditLogModel } from '@sensei-hub/core-server'
import { applyScore, removeScore, osaekomiAward, endsFight, leader, ScoreboardRulesError } from '../domain/scoreboard/rules.js'
import { publicDisplayName } from '../domain/publicName.js'
import { BracketService } from './BracketService.js'
import { CBJ_DEFAULT_MATCH_RULES, resolveAthleteIdentity } from '@arena/shared'
import type { ScoreboardDTO, ScoreType, SideKey, SideScore } from '@arena/shared'
import type { AuthCtx } from '@sensei-hub/core-server'

// In-process broadcast bus: every committed scoreboard mutation emits the
// PUBLIC DTO keyed by area, and the WebSocket route fans it out to that
// area's display clients. Single-node by design for now — when the Fase 7
// multi-node cluster lands, this becomes a MongoDB Change Stream consumer so
// every node broadcasts to its own clients (docs/status-e-plano.md, Fase 4).
export const scoreboardEvents = new EventEmitter()
scoreboardEvents.setMaxListeners(0)

export class ScoreboardService {
  #brackets = new BracketService()

  // Starts the scoreboard for a match already dispatched to this area, or
  // resumes the existing active one (idempotent — an operator refreshing the
  // page must land back on the live fight, never fork a second scoreboard).
  async startScoreboard(eventId: string, academyId: string, areaId: string, matchId: string, ctx: AuthCtx) {
    const event = await this.#findEvent(eventId, academyId)
    const area = await AreaModel.findOne({ _id: areaId, eventId })
    if (!area) throw new ScoreboardServiceError('Area not found', 404)
    if (area.status !== 'open') throw new ScoreboardServiceError('Area is closed', 409)

    const match = await MatchModel.findOne({ _id: matchId, eventId })
    if (!match) throw new ScoreboardServiceError('Match not found', 404)
    if (match.result) throw new ScoreboardServiceError('Match already has a result', 409)
    if (!match.athleteAId || !match.athleteBId) {
      throw new ScoreboardServiceError('Match participants are not defined yet', 409)
    }
    if (match.areaId?.toString() !== areaId) {
      throw new ScoreboardServiceError('Match is not dispatched to this area', 409)
    }

    const existing = await ScoreboardModel.findOne({ matchId: match._id, status: 'active' })
    if (existing) {
      return this.#toDTO(existing, 'operator')
    }

    const division = await DivisionModel.findOne({ _id: match.divisionId })
    if (!division) throw new ScoreboardServiceError('Division not found', 404)
    const rules = division.matchRules ?? CBJ_DEFAULT_MATCH_RULES

    const [athleteA, athleteB] = await Promise.all([
      AthleteModel.findOne({ _id: match.athleteAId }),
      AthleteModel.findOne({ _id: match.athleteBId }),
    ])
    if (!athleteA || !athleteB) throw new ScoreboardServiceError('Athlete not found', 404)

    const scoreboard = await ScoreboardModel.create({
      eventId: event._id,
      divisionId: division._id,
      divisionName: division.name,
      areaId: area._id,
      matchId: match._id,
      matchNumber: match.matchNumber,
      matchRules: rules,
      clock: { clockMs: rules.matchDurationSeconds * 1000, running: false, lastStartedAt: null, countsUp: false },
      osaekomi: null,
      sides: {
        A: this.#newSide(athleteA, event),
        B: this.#newSide(athleteB, event),
      },
      winner: null,
      createdBy: ctx.userId,
    })

    await AuditLogModel.create({
      userId: ctx.userId,
      entityType: 'Scoreboard',
      entityId: scoreboard._id,
      action: 'create',
      sessionId: ctx.sessionId,
      ip: ctx.ip,
    })

    this.#broadcast(scoreboard)
    return this.#toDTO(scoreboard, 'operator')
  }

  async getScoreboard(scoreboardId: string, academyId: string) {
    const scoreboard = await this.#findScoreboard(scoreboardId, academyId)
    return this.#toDTO(scoreboard, 'operator')
  }

  async startClock(scoreboardId: string, academyId: string, ctx: AuthCtx) {
    const scoreboard = await this.#findActive(scoreboardId, academyId)
    if (!scoreboard.clock.running) {
      scoreboard.clock.running = true
      scoreboard.clock.lastStartedAt = new Date()
      await scoreboard.save()
      this.#broadcast(scoreboard)
    }
    void ctx
    return this.#toDTO(scoreboard, 'operator')
  }

  async pauseClock(scoreboardId: string, academyId: string, ctx: AuthCtx) {
    const scoreboard = await this.#findActive(scoreboardId, academyId)
    this.#freezeClock(scoreboard)
    await scoreboard.save()
    this.#broadcast(scoreboard)
    void ctx
    return this.#toDTO(scoreboard, 'operator')
  }

  // Manual clock correction — always audited.
  async setClock(scoreboardId: string, academyId: string, clockMs: number, reason: string, ctx: AuthCtx) {
    const scoreboard = await this.#findActive(scoreboardId, academyId)
    const oldMs = this.#currentClockMs(scoreboard)
    scoreboard.clock.clockMs = clockMs
    scoreboard.clock.running = false
    scoreboard.clock.lastStartedAt = null
    await scoreboard.save()

    await AuditLogModel.create({
      userId: ctx.userId,
      entityType: 'Scoreboard',
      entityId: scoreboard._id,
      action: 'update',
      fieldName: 'clock',
      oldValue: oldMs,
      newValue: clockMs,
      reason,
      sessionId: ctx.sessionId,
      ip: ctx.ip,
    })

    this.#broadcast(scoreboard)
    return this.#toDTO(scoreboard, 'operator')
  }

  async addScore(scoreboardId: string, academyId: string, side: SideKey, type: ScoreType, ctx: AuthCtx) {
    const scoreboard = await this.#findActive(scoreboardId, academyId)
    this.#applyToSide(scoreboard, side, (s) => applyScore(s, type))
    this.#afterScoringChange(scoreboard)
    await scoreboard.save()

    await AuditLogModel.create({
      userId: ctx.userId,
      entityType: 'Scoreboard',
      entityId: scoreboard._id,
      action: 'update',
      fieldName: `score.${side}.${type}`,
      newValue: '+1',
      sessionId: ctx.sessionId,
      ip: ctx.ip,
    })

    this.#broadcast(scoreboard)
    return this.#toDTO(scoreboard, 'operator')
  }

  // Removing a score is a correction — reason required, audited.
  async removeScoreCorrection(
    scoreboardId: string,
    academyId: string,
    side: SideKey,
    type: ScoreType,
    reason: string,
    ctx: AuthCtx,
  ) {
    const scoreboard = await this.#findActive(scoreboardId, academyId)
    this.#applyToSide(scoreboard, side, (s) => removeScore(s, type))
    await scoreboard.save()

    await AuditLogModel.create({
      userId: ctx.userId,
      entityType: 'Scoreboard',
      entityId: scoreboard._id,
      action: 'update',
      fieldName: `score.${side}.${type}`,
      newValue: '-1',
      reason,
      sessionId: ctx.sessionId,
      ip: ctx.ip,
    })

    this.#broadcast(scoreboard)
    return this.#toDTO(scoreboard, 'operator')
  }

  async startOsaekomi(scoreboardId: string, academyId: string, holder: SideKey, ctx: AuthCtx) {
    const scoreboard = await this.#findActive(scoreboardId, academyId)
    if (scoreboard.osaekomi) throw new ScoreboardServiceError('Osaekomi already running', 409)
    scoreboard.osaekomi = { holder, startedAt: new Date() }
    await scoreboard.save()
    this.#broadcast(scoreboard)
    void ctx
    return this.#toDTO(scoreboard, 'operator')
  }

  // Stopping converts held time into a score per the division's thresholds
  // (capped at yuko in golden score — RNC 2025).
  async stopOsaekomi(scoreboardId: string, academyId: string, ctx: AuthCtx) {
    const scoreboard = await this.#findActive(scoreboardId, academyId)
    if (!scoreboard.osaekomi) throw new ScoreboardServiceError('No osaekomi running', 409)

    const elapsedSeconds = Math.floor((Date.now() - scoreboard.osaekomi.startedAt.getTime()) / 1000)
    const holder = scoreboard.osaekomi.holder
    const award = osaekomiAward(elapsedSeconds, scoreboard.matchRules, scoreboard.phase)
    scoreboard.osaekomi = null
    if (award) {
      this.#applyToSide(scoreboard, holder, (s) => applyScore(s, award))
      this.#afterScoringChange(scoreboard)
    }
    await scoreboard.save()

    await AuditLogModel.create({
      userId: ctx.userId,
      entityType: 'Scoreboard',
      entityId: scoreboard._id,
      action: 'update',
      fieldName: `osaekomi.${holder}`,
      newValue: { elapsedSeconds, award },
      sessionId: ctx.sessionId,
      ip: ctx.ip,
    })

    this.#broadcast(scoreboard)
    return { scoreboard: this.#toDTO(scoreboard, 'operator'), award, elapsedSeconds }
  }

  // Regular time over, board tied, division allows it → golden score.
  async enterGoldenScore(scoreboardId: string, academyId: string, ctx: AuthCtx) {
    const scoreboard = await this.#findActive(scoreboardId, academyId)
    if (scoreboard.phase !== 'regular') throw new ScoreboardServiceError('Already in golden score', 409)
    if (!scoreboard.matchRules.goldenScoreEnabled) {
      throw new ScoreboardServiceError('Golden score is disabled for this division', 409)
    }
    if (leader(scoreboard.sides.A, scoreboard.sides.B) !== null) {
      throw new ScoreboardServiceError('Fight is not tied — the leader wins at the end of regular time', 409)
    }

    scoreboard.phase = 'golden_score'
    const limit = scoreboard.matchRules.goldenScoreDurationSeconds
    scoreboard.clock =
      limit === null
        ? { clockMs: 0, running: false, lastStartedAt: null, countsUp: true }
        : { clockMs: limit * 1000, running: false, lastStartedAt: null, countsUp: false }
    scoreboard.osaekomi = null
    await scoreboard.save()

    await AuditLogModel.create({
      userId: ctx.userId,
      entityType: 'Scoreboard',
      entityId: scoreboard._id,
      action: 'update',
      fieldName: 'phase',
      oldValue: 'regular',
      newValue: 'golden_score',
      sessionId: ctx.sessionId,
      ip: ctx.ip,
    })

    this.#broadcast(scoreboard)
    return this.#toDTO(scoreboard, 'operator')
  }

  // Closes the scoreboard AND records the bracket result (Fase 3C flow) in
  // one action — decidedAt gets stamped, the bracket advances, the athlete
  // rest clocks start, and the area frees up for the next dispatch.
  async declareWinner(
    scoreboardId: string,
    academyId: string,
    winnerId: string,
    method: string,
    ctx: AuthCtx,
  ) {
    const scoreboard = await this.#findActive(scoreboardId, academyId)
    const sideIds = [scoreboard.sides.A.athleteId.toString(), scoreboard.sides.B.athleteId.toString()]
    if (!sideIds.includes(winnerId)) {
      throw new ScoreboardServiceError('Winner is not a participant of this match', 400)
    }

    await this.#brackets.recordResult(
      scoreboard.eventId.toString(),
      academyId,
      scoreboard.divisionId.toString(),
      scoreboard.matchNumber,
      { winnerId, method, isWalkover: false },
      ctx,
    )

    this.#freezeClock(scoreboard)
    scoreboard.osaekomi = null
    scoreboard.status = 'completed'
    scoreboard.winner = { athleteId: scoreboard.sides.A.athleteId.toString() === winnerId ? scoreboard.sides.A.athleteId : scoreboard.sides.B.athleteId, method }
    await scoreboard.save()

    this.#broadcast(scoreboard)
    return this.#toDTO(scoreboard, 'operator')
  }

  // Wrong match started, athlete didn't show, etc. Releases the match back
  // to the dispatch pool (same as AreaService.closeArea does for reserved,
  // undecided matches).
  async abortScoreboard(scoreboardId: string, academyId: string, reason: string, ctx: AuthCtx) {
    const scoreboard = await this.#findActive(scoreboardId, academyId)
    this.#freezeClock(scoreboard)
    scoreboard.osaekomi = null
    scoreboard.status = 'aborted'
    scoreboard.abortReason = reason
    await scoreboard.save()

    await MatchModel.updateOne({ _id: scoreboard.matchId, result: null }, { $set: { areaId: null } })

    await AuditLogModel.create({
      userId: ctx.userId,
      entityType: 'Scoreboard',
      entityId: scoreboard._id,
      action: 'update',
      fieldName: 'status',
      oldValue: 'active',
      newValue: 'aborted',
      reason,
      sessionId: ctx.sessionId,
      ip: ctx.ip,
    })

    this.#broadcast(scoreboard)
    return this.#toDTO(scoreboard, 'operator')
  }

  // Latest scoreboard of an area, public payload (privacy-filtered names) —
  // no auth, consumed by the public display and as the WS hello message.
  async getPublicScoreboardForArea(areaId: string): Promise<ScoreboardDTO | null> {
    const scoreboard = await ScoreboardModel.findOne({ areaId }).sort({ updatedAt: -1 })
    if (!scoreboard) return null
    return this.#toDTO(scoreboard, 'public')
  }

  // ─── internals ─────────────────────────────────────────────────────────

  #newSide(athlete: AthleteDocument, event: EventDocument): ScoreboardSideSub {
    return {
      athleteId: athlete._id,
      fullName: athlete.fullName,
      publicName: publicDisplayName(
        athlete.fullName,
        athlete.birthDate,
        event.eventDate,
        event.publicHideNamesUnderAge ?? null,
      ),
      clubName: athlete.clubName ?? null,
      identity: resolveAthleteIdentity(athlete).label,
      ippon: 0,
      wazaari: 0,
      yuko: 0,
      shido: 0,
      hansokuMake: false,
    }
  }

  #applyToSide(scoreboard: ScoreboardDocument, side: SideKey, fn: (s: SideScore) => SideScore) {
    try {
      const current = scoreboard.sides[side]
      const next = fn({
        ippon: current.ippon,
        wazaari: current.wazaari,
        yuko: current.yuko,
        shido: current.shido,
        hansokuMake: current.hansokuMake,
      })
      Object.assign(scoreboard.sides[side], next)
    } catch (err) {
      if (err instanceof ScoreboardRulesError) throw new ScoreboardServiceError(err.message, 409)
      throw err
    }
  }

  // A decisive score (ippon / hansoku-make / first score in golden score)
  // stops the clock and any osaekomi — the fight is over, pending the
  // operator's explicit winner declaration.
  #afterScoringChange(scoreboard: ScoreboardDocument) {
    if (endsFight(scoreboard.sides.A, scoreboard.sides.B, scoreboard.phase)) {
      this.#freezeClock(scoreboard)
      scoreboard.osaekomi = null
    }
  }

  #currentClockMs(scoreboard: ScoreboardDocument): number {
    const { clockMs, running, lastStartedAt, countsUp } = scoreboard.clock
    if (!running || !lastStartedAt) return clockMs
    const elapsed = Date.now() - lastStartedAt.getTime()
    return countsUp ? clockMs + elapsed : Math.max(0, clockMs - elapsed)
  }

  #freezeClock(scoreboard: ScoreboardDocument) {
    scoreboard.clock.clockMs = this.#currentClockMs(scoreboard)
    scoreboard.clock.running = false
    scoreboard.clock.lastStartedAt = null
  }

  async #findScoreboard(scoreboardId: string, academyId: string) {
    const scoreboard = await ScoreboardModel.findOne({ _id: scoreboardId })
    if (!scoreboard) throw new ScoreboardServiceError('Scoreboard not found', 404)
    const event = await EventModel.findOne({ _id: scoreboard.eventId, hostAcademyId: academyId })
    if (!event) throw new ScoreboardServiceError('Scoreboard not found', 404)
    return scoreboard
  }

  async #findActive(scoreboardId: string, academyId: string) {
    const scoreboard = await this.#findScoreboard(scoreboardId, academyId)
    if (scoreboard.status !== 'active') {
      throw new ScoreboardServiceError('Scoreboard is not active', 409)
    }
    return scoreboard
  }

  async #findEvent(eventId: string, academyId: string) {
    const event = await EventModel.findOne({ _id: eventId, hostAcademyId: academyId })
    if (!event) throw new ScoreboardServiceError('Event not found', 404)
    return event
  }

  #broadcast(scoreboard: ScoreboardDocument) {
    scoreboardEvents.emit(`area:${scoreboard.areaId.toString()}`, this.#toDTO(scoreboard, 'public'))
  }

  #toDTO(scoreboard: ScoreboardDocument, audience: 'operator' | 'public'): ScoreboardDTO {
    const side = (s: ScoreboardSideSub) => ({
      athleteId: s.athleteId.toString(),
      displayName: audience === 'public' ? s.publicName : s.fullName,
      clubName: s.clubName,
      // Operator-only — the public payload must not carry an identifier
      // that isn't needed to run the event and could help re-identify a
      // minor (CLAUDE.md: public screens show only what the event needs).
      identity: audience === 'public' ? null : s.identity,
      ippon: s.ippon,
      wazaari: s.wazaari,
      yuko: s.yuko,
      shido: s.shido,
      hansokuMake: s.hansokuMake,
    })
    return {
      id: scoreboard._id.toString(),
      eventId: scoreboard.eventId.toString(),
      divisionId: scoreboard.divisionId.toString(),
      divisionName: scoreboard.divisionName,
      areaId: scoreboard.areaId.toString(),
      matchId: scoreboard.matchId.toString(),
      matchNumber: scoreboard.matchNumber,
      phase: scoreboard.phase,
      status: scoreboard.status,
      matchRules: scoreboard.matchRules,
      clock: {
        clockMs: scoreboard.clock.clockMs,
        running: scoreboard.clock.running,
        lastStartedAt: scoreboard.clock.lastStartedAt?.toISOString() ?? null,
        countsUp: scoreboard.clock.countsUp,
      },
      osaekomi: scoreboard.osaekomi
        ? { holder: scoreboard.osaekomi.holder, startedAt: scoreboard.osaekomi.startedAt.toISOString() }
        : null,
      sides: { A: side(scoreboard.sides.A), B: side(scoreboard.sides.B) },
      winner: scoreboard.winner
        ? { athleteId: scoreboard.winner.athleteId.toString(), method: scoreboard.winner.method }
        : null,
      updatedAt: scoreboard.updatedAt.toISOString(),
    }
  }
}

export class ScoreboardServiceError extends Error {
  constructor(
    message: string,
    public readonly statusCode: 400 | 404 | 409,
  ) {
    super(message)
    this.name = 'ScoreboardServiceError'
  }
}
