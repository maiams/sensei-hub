import { Types } from 'mongoose'
import { AreaModel, type AreaDocument } from '../repositories/AreaModel.js'
import { EventModel } from '../repositories/EventModel.js'
import { BracketModel } from '../repositories/BracketModel.js'
import { MatchModel } from '../repositories/MatchModel.js'
import { AuditLogModel } from '@sensei-hub/core-server'
import type { EventCtx } from './EventService.js'
import type { CreateAreaInput, UpdateAreaInput } from '@arena/shared'

export class AreaService {
  async createArea(eventId: string, academyId: string, input: CreateAreaInput, ctx: EventCtx) {
    await this.#findEvent(eventId, academyId)

    const area = await AreaModel.create({
      eventId,
      name: input.name,
      allowedDivisionIds: input.allowedDivisionIds ?? null,
    })

    await AuditLogModel.create({
      userId: ctx.userId,
      entityType: 'Area',
      entityId: area._id,
      action: 'create',
      sessionId: ctx.sessionId,
      ip: ctx.ip,
    })

    return this.#toDTO(area)
  }

  async listAreas(eventId: string, academyId: string) {
    await this.#findEvent(eventId, academyId)
    const areas = await AreaModel.find({ eventId }).sort({ createdAt: 1 })
    return areas.map((a) => this.#toDTO(a))
  }

  async updateArea(eventId: string, academyId: string, areaId: string, input: UpdateAreaInput, ctx: EventCtx) {
    await this.#findEvent(eventId, academyId)
    const area = await AreaModel.findOne({ _id: areaId, eventId })
    if (!area) {
      throw new AreaServiceError('Area not found', 404)
    }

    const auditEntries: Array<{ fieldName: string; oldValue: unknown; newValue: unknown }> = []

    if (input.name !== undefined && input.name !== area.name) {
      auditEntries.push({ fieldName: 'name', oldValue: area.name, newValue: input.name })
      area.name = input.name
    }

    if (input.allowedDivisionIds !== undefined) {
      const oldValue = area.allowedDivisionIds ? area.allowedDivisionIds.map((id) => id.toString()) : null
      const newValue = input.allowedDivisionIds
      if (JSON.stringify(oldValue) !== JSON.stringify(newValue)) {
        auditEntries.push({ fieldName: 'allowedDivisionIds', oldValue, newValue })
        area.allowedDivisionIds = newValue === null ? null : newValue.map((id) => new Types.ObjectId(id))
      }
    }

    if (auditEntries.length > 0) {
      await area.save()
      await AuditLogModel.create(
        auditEntries.map((entry) => ({
          userId: ctx.userId,
          entityType: 'Area',
          entityId: area._id,
          action: 'update' as const,
          fieldName: entry.fieldName,
          oldValue: entry.oldValue,
          newValue: entry.newValue,
          sessionId: ctx.sessionId,
          ip: ctx.ip,
        })),
      )
    }

    return this.#toDTO(area)
  }

  async deleteArea(eventId: string, academyId: string, areaId: string, ctx: EventCtx) {
    await this.#findEvent(eventId, academyId)
    const area = await AreaModel.findOne({ _id: areaId, eventId })
    if (!area) {
      throw new AreaServiceError('Area not found', 404)
    }

    const usedCount = await MatchModel.countDocuments({ areaId: area._id })
    if (usedCount > 0) {
      throw new AreaServiceError('Cannot delete an area that has already dispatched matches', 409)
    }

    await AreaModel.deleteOne({ _id: area._id })

    await AuditLogModel.create({
      userId: ctx.userId,
      entityType: 'Area',
      entityId: area._id,
      action: 'delete',
      oldValue: {
        name: area.name,
        allowedDivisionIds: area.allowedDivisionIds ? area.allowedDivisionIds.map((id) => id.toString()) : null,
      },
      sessionId: ctx.sessionId,
      ip: ctx.ip,
    })
  }

  async closeArea(eventId: string, academyId: string, areaId: string, reason: string, ctx: EventCtx) {
    await this.#findEvent(eventId, academyId)
    const area = await AreaModel.findOne({ _id: areaId, eventId })
    if (!area) {
      throw new AreaServiceError('Area not found', 404)
    }
    if (area.status === 'closed') {
      throw new AreaServiceError('Area is already closed', 409)
    }

    area.status = 'closed'
    area.closedReason = reason
    area.closedAt = new Date()
    await area.save()

    await AuditLogModel.create({
      userId: ctx.userId,
      entityType: 'Area',
      entityId: area._id,
      action: 'update',
      fieldName: 'status',
      oldValue: 'open',
      newValue: 'closed',
      reason,
      sessionId: ctx.sessionId,
      ip: ctx.ip,
    })

    // Free any match still claimed-but-undecided at this area, unconditionally.
    // If the match's division genuinely has nowhere else to go right now
    // (e.g. a PCD-only area), it just won't be picked up by any dispatch
    // until this area reopens or another open area is configured to accept
    // it — no special-casing needed here, listUnroutableMatches surfaces the
    // warning either way.
    await MatchModel.updateMany({ areaId: area._id, result: null }, { $set: { areaId: null } })

    const unroutableMatches = await this.listUnroutableMatches(eventId, academyId)
    return { area: this.#toDTO(area), unroutableMatches }
  }

  async reopenArea(eventId: string, academyId: string, areaId: string, ctx: EventCtx) {
    await this.#findEvent(eventId, academyId)
    const area = await AreaModel.findOne({ _id: areaId, eventId })
    if (!area) {
      throw new AreaServiceError('Area not found', 404)
    }
    if (area.status === 'open') {
      throw new AreaServiceError('Area is already open', 409)
    }

    const oldReason = area.closedReason
    // $unset instead of assigning `undefined` directly on the document —
    // exactOptionalPropertyTypes treats "possibly absent" and "explicitly
    // undefined" as different types, so a raw update sidesteps that entirely.
    await AreaModel.updateOne(
      { _id: area._id },
      { $set: { status: 'open' }, $unset: { closedReason: '', closedAt: '' } },
    )

    await AuditLogModel.create({
      userId: ctx.userId,
      entityType: 'Area',
      entityId: area._id,
      action: 'update',
      fieldName: 'status',
      oldValue: 'closed',
      newValue: 'open',
      reason: oldReason,
      sessionId: ctx.sessionId,
      ip: ctx.ip,
    })

    const updated = await AreaModel.findOne({ _id: area._id })
    return this.#toDTO(updated as AreaDocument)
  }

  // Ready matches (both athletes known, no result yet, belonging to an active
  // bracket) whose division isn't accepted by any currently open area — the
  // organizer needs to either reopen the area that used to take it, or edit
  // another open area's allowedDivisionIds to include it.
  async listUnroutableMatches(eventId: string, academyId: string) {
    await this.#findEvent(eventId, academyId)

    const openAreas = await AreaModel.find({ eventId, status: 'open' })
    const activeBrackets = await BracketModel.find({ eventId, status: 'active' })
    const activeBracketIds = activeBrackets.map((b) => b._id)

    const readyMatches = await MatchModel.find({
      bracketId: { $in: activeBracketIds },
      athleteAId: { $ne: null },
      athleteBId: { $ne: null },
      result: null,
    })

    return readyMatches
      .filter(
        (m) =>
          !openAreas.some(
            (a) => a.allowedDivisionIds === null || a.allowedDivisionIds.some((id) => id.equals(m.divisionId)),
          ),
      )
      .map((m) => ({
        id: m._id.toString(),
        matchNumber: m.matchNumber,
        divisionId: m.divisionId.toString(),
      }))
  }

  async #findEvent(eventId: string, academyId: string) {
    const event = await EventModel.findOne({ _id: eventId, hostAcademyId: academyId })
    if (!event) {
      throw new AreaServiceError('Event not found', 404)
    }
    return event
  }

  #toDTO(area: AreaDocument) {
    return {
      id: area._id.toString(),
      eventId: area.eventId.toString(),
      name: area.name,
      allowedDivisionIds: area.allowedDivisionIds ? area.allowedDivisionIds.map((id) => id.toString()) : null,
      status: area.status,
      closedReason: area.closedReason,
      closedAt: area.closedAt?.toISOString(),
      createdAt: area.createdAt.toISOString(),
      updatedAt: area.updatedAt.toISOString(),
    }
  }
}

export class AreaServiceError extends Error {
  constructor(
    message: string,
    public readonly statusCode: 404 | 409,
  ) {
    super(message)
    this.name = 'AreaServiceError'
  }
}
