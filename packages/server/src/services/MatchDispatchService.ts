import { AreaModel } from '../repositories/AreaModel.js'
import { BracketModel } from '../repositories/BracketModel.js'
import { MatchModel, type MatchDocument } from '../repositories/MatchModel.js'
import { ScoreboardModel } from '../repositories/ScoreboardModel.js'
import { EventModel } from '../repositories/EventModel.js'
import { AuditLogModel } from '@sensei-hub/core-server'
import type { EventCtx } from './EventService.js'

export interface DispatchCandidate {
  id: string
  matchNumber: number
  divisionId: string
  athleteAId: string
  athleteBId: string
  updatedAt: Date // stands in for "how long has this match been ready" — see BracketService#persistMatchUpdates
}

function isAthleteRested(
  athleteId: string,
  lastDecidedAtByAthleteId: Map<string, Date>,
  restMinutesMs: number,
  now: Date,
): boolean {
  const last = lastDecidedAtByAthleteId.get(athleteId)
  if (!last) return true
  return now.getTime() - last.getTime() >= restMinutesMs
}

// Pure decision core, tested in isolation (no DB) — same spirit as
// ImportService.matchDivision. Picks the oldest-ready candidate whose two
// athletes have both cleared the minimum rest window since their last
// decided match anywhere in the event; null if none qualify right now
// (a legitimately idle area, not an error).
export function pickNextMatch(
  candidates: DispatchCandidate[],
  lastDecidedAtByAthleteId: Map<string, Date>,
  restMinutesMs: number,
  now: Date,
): DispatchCandidate | null {
  const eligible = candidates.filter(
    (c) =>
      isAthleteRested(c.athleteAId, lastDecidedAtByAthleteId, restMinutesMs, now) &&
      isAthleteRested(c.athleteBId, lastDecidedAtByAthleteId, restMinutesMs, now),
  )
  if (eligible.length === 0) return null
  const sorted = [...eligible].sort((a, b) => a.updatedAt.getTime() - b.updatedAt.getTime())
  return sorted[0] ?? null
}

