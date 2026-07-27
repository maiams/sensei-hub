import { Types, type HydratedDocument } from 'mongoose'
import { AttendanceModel, type AttendanceDocument } from '../repositories/AttendanceModel.js'
import { EventModel } from '../repositories/EventModel.js'
import { AthleteModel } from '../repositories/AthleteModel.js'
import { EventEntryModel } from '../repositories/EventEntryModel.js'
import { AuditLogModel } from '@sensei-hub/core-server'
import { EventEntryService } from './EventEntryService.js'
import { resolveOccurredAt, parseOccurredAtOrUndefined } from '../domain/offlineWrite.js'
import type { AuthCtx } from '@sensei-hub/core-server'
import type { AttendanceDTO, CheckInMethod } from '@arena/shared'

// Physical presence check-in — separate from EventEntry (per-division
// registration progress, Fase 3A). One Attendance record per athlete per
// event is the audit trail of "who walked in, when, how, checked in by
// whom"; it also nudges every one of that athlete's 'registered' entries in
// this event forward to 'checked_in' (reusing EventEntryService.checkIn's
// own transition + audit logging, one call per entry).
export class CheckInService {
  #entryService = new EventEntryService()

  async checkIn(eventId: string, academyId: string, athleteId: string, method: CheckInMethod, ctx: AuthCtx) {
    await this.#findEvent(eventId, academyId)
    const athlete = await AthleteModel.findOne({ _id: athleteId, academyId })
    if (!athlete) {
      throw new CheckInServiceError('Athlete not found', 404)
    }

    const existing = await AttendanceModel.findOne({ athleteId, eventId, status: 'active' })
    if (existing) {
      throw new CheckInServiceError('Athlete already checked in for this event', 409, this.#toDTO(existing))
    }

    let attendance: HydratedDocument<AttendanceDocument>
    try {
      attendance = await AttendanceModel.create({
        eventId,
        athleteId,
        academyId,
        method,
        operatorId: ctx.userId,
        // The business fact "when did the athlete actually check in" —
        // preserved from the offline queue's own timestamp when this
        // request was replayed late; server-receipt time lives separately
        // on the AuditLog entry below, which is always "now".
        checkedInAt: resolveOccurredAt(ctx.occurredAt),
        status: 'active',
      })
    } catch (err) {
      if (this.#isDuplicateKeyError(err)) {
        // Race: another request checked this athlete in between our read and write.
        const raced = await AttendanceModel.findOne({ athleteId, eventId, status: 'active' })
        throw new CheckInServiceError(
          'Athlete already checked in for this event',
          409,
          raced ? this.#toDTO(raced) : undefined,
        )
      }
      throw err
    }

    // Best-effort: check-in doesn't require a division registration to
    // exist yet (staff may sort the athlete into a division afterwards) —
    // it just advances whichever entries are already waiting on it.
    const registeredEntries = await EventEntryModel.find({ eventId, athleteId, status: 'registered' })
    let entriesUpdated = 0
    for (const entry of registeredEntries) {
      await this.#entryService.checkIn(eventId, academyId, entry._id.toString(), ctx)
      entriesUpdated++
    }

    // Persisted (not just returned) — this is what makes GET /checkin's
    // listing show the real count instead of always reading back 0.
    attendance.entriesUpdated = entriesUpdated
    await attendance.save()

    const checkInOccurredAt = parseOccurredAtOrUndefined(ctx.occurredAt)
    await AuditLogModel.create({
      userId: ctx.userId,
      entityType: 'Attendance',
      entityId: attendance._id,
      action: 'create',
      fieldName: 'method',
      newValue: method,
      sessionId: ctx.sessionId,
      ip: ctx.ip,
      // Set only when this check-in came off the offline queue (replayed
      // after a connectivity gap) — see AuthCtx's doc comment.
      ...(checkInOccurredAt ? { occurredAt: checkInOccurredAt } : {}),
      ...(ctx.stationId !== undefined ? { stationId: ctx.stationId } : {}),
      ...(ctx.clientSeq !== undefined ? { clientSeq: ctx.clientSeq } : {}),
    })

    return this.#toDTO(attendance)
  }

  // Revokes the Attendance (audit trail — never deleted) and reverts any of
  // the athlete's entries that are still exactly 'checked_in' back to
  // 'registered'. Entries that already progressed further (weighed_in,
  // confirmed, ...) are deliberately left untouched — same "no cascading
  // undo past a later state" philosophy used for bracket result correction
  // and EventEntry's terminal statuses; fixing those requires the specific
  // correction flow for that stage, not an accidental side effect of
  // undoing a check-in.
  async undoCheckIn(eventId: string, academyId: string, attendanceId: string, reason: string, ctx: AuthCtx) {
    await this.#findEvent(eventId, academyId)
    const attendance = await AttendanceModel.findOne({ _id: attendanceId, eventId, academyId })
    if (!attendance) {
      throw new CheckInServiceError('Attendance not found', 404)
    }
    if (attendance.status !== 'active') {
      throw new CheckInServiceError('Check-in already undone', 409)
    }

    attendance.status = 'revoked'
    attendance.revokedReason = reason
    attendance.revokedBy = new Types.ObjectId(ctx.userId)
    attendance.revokedAt = new Date()
    await attendance.save()

    await AuditLogModel.create({
      userId: ctx.userId,
      entityType: 'Attendance',
      entityId: attendance._id,
      action: 'update',
      fieldName: 'status',
      oldValue: 'active',
      newValue: 'revoked',
      reason,
      sessionId: ctx.sessionId,
      ip: ctx.ip,
    })

    const revertible = await EventEntryModel.find({
      eventId,
      athleteId: attendance.athleteId,
      status: 'checked_in',
    })
    let entriesReverted = 0
    for (const entry of revertible) {
      const oldStatus = entry.status
      entry.status = 'registered'
      await entry.save()
      await AuditLogModel.create({
        userId: ctx.userId,
        entityType: 'EventEntry',
        entityId: entry._id,
        action: 'update',
        fieldName: 'status',
        oldValue: oldStatus,
        newValue: 'registered',
        reason: `Check-in desfeito: ${reason}`,
        sessionId: ctx.sessionId,
        ip: ctx.ip,
      })
      entriesReverted++
    }

    return this.#toDTO(attendance)
  }

  async listAttendance(eventId: string, academyId: string, filters: { status?: 'active' | 'revoked' } = {}) {
    await this.#findEvent(eventId, academyId)
    const query: Record<string, unknown> = { eventId }
    if (filters.status) query['status'] = filters.status
    const records = await AttendanceModel.find(query).sort({ checkedInAt: -1 })
    return records.map((r) => this.#toDTO(r))
  }

  async #findEvent(eventId: string, academyId: string) {
    const event = await EventModel.findOne({ _id: eventId, hostAcademyId: academyId })
    if (!event) {
      throw new CheckInServiceError('Event not found', 404)
    }
    return event
  }

  #isDuplicateKeyError(err: unknown): boolean {
    return typeof err === 'object' && err !== null && 'code' in err && (err as { code: unknown }).code === 11000
  }

  #toDTO(attendance: AttendanceDocument): AttendanceDTO {
    return {
      id: attendance._id.toString(),
      eventId: attendance.eventId.toString(),
      athleteId: attendance.athleteId.toString(),
      method: attendance.method,
      operatorId: attendance.operatorId.toString(),
      checkedInAt: attendance.checkedInAt.toISOString(),
      status: attendance.status,
      ...(attendance.revokedReason !== undefined ? { revokedReason: attendance.revokedReason } : {}),
      ...(attendance.revokedBy !== undefined ? { revokedBy: attendance.revokedBy.toString() } : {}),
      ...(attendance.revokedAt !== undefined ? { revokedAt: attendance.revokedAt.toISOString() } : {}),
      entriesUpdated: attendance.entriesUpdated,
    }
  }
}

export class CheckInServiceError extends Error {
  constructor(
    message: string,
    public readonly statusCode: 404 | 409,
    public readonly details?: AttendanceDTO,
  ) {
    super(message)
    this.name = 'CheckInServiceError'
  }
}
