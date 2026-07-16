import { DivisionModel, type DivisionDocument } from '../repositories/DivisionModel.js'
import { EventModel } from '../repositories/EventModel.js'
import { DivisionTemplateModel } from '../repositories/DivisionTemplateModel.js'
import { DivisionGroupModel } from '../repositories/DivisionGroupModel.js'
import { EventEntryModel } from '../repositories/EventEntryModel.js'
import { AuditLogModel } from '../repositories/AuditLogModel.js'
import type { EventCtx } from './EventService.js'
import type { CreateDivisionInput, UpdateDivisionInput, ImportDivisionsFromTemplatesInput } from '@sensei-hub/shared'

export class DivisionService {
  async listDivisions(eventId: string, academyId: string) {
    await this.#findEvent(eventId, academyId)
    const divisions = await DivisionModel.find({ eventId }).sort({ createdAt: 1 })
    return divisions.map((d) => this.#toDTO(d))
  }

  async createDivision(eventId: string, academyId: string, input: CreateDivisionInput, ctx: EventCtx) {
    await this.#findEvent(eventId, academyId)

    const division = await DivisionModel.create({
      eventId,
      name: input.name,
      minAge: input.minAge ?? null,
      maxAge: input.maxAge ?? null,
      weightLimitKg: input.weightLimitKg ?? null,
    })

    await AuditLogModel.create({
      userId: ctx.userId,
      entityType: 'Division',
      entityId: division._id,
      action: 'create',
      sessionId: ctx.sessionId,
      ip: ctx.ip,
    })

    return this.#toDTO(division)
  }

  async updateDivision(
    eventId: string,
    academyId: string,
    divisionId: string,
    input: UpdateDivisionInput,
    ctx: EventCtx,
  ) {
    await this.#findEvent(eventId, academyId)
    const division = await DivisionModel.findOne({ _id: divisionId, eventId })
    if (!division) {
      throw new DivisionServiceError('Division not found', 404)
    }

    const auditEntries: Array<{ fieldName: string; oldValue: unknown; newValue: unknown }> = []
    const fields = ['name', 'minAge', 'maxAge', 'weightLimitKg'] as const
    for (const field of fields) {
      const newValue = input[field]
      if (newValue === undefined) continue
      const oldValue = division[field]
      if (oldValue !== newValue) {
        auditEntries.push({ fieldName: field, oldValue, newValue })
        // @ts-expect-error — dynamic assignment across a known field union
        division[field] = newValue
      }
    }

    if (auditEntries.length > 0) {
      await division.save()
      await AuditLogModel.create(
        auditEntries.map((entry) => ({
          userId: ctx.userId,
          entityType: 'Division',
          entityId: division._id,
          action: 'update' as const,
          fieldName: entry.fieldName,
          oldValue: entry.oldValue,
          newValue: entry.newValue,
          sessionId: ctx.sessionId,
          ip: ctx.ip,
        })),
      )
    }

    return this.#toDTO(division)
  }

  async deleteDivision(eventId: string, academyId: string, divisionId: string, ctx: EventCtx) {
    await this.#findEvent(eventId, academyId)
    const division = await DivisionModel.findOne({ _id: divisionId, eventId })
    if (!division) {
      throw new DivisionServiceError('Division not found', 404)
    }

    const entryCount = await EventEntryModel.countDocuments({ divisionId })
    if (entryCount > 0) {
      throw new DivisionServiceError('Cannot delete a division that has entries', 409)
    }

    await DivisionModel.deleteOne({ _id: division._id })

    await AuditLogModel.create({
      userId: ctx.userId,
      entityType: 'Division',
      entityId: division._id,
      action: 'delete',
      oldValue: {
        name: division.name,
        minAge: division.minAge,
        maxAge: division.maxAge,
        weightLimitKg: division.weightLimitKg,
      },
      sessionId: ctx.sessionId,
      ip: ctx.ip,
    })
  }

  // Expands the academy's DivisionTemplate x DivisionGroup x weight-category
  // rows into individual event Divisions — one bracket per weight category,
  // matching how a real tournament schedules matches. Divisions created this
  // way are ordinary rows afterwards: the organizer can rename, merge, or
  // delete any of them freely, same as anything created via createDivision.
  async importFromTemplates(
    eventId: string,
    academyId: string,
    input: ImportDivisionsFromTemplatesInput,
    ctx: EventCtx,
  ) {
    await this.#findEvent(eventId, academyId)

    const templateQuery: Record<string, unknown> = { academyId }
    if (input.templateKeys && input.templateKeys.length > 0) {
      templateQuery['key'] = { $in: input.templateKeys }
    }
    const templates = await DivisionTemplateModel.find(templateQuery)
    if (templates.length === 0) {
      return []
    }

    const templateIds = templates.map((t) => t._id)
    const groups = await DivisionGroupModel.find({
      academyId,
      divisionTemplateId: { $in: templateIds },
    }).sort({ order: 1 })

    const groupsByTemplate = new Map<string, typeof groups>()
    for (const group of groups) {
      const key = group.divisionTemplateId.toString()
      const list = groupsByTemplate.get(key) ?? []
      list.push(group)
      groupsByTemplate.set(key, list)
    }

    const created: DivisionDocument[] = []
    for (const template of templates) {
      const templateGroups = groupsByTemplate.get(template._id.toString()) ?? []
      for (const group of templateGroups) {
        for (const category of group.categories) {
          const division = await DivisionModel.create({
            eventId,
            name: `${template.label} — ${group.label} — ${category.label}`,
            minAge: template.minAge,
            maxAge: template.maxAge,
            weightLimitKg: category.maxKg,
            sourceTemplateKey: template.key,
            sourceGroupId: group._id,
          })
          created.push(division)
        }
      }
    }

    if (created.length > 0) {
      await AuditLogModel.create({
        userId: ctx.userId,
        entityType: 'Event',
        entityId: eventId,
        action: 'create',
        reason: 'import-divisions-from-templates',
        sessionId: ctx.sessionId,
        ip: ctx.ip,
      })
    }

    return created.map((d) => this.#toDTO(d))
  }

  async #findEvent(eventId: string, academyId: string) {
    const event = await EventModel.findOne({ _id: eventId, hostAcademyId: academyId })
    if (!event) {
      throw new DivisionServiceError('Event not found', 404)
    }
    return event
  }

  #toDTO(division: DivisionDocument) {
    return {
      id: division._id.toString(),
      eventId: division.eventId.toString(),
      name: division.name,
      minAge: division.minAge,
      maxAge: division.maxAge,
      weightLimitKg: division.weightLimitKg,
      sourceTemplateKey: division.sourceTemplateKey,
      sourceGroupId: division.sourceGroupId?.toString(),
      createdAt: division.createdAt.toISOString(),
    }
  }
}

export class DivisionServiceError extends Error {
  constructor(
    message: string,
    public readonly statusCode: 404 | 409,
  ) {
    super(message)
    this.name = 'DivisionServiceError'
  }
}