export class MatchDispatchService {
  async getNextMatchForArea(eventId: string, academyId: string, areaId: string, ctx: EventCtx) {
    const event = await this.#findEvent(eventId, academyId)
    const area = await AreaModel.findOne({ _id: areaId, eventId })
    if (!area) {
      throw new MatchDispatchServiceError('Area not found', 404)
    }
    if (area.status !== 'open') {
      throw new MatchDispatchServiceError('Area is closed', 409)
    }

    const activeBrackets = await BracketModel.find({ eventId, status: 'active' })
    const activeBracketIds = activeBrackets.map((b) => b._id)

    const candidateDocs = await MatchModel.find({
      bracketId: { $in: activeBracketIds },
      areaId: null,
      athleteAId: { $ne: null },
      athleteBId: { $ne: null },
      result: null,
      ...(area.allowedDivisionIds !== null ? { divisionId: { $in: area.allowedDivisionIds } } : {}),
    }).sort({ updatedAt: 1 })

    if (candidateDocs.length === 0) {
      return { match: null }
    }

    const athleteIds = [
      ...new Set(candidateDocs.flatMap((m) => [m.athleteAId?.toString(), m.athleteBId?.toString()])),
    ].filter((id): id is string => id !== undefined)

    const decidedMatches = await MatchModel.find({
      eventId,
      result: { $ne: null },
      $or: [{ athleteAId: { $in: athleteIds } }, { athleteBId: { $in: athleteIds } }],
    })

    const lastDecidedAtByAthleteId = new Map<string, Date>()
    for (const m of decidedMatches) {
      const decidedAt = m.result?.decidedAt
      if (!decidedAt) continue
      for (const athleteId of [m.athleteAId?.toString(), m.athleteBId?.toString()]) {
        if (!athleteId) continue
        const existing = lastDecidedAtByAthleteId.get(athleteId)
        if (!existing || decidedAt > existing) {
          lastDecidedAtByAthleteId.set(athleteId, decidedAt)
        }
      }
    }

    const restMinutesMs = event.restMinutesBetweenMatches * 60_000
    const now = new Date()

    // Try candidates oldest-first, claiming atomically; if another area's
    // concurrent request won the race for the picked match, drop it and
    // retry with what's left — low-concurrency by construction (a handful
    // of mats at most), so this never loops meaningfully long.
    let remaining = candidateDocs.map((m) => this.#toCandidate(m))
    while (remaining.length > 0) {
      const picked = pickNextMatch(remaining, lastDecidedAtByAthleteId, restMinutesMs, now)
      if (!picked) {
        return { match: null }
      }

      const claimed = await MatchModel.findOneAndUpdate(
        { _id: picked.id, areaId: null, result: null },
        { $set: { areaId: area._id } },
        { new: true },
      )
      if (claimed) {
        await AuditLogModel.create({
          userId: ctx.userId,
          entityType: 'Match',
          entityId: claimed._id,
          action: 'update',
          fieldName: 'areaId',
          newValue: area._id.toString(),
          sessionId: ctx.sessionId,
          ip: ctx.ip,
        })
        return {
          match: {
            id: claimed._id.toString(),
            matchNumber: claimed.matchNumber,
            divisionId: claimed.divisionId.toString(),
            athleteAId: claimed.athleteAId?.toString() as string,
            athleteBId: claimed.athleteBId?.toString() as string,
          },
        }
      }

      remaining = remaining.filter((c) => c.id !== picked.id)
    }

    return { match: null }
  }

  // Manual override ("this match, on this mat, now") — the JudoShiai
  // forcedtatami equivalent. Deliberately ignores the area's
  // allowedDivisionIds (it's an explicit event_manager decision), but still
  // enforces the athletes' minimum rest window unless `ignoreRest` is set —
  // the caller's UI must make that override explicit to the person.
  async forceMatchToArea(
    eventId: string,
    academyId: string,
    areaId: string,
    matchId: string,
    ignoreRest: boolean,
    ctx: EventCtx,
  ) {
    const event = await this.#findEvent(eventId, academyId)
    const area = await AreaModel.findOne({ _id: areaId, eventId })
    if (!area) throw new MatchDispatchServiceError('Area not found', 404)
    if (area.status !== 'open') throw new MatchDispatchServiceError('Area is closed', 409)

    const match = await MatchModel.findOne({ _id: matchId, eventId })
    if (!match) throw new MatchDispatchServiceError('Match not found', 404)
    if (match.result) throw new MatchDispatchServiceError('Match already has a result', 409)
    if (!match.athleteAId || !match.athleteBId) {
      throw new MatchDispatchServiceError('Match participants are not defined yet', 409)
    }

    const liveScoreboard = await ScoreboardModel.findOne({ matchId: match._id, status: 'active' })
    if (liveScoreboard) {
      throw new MatchDispatchServiceError('Match is already being fought on a scoreboard', 409)
    }

    if (!ignoreRest) {
      const athleteIds = [match.athleteAId.toString(), match.athleteBId.toString()]
      const decidedMatches = await MatchModel.find({
        eventId,
        result: { $ne: null },
        $or: [{ athleteAId: { $in: athleteIds } }, { athleteBId: { $in: athleteIds } }],
      })
      const restMs = event.restMinutesBetweenMatches * 60_000
      const now = Date.now()
      for (const m of decidedMatches) {
        const decidedAt = m.result?.decidedAt
        if (!decidedAt) continue
        for (const athleteId of [m.athleteAId?.toString(), m.athleteBId?.toString()]) {
          if (!athleteId || !athleteIds.includes(athleteId)) continue
          const readyAt = decidedAt.getTime() + restMs
          if (readyAt > now) {
            const remainingSec = Math.ceil((readyAt - now) / 1000)
            throw new MatchDispatchServiceError(
              `Athlete still resting for ${remainingSec}s — retry with ignoreRest to override`,
              409,
            )
          }
        }
      }
    }

    const previousAreaId = match.areaId?.toString() ?? null
    const claimed = await MatchModel.findOneAndUpdate(
      { _id: match._id, result: null },
      { $set: { areaId: area._id } },
      { new: true },
    )
    if (!claimed) {
      throw new MatchDispatchServiceError('Match already has a result', 409)
    }

    await AuditLogModel.create({
      userId: ctx.userId,
      entityType: 'Match',
      entityId: match._id,
      action: 'update',
      fieldName: 'areaId',
      oldValue: previousAreaId,
      newValue: area._id.toString(),
      reason: ignoreRest ? 'force-match (rest time overridden)' : 'force-match',
      sessionId: ctx.sessionId,
      ip: ctx.ip,
    })

    return {
      match: {
        id: claimed._id.toString(),
        matchNumber: claimed.matchNumber,
        divisionId: claimed.divisionId.toString(),
        athleteAId: claimed.athleteAId?.toString() as string,
        athleteBId: claimed.athleteBId?.toString() as string,
      },
    }
  }

  #toCandidate(m: MatchDocument): DispatchCandidate {
    return {
      id: m._id.toString(),
      matchNumber: m.matchNumber,
      divisionId: m.divisionId.toString(),
      athleteAId: m.athleteAId?.toString() as string,
      athleteBId: m.athleteBId?.toString() as string,
      updatedAt: m.updatedAt,
    }
  }

  async #findEvent(eventId: string, academyId: string) {
    const event = await EventModel.findOne({ _id: eventId, hostAcademyId: academyId })
    if (!event) {
      throw new MatchDispatchServiceError('Event not found', 404)
    }
    return event
  }
}

export class MatchDispatchServiceError extends Error {
  constructor(
    message: string,
    public readonly statusCode: 404 | 409,
  ) {
    super(message)
    this.name = 'MatchDispatchServiceError'
  }
}
