import mongoose from 'mongoose'
import { EventEntryModel, type EventEntryDocument } from '../repositories/EventEntryModel.js'
import { EventModel } from '../repositories/EventModel.js'
import { DivisionModel, type DivisionDocument } from '../repositories/DivisionModel.js'
import { AthleteModel } from '../repositories/AthleteModel.js'
import { AuditLogModel } from '@sensei-hub/core-server'
import { WeightService } from './WeightService.js'
import { BracketService } from './BracketService.js'
import { resolveAthleteIdentity } from '@arena/shared'
import type { AuthCtx } from '@sensei-hub/core-server'
import type { CreateEventEntryInput, EventEntryStatus } from '@arena/shared'

// Explicit state machine — "incomplete" is reserved for Fase 3D's Excel import
// (a row missing required fields); nothing creates that status yet, but the
// transition out of it is defined for forward compatibility. "withdrawn" and
// "disqualified" are terminal and are not correctable through the state
// machine (same accepted limitation as withdrawn since Fase 3A: undoing one
// requires a new entry, not a status transition).
const VALID_TRANSITIONS: Record<EventEntryStatus, EventEntryStatus[]> = {
  incomplete: ['registered', 'withdrawn'],
  registered: ['checked_in', 'withdrawn'],
  checked_in: ['weighed_in', 'disqualified', 'withdrawn'],
  weighed_in: ['confirmed', 'withdrawn'],
  confirmed: ['withdrawn'],
  disqualified: [],
  withdrawn: [],
}

export class EventEntryService {
  #weightService = new WeightService()
  #bracketService = new BracketService()

  // weigh_in_operator reads this list too (see routes/events.ts) to run its
  // queue, so the DTO carries the athlete's display name plus a resolved
  // identity label — nothing else from the athlete registry (no CPF/phone/
  // guardian/medical ever leaves this method; federationNumber/zempoNumber/
  // cpf/birthDate are read here only to feed resolveAthleteIdentity, which
  // itself never returns the raw cpf — see @arena/shared/athleteIdentity.ts).
  // Batched into one query, scoped to the event's own academy, so the
  // operator can never see names for athletes outside this event's roster.
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

    const athleteIds = [...new Set(entries.map((e) => e.athleteId.toString()))]
    const athletes = await AthleteModel.find({ _id: { $in: athleteIds }, academyId }).select(
      'fullName preferredName federationNumber zempoNumber cpf birthDate',
    )
    const nameById = new Map(athletes.map((a) => [a._id.toString(), a.preferredName || a.fullName]))
    const identityById = new Map(athletes.map((a) => [a._id.toString(), resolveAthleteIdentity(a).label]))

