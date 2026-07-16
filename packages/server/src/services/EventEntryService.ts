import { EventEntryModel, type EventEntryDocument } from '../repositories/EventEntryModel.js'
import { EventModel } from '../repositories/EventModel.js'
import { DivisionModel } from '../repositories/DivisionModel.js'
import { AthleteModel } from '../repositories/AthleteModel.js'
import { AuditLogModel } from '../repositories/AuditLogModel.js'
import { WeightService } from './WeightService.js'
import type { AthleteCtx } from './AthleteService.js'
import type { CreateEventEntryInput, EventEntryStatus } from '@sensei-hub/shared'

// Explicit state machine — "incomplete" is reserved for Fase 3D's Excel import
// (a row missing required fields); nothing creates that status yet, but the
// transition out of it is defined for forward compatibility. "withdrawn" is
// terminal and reachable from any non-terminal status, per product spec.
const VALID_TRANSITIONS: Record<EventEntryStatus, EventEntryStatus[]> = {
  incomplete: ['registered', 'withdrawn'],
  registered: ['checked_in', 'withdrawn'],
  checked_in: ['weighed_in', 'withdrawn'],
  weighed_in: ['confirmed', 'withdrawn'],
  confirmed: ['withdrawn'],
  withdrawn: [],
}

export class EventEntryService {
  #weightService = new WeightService()

  async listEntries(
    eventId: string,
    academyId: string,
    filters: { divisionId?: string | undefined; status?: EventEntryStatus | undefined } = {},
  ) {
    await this.#findEvent(eventId, academyId)
    const query: Record<string, unknown> = { eventId }
    if (filters.divisionId) query['divisionId'] = filters.divisionId
    if (filters.status) query['status'] = filters.status
    const entries = await EventEntryModel.find(query).sort({ createdAt: 1 })
    return entries.map((e) => this.#toDTO(e))
  }

  async createManualEntry(eventId: string, academyId: string, input: CreateEventEntryInput, ctx: AthleteCtx) {
    await this.#findEvent(eventId, academyId)

    const division = await DivisionModel.findOne({ _id: input.divisionId, eventId })
    if (!division) {
      throw new EventEntryServiceError('Division not found', 404)
    }
    const athlete = await AthleteModel.findOne({ _id: input.athleteId, academyId })
    if (!athlete) {
      throw new EventEntryServiceError('Athlete not found', 404)
    }

    let entry: EventEntryDocument
    try {
      entry = await EventEntryModel.create({
        eventId,
        divisionId: input.divisionId,
        athleteId: input.athleteId,
        academyId,
        registrationMethod: 'manual',
        status: 'registered',
        declaredWeightKg: input.declaredWeightKg,
        notes: input.notes,
      })
    } catch (err) {
      if (this.#isDuplicateKeyError(err)) {
        throw new EventEntryServiceError('Athlete is already registered in this division', 409)
      }
      throw err
    }

    await AuditLogModel.create({
      userId: ctx.userId,
      entityType: 'EventEntry',
      entityId: entry._id,
      action: 'create',
      sessionId: ctx.sessionId,
      ip: ctx.ip,
    })

    return this.#toDTO(entry)
  }

  async checkIn(eventId: string, academyId: string, entryId: string, ctx: AthleteCtx) {
    const entry = await this.#findEntry(eventId, academyId, entryId)
    this.#assertTransition(entry.status, 'checked_in')

    const oldStatus = entry.status
    entry.status = 'checked_in'
    await entry.save()
    await this.#auditStatusChange(entry._id, oldStatus, 'checked_in', ctx)

    return this.#toDTO(entry)
  }

  // Records the official weigh-in via WeightService (creating a real
  // WeightRecord tied to the athlete, same as the athlete-profile weigh-in
  // flow). Exceeding the division's weightLimitKg is only a warning
  // (`withinDivisionLimit: false`) — confirmEntry is what decides the final
  // division, so operators aren't blocked mid-weigh-in.
  async recordWeighIn(eventId: string, academyId: string, entryId: string, weightKg: number, ctx: AthleteCtx) {
    const entry = await this.#findEntry(eventId, academyId, entryId)
    this.#assertTransition(entry.status, 'weighed_in')

    await this.#weightService.recordWeight(entry.athleteId.toString(), weightKg, 'manual', ctx, eventId)

    const division = await DivisionModel.findById(entry.divisionId)
    const withinDivisionLimit = !division?.weightLimitKg || weightKg <= division.weightLimitKg

    const oldStatus = entry.status
    entry.status = 'weighed_in'
    entry.confirmedWeightKg = weightKg
    await entry.save()
    await this.#auditStatusChange(entry._id, oldStatus, 'weighed_in', ctx)

    return { ...this.#toDTO(entry), withinDivisionLimit }
  }

  // Allows moving the athlete into a different division than originally
  // entered — the common case where weigh-in landed them in another bracket.
  async confirmEntry(eventId: string, academyId: string, entryId: string, confirmedDivisionId: string | undefined, ctx: AthleteCtx) {
    const entry = await this.#findEntry(eventId, academyId, entryId)
    this.#assertTransition(entry.status, 'confirmed')

    const targetDivisionId = confirmedDivisionId ?? entry.divisionId.toString()
    const division = await DivisionModel.findOne({ _id: targetDivisionId, eventId })
    if (!division) {
      throw new EventEntryServiceError('Division not found', 404)
    }

    const oldStatus = entry.status
    entry.status = 'confirmed'
    entry.confirmedDivisionId = division._id
    await entry.save()
    await this.#auditStatusChange(entry._id, oldStatus, 'confirmed', ctx)

    return this.#toDTO(entry)
  }

  async withdrawEntry(eventId: string, academyId: string, entryId: string, reason: string, ctx: AthleteCtx) {
    const entry = await this.#findEntry(eventId, academyId, entryId)
    this.#assertTransition(entry.status, 'withdrawn')

    const oldStatus = entry.status
    entry.status = 'withdrawn'
    entry.withdrawnReason = reason
    await entry.save()

    await AuditLogModel.create({
      userId: ctx.userId,
      entityType: 'EventEntry',
      entityId: entry._id,
      action: 'update',
      fieldName: 'status',
      oldValue: oldStatus,
      newValue: 'withdrawn',
      reason,
      sessionId: ctx.sessionId,
      ip: ctx.ip,
    })

    return this.#toDTO(entry)
  }

  async #findEvent(eventId: string, academyId: string) {
    const event = await EventModel.findOne({ _id: eventId, hostAcademyId: academyId })
    if (!event) {
      throw new EventEntryServiceError('Event not found', 404)
    }
    return event
  }

  async #findEntry(eventId: string, academyId: string, entryId: string) {
    await this.#findEvent(eventId, academyId)
    const entry = await EventEntryModel.findOne({ _id: entryId, eventId })
    if (!entry) {
      throw new EventEntryServiceError('Entry not found', 404)
    }
    return entry
  }

