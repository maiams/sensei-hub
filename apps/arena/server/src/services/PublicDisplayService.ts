import { EventModel } from '../repositories/EventModel.js'
import { AreaModel } from '../repositories/AreaModel.js'
import { BracketModel } from '../repositories/BracketModel.js'
import { MatchModel } from '../repositories/MatchModel.js'
import { DivisionModel } from '../repositories/DivisionModel.js'
import { AthleteModel } from '../repositories/AthleteModel.js'
import { publicDisplayName } from '../domain/publicName.js'
import { ScoreboardService } from './ScoreboardService.js'

// Data for the public venue displays (no auth): what's being fought on each
// mat right now plus the upcoming-matches queue with rest countdowns — the
// judoinfo-equivalent screen. Names are always privacy-filtered through
// Event.publicHideNamesUnderAge; nothing else about the athlete leaves here.
export class PublicDisplayService {
  #scoreboards = new ScoreboardService()

  async getEventDisplay(eventId: string) {
    const event = await EventModel.findOne({ _id: eventId })
    if (!event) throw new PublicDisplayServiceError('Event not found', 404)

    const areas = await AreaModel.find({ eventId }).sort({ createdAt: 1 })
    const areaPayloads = await Promise.all(
      areas.map(async (area) => ({
        id: area._id.toString(),
        name: area.name,
        status: area.status,
        scoreboard: await this.#scoreboards.getPublicScoreboardForArea(area._id.toString()),
      })),
    )

    // Upcoming = every ready match not yet claimed by an area. Ordered by
    // division then matchNumber — the order of dispute an athlete can
    // actually anticipate on the venue board. `updatedAt` used to be the sort
    // key, but it reflects "last touched", not "next in line": anything that
    // re-saves a match (dispatch/rest checks/corrections elsewhere) bumps it,
    // so the queue reshuffled unpredictably on screen.
    const activeBrackets = await BracketModel.find({ eventId, status: 'active' })
    const upcomingDocs = await MatchModel.find({
      bracketId: { $in: activeBrackets.map((b) => b._id) },
      areaId: null,
      athleteAId: { $ne: null },
      athleteBId: { $ne: null },
      result: null,
    })
      .sort({ divisionId: 1, matchNumber: 1 })
      .limit(12)

    const divisionIds = [...new Set(upcomingDocs.map((m) => m.divisionId.toString()))]
    const divisions = await DivisionModel.find({ _id: { $in: divisionIds } })
    const divisionNameById = new Map(divisions.map((d) => [d._id.toString(), d.name]))

    const athleteIds = [
      ...new Set(upcomingDocs.flatMap((m) => [m.athleteAId?.toString(), m.athleteBId?.toString()])),
    ].filter((id): id is string => id !== undefined)
    const athletes = await AthleteModel.find({ _id: { $in: athleteIds } })
    const athleteById = new Map(athletes.map((a) => [a._id.toString(), a]))

    // Rest countdown: an athlete is ready again restMinutes after their last
    // decided match (result.decidedAt — same source the dispatcher uses).
    const decidedMatches = await MatchModel.find({
      eventId,
      result: { $ne: null },
      $or: [{ athleteAId: { $in: athleteIds } }, { athleteBId: { $in: athleteIds } }],
    })
    const lastDecidedAt = new Map<string, Date>()
    for (const m of decidedMatches) {
      const decidedAt = m.result?.decidedAt
      if (!decidedAt) continue
      for (const athleteId of [m.athleteAId?.toString(), m.athleteBId?.toString()]) {
        if (!athleteId) continue
        const existing = lastDecidedAt.get(athleteId)
        if (!existing || decidedAt > existing) lastDecidedAt.set(athleteId, decidedAt)
      }
    }
    const restMs = event.restMinutesBetweenMatches * 60_000
    const readyAtFor = (athleteId: string): Date | null => {
      const last = lastDecidedAt.get(athleteId)
      if (!last) return null
      const readyAt = new Date(last.getTime() + restMs)
      return readyAt.getTime() > Date.now() ? readyAt : null
    }

    const hideUnder = event.publicHideNamesUnderAge ?? null
    const sideFor = (athleteId: string) => {
      const athlete = athleteById.get(athleteId)
      if (!athlete) return { displayName: '—', clubName: null, restingUntil: null }
      return {
        displayName: publicDisplayName(athlete.fullName, athlete.birthDate, event.eventDate, hideUnder),
        clubName: athlete.clubName ?? null,
        restingUntil: readyAtFor(athleteId)?.toISOString() ?? null,
      }
    }

    return {
      event: { id: event._id.toString(), name: event.name, eventDate: event.eventDate },
      areas: areaPayloads,
      upcoming: upcomingDocs.map((m) => ({
        matchId: m._id.toString(),
        matchNumber: m.matchNumber,
        divisionName: divisionNameById.get(m.divisionId.toString()) ?? '—',
        athleteA: sideFor(m.athleteAId?.toString() as string),
        athleteB: sideFor(m.athleteBId?.toString() as string),
      })),
    }
  }
}

export class PublicDisplayServiceError extends Error {
  constructor(
    message: string,
    public readonly statusCode: 404,
  ) {
    super(message)
    this.name = 'PublicDisplayServiceError'
  }
}