    return entries.map((e) =>
      this.#toDTO(e, nameById.get(e.athleteId.toString()), identityById.get(e.athleteId.toString())),
    )
  }

  async createManualEntry(eventId: string, academyId: string, input: CreateEventEntryInput, ctx: AuthCtx) {
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

  async checkIn(eventId: string, academyId: string, entryId: string, ctx: AuthCtx) {
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
  // flow). If the weight is within the division's weightLimitKg, nothing
  // else happens. If it exceeds the limit, the event's overweightPolicy
  // decides the outcome:
  //  - 'reallocate': move the entry into the lightest sibling division (same
  //    sourceGroupId) whose limit still fits — still lands in "weighed_in",
  //    so confirmEntry remains the operator's next step. If no sibling fits
  //    (or the division has no sourceGroupId — a manually created division
  //    has no siblings to search), falls back to disqualifying.
  //  - 'disqualify': the entry moves straight to the terminal "disqualified"
  //    status.
  async recordWeighIn(eventId: string, academyId: string, entryId: string, weightKg: number, ctx: AuthCtx) {
    const event = await this.#findEvent(eventId, academyId)
    const entry = await EventEntryModel.findOne({ _id: entryId, eventId })
    if (!entry) {
      throw new EventEntryServiceError('Entry not found', 404)
    }
    this.#assertTransition(entry.status, 'weighed_in')

    await this.#weightService.recordWeight(entry.athleteId.toString(), weightKg, 'manual', ctx, eventId)

    const division = await DivisionModel.findById(entry.divisionId)
    const overLimit = division?.weightLimitKg != null && weightKg > division.weightLimitKg

    if (!overLimit) {
      const oldStatus = entry.status
      entry.status = 'weighed_in'
      entry.confirmedWeightKg = weightKg
      await entry.save()
      await this.#auditStatusChange(entry._id, oldStatus, 'weighed_in', ctx)
      return { ...this.#toDTO(entry), outcome: 'ok' as const }
    }

    if (event.overweightPolicy === 'reallocate' && division) {
      const target = await this.#findReallocationTarget(eventId, division, weightKg)
      if (target) {
        const oldStatus = entry.status
        const oldDivisionId = entry.divisionId
        entry.status = 'weighed_in'
        entry.confirmedWeightKg = weightKg
        entry.divisionId = target._id
        await entry.save()
        await this.#auditStatusChange(entry._id, oldStatus, 'weighed_in', ctx)
        await AuditLogModel.create({
          userId: ctx.userId,
          entityType: 'EventEntry',
          entityId: entry._id,
          action: 'update',
          fieldName: 'divisionId',
          oldValue: oldDivisionId.toString(),
          newValue: target._id.toString(),
          reason: `Peso acima do limite da divisão (${weightKg}kg > ${division.weightLimitKg}kg) — realocado automaticamente`,
          sessionId: ctx.sessionId,
          ip: ctx.ip,
        })
        return { ...this.#toDTO(entry), outcome: 'reallocated' as const }
      }
    }

    const oldStatus = entry.status
    const reason = `Peso acima do limite da divisão (${weightKg}kg > ${division?.weightLimitKg}kg)`
    entry.status = 'disqualified'
    entry.confirmedWeightKg = weightKg
    entry.disqualifiedReason = reason
    await entry.save()
    await AuditLogModel.create({
      userId: ctx.userId,
      entityType: 'EventEntry',
      entityId: entry._id,
      action: 'update',
      fieldName: 'status',
      oldValue: oldStatus,
      newValue: 'disqualified',
      reason,
      sessionId: ctx.sessionId,
      ip: ctx.ip,
    })
    return { ...this.#toDTO(entry), outcome: 'disqualified' as const }
  }

  // Only searches among divisions imported together from the same academy
  // DivisionGroup (sourceGroupId) — that's the only reliable signal that two
  // divisions represent weight brackets of the same category. Picks the
  // lightest one that still fits the actual weight.
  async #findReallocationTarget(eventId: string, fromDivision: DivisionDocument, weightKg: number) {
    if (!fromDivision.sourceGroupId) return null
    const candidates = await DivisionModel.find({
      eventId,
      sourceGroupId: fromDivision.sourceGroupId,
      _id: { $ne: fromDivision._id },
    })
    const fitting = candidates.filter((d) => d.weightLimitKg == null || d.weightLimitKg >= weightKg)
    fitting.sort((a, b) => {
      if (a.weightLimitKg == null) return 1
      if (b.weightLimitKg == null) return -1
      return a.weightLimitKg - b.weightLimitKg
    })
    return fitting[0] ?? null
  }

  // Allows moving the athlete into a different division than originally
  // entered — the common case where weigh-in landed them in another bracket.
  async confirmEntry(eventId: string, academyId: string, entryId: string, confirmedDivisionId: string | undefined, ctx: AuthCtx) {
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

  // Moves an entry to a different division — the normal way to send an
  // athlete to another category (single-athlete category, weight mistake,
  // late reclassification, etc.), *not* a transition of the check-in/weigh-in
  // state machine: unlike confirmEntry (only legal from "weighed_in", moving
  // the entry into "confirmed"), this works from any non-terminal status and
  // never touches `status` itself. That's the reason this is its own
  // operation instead of extending confirmEntry: the two have genuinely
  // different semantics (confirm = "lock in category after weigh-in", move =
  // "relocate regardless of where we are in the flow"), and keeping them
  // separate makes the audit trail read unambiguously ("division changed by
  // move" vs "status changed to confirmed"). withdrawn/disqualified are
  // terminal and excluded, same as every other transition in this service —
  // undoing one of those still requires a fresh entry, a known limitation.
  //
  // Always writes to confirmedDivisionId (never the original `divisionId`,
  // which stays as the historical record of how the athlete first entered).
  // Every other place in the codebase already reads the effective division
  // as `confirmedDivisionId ?? divisionId`, so this is enough to relocate the
  // entry everywhere (roster grouping, bracket eligibility once confirmed,
  // weigh-in/confirm defaults) without special-casing the current status.
  //
  // If the origin or destination division has an active bracket, that
  // bracket no longer reflects reality once the move happens (a participant
  // appeared or disappeared), so it's archived — explicitly and audited, via
  // BracketService.archiveActiveBracketForEntryMove — rather than left stale.
  // Archiving never deletes recorded matches (see that method). Because
  // archiving a bracket is a real loss (the manager must regenerate it), a
  // reason is mandatory whenever this happens; a same-event move that
  // touches no bracket can go through without one.
  async moveEntry(
    eventId: string,
    academyId: string,
    entryId: string,
    targetDivisionId: string,
    reason: string | undefined,
    ctx: AuthCtx,
  ) {
    const entry = await this.#findEntry(eventId, academyId, entryId)
    if (entry.status === 'withdrawn' || entry.status === 'disqualified') {
      throw new EventEntryServiceError(`Cannot move an entry with status "${entry.status}"`, 409)
    }

    const targetDivision = await DivisionModel.findOne({ _id: targetDivisionId, eventId })
    if (!targetDivision) {
      throw new EventEntryServiceError('Division not found', 404)
    }

    const oldDivisionId = (entry.confirmedDivisionId ?? entry.divisionId).toString()
    if (oldDivisionId === targetDivisionId) {
      throw new EventEntryServiceError('Entry is already in this division', 409)
    }

    // Same duplicate guard as createManualEntry, but against the *effective*
    // division (confirmedDivisionId ?? divisionId) of every other active
    // entry for this athlete — the unique index on the raw divisionId field
    // wouldn't catch this since move only ever writes confirmedDivisionId.
    const siblingEntries = await EventEntryModel.find({
      eventId,
      athleteId: entry.athleteId,
      _id: { $ne: entry._id },
      status: { $nin: ['withdrawn', 'disqualified'] },
    })
    const alreadyThere = siblingEntries.some(
      (e) => (e.confirmedDivisionId ?? e.divisionId).toString() === targetDivisionId,
    )
    if (alreadyThere) {
      throw new EventEntryServiceError('Athlete already has an active entry in this division', 409)
    }

    // Read-only check, before any write: decide whether a reason is required
    // *before* archiving anything, so a missing reason never leaves a
    // half-applied move.
    const [originBracket, destBracket] = await Promise.all([
      this.#bracketService.hasActiveBracket(eventId, oldDivisionId),
      this.#bracketService.hasActiveBracket(eventId, targetDivisionId),
    ])
    const destructive = originBracket || destBracket
    if (destructive && (!reason || reason.trim().length < 3)) {
      throw new EventEntryServiceError(
        'A reason (at least 3 characters) is required to move an entry when it invalidates an existing bracket',
        400,
      )
    }

    const oldDivisionName = (await DivisionModel.findById(oldDivisionId))?.name ?? oldDivisionId

    const session = await mongoose.startSession()
    try {
      await session.withTransaction(async () => {
        if (originBracket) {
          await this.#bracketService.archiveActiveBracketForEntryMove(
            eventId,
            oldDivisionId,
            `Atleta movida para "${targetDivision.name}"${reason ? ` — ${reason}` : ''}`,
            ctx,
            session,
          )
        }
        if (destBracket) {
          await this.#bracketService.archiveActiveBracketForEntryMove(
            eventId,
            targetDivisionId,
            `Atleta movida de "${oldDivisionName}"${reason ? ` — ${reason}` : ''}`,
            ctx,
            session,
          )
        }

        entry.confirmedDivisionId = targetDivision._id
        await entry.save({ session })

        await AuditLogModel.create(
          [
            {
              userId: ctx.userId,
              entityType: 'EventEntry',
              entityId: entry._id,
              action: 'update',
              fieldName: 'divisionId',
              oldValue: oldDivisionId,
              newValue: targetDivisionId,
              reason,
              sessionId: ctx.sessionId,
              ip: ctx.ip,
            },
          ],
          { session },
        )
      })
    } finally {
      await session.endSession()
    }

    return this.#toDTO(entry)
  }

  async withdrawEntry(eventId: string, academyId: string, entryId: string, reason: string, ctx: AuthCtx) {
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

  async #auditStatusChange(entryId: EventEntryDocument['_id'], oldStatus: string, newStatus: string, ctx: AuthCtx) {
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

  #toDTO(entry: EventEntryDocument, athleteName?: string, athleteIdentity?: string) {
    return {
      id: entry._id.toString(),
      eventId: entry.eventId.toString(),
      divisionId: entry.divisionId.toString(),
      confirmedDivisionId: entry.confirmedDivisionId?.toString(),
      athleteId: entry.athleteId.toString(),
      athleteName,
      athleteIdentity,
      academyId: entry.academyId.toString(),
      registrationMethod: entry.registrationMethod,
      status: entry.status,
      declaredWeightKg: entry.declaredWeightKg,
      confirmedWeightKg: entry.confirmedWeightKg,
      notes: entry.notes,
      withdrawnReason: entry.withdrawnReason,
      disqualifiedReason: entry.disqualifiedReason,
      createdAt: entry.createdAt.toISOString(),
      updatedAt: entry.updatedAt.toISOString(),
    }
  }
}

export class EventEntryServiceError extends Error {
  constructor(
    message: string,
    public readonly statusCode: 400 | 404 | 409,
  ) {
    super(message)
    this.name = 'EventEntryServiceError'
  }
}