  #assertTransition(current: EventEntryStatus, target: EventEntryStatus) {
    const allowed = VALID_TRANSITIONS[current]
    if (!allowed.includes(target)) {
      throw new EventEntryServiceError(`Cannot transition entry from "${current}" to "${target}"`, 409)
    }
  }

  async #auditStatusChange(entryId: EventEntryDocument['_id'], oldStatus: string, newStatus: string, ctx: AthleteCtx) {
    await AuditLogModel.create({
      userId: ctx.userId,
      entityType: 'EventEntry',
      entityId: entryId,
      action: 'update',
      fieldName: 'status',
      oldValue: oldStatus,
      newValue: newStatus,
      sessionId: ctx.sessionId,
      ip: ctx.ip,
    })
  }

  #isDuplicateKeyError(err: unknown): boolean {
    return typeof err === 'object' && err !== null && 'code' in err && (err as { code: unknown }).code === 11000
  }

  #toDTO(entry: EventEntryDocument) {
    return {
      id: entry._id.toString(),
      eventId: entry.eventId.toString(),
      divisionId: entry.divisionId.toString(),
      confirmedDivisionId: entry.confirmedDivisionId?.toString(),
      athleteId: entry.athleteId.toString(),
      academyId: entry.academyId.toString(),
      registrationMethod: entry.registrationMethod,
      status: entry.status,
      declaredWeightKg: entry.declaredWeightKg,
      confirmedWeightKg: entry.confirmedWeightKg,
      notes: entry.notes,
      withdrawnReason: entry.withdrawnReason,
      createdAt: entry.createdAt.toISOString(),
      updatedAt: entry.updatedAt.toISOString(),
    }
  }
}

export class EventEntryServiceError extends Error {
  constructor(
    message: string,
    public readonly statusCode: 404 | 409,
  ) {
    super(message)
    this.name = 'EventEntryServiceError'
  }
}
