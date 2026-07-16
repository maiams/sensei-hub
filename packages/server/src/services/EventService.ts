import { EventModel, type EventDocument } from '../repositories/EventModel.js'
import { AuditLogModel } from '../repositories/AuditLogModel.js'
import type { CreateEventInput, UpdateEventInput } from '@sensei-hub/shared'

export interface EventCtx {
  userId: string
  academyId: string
  sessionId: string
  ip?: string
}

export type CreateEventParams = Omit<CreateEventInput, 'hostAcademyId'>

export class EventService {
  async createEvent(academyId: string, input: CreateEventParams, ctx: EventCtx) {
    const event = await EventModel.create({
      hostAcademyId: academyId,
      name: input.name,
      description: input.description,
      eventDate: input.eventDate,
      venue: input.venue,
      createdBy: ctx.userId,
    })

    await AuditLogModel.create({
      userId: ctx.userId,
      entityType: 'Event',
      entityId: event._id,
      action: 'create',
      sessionId: ctx.sessionId,
      ip: ctx.ip,
    })

    return this.#toDTO(event)
  }

  async listEvents(academyId: string) {
    const events = await EventModel.find({ hostAcademyId: academyId }).sort({ eventDate: -1 })
    return events.map((e) => this.#toDTO(e))
  }

  async getEvent(id: string, academyId: string) {
    const event = await EventModel.findOne({ _id: id, hostAcademyId: academyId })
    if (!event) {
      throw new EventServiceError('Event not found', 404)
    }
    return this.#toDTO(event)
  }

  async updateEvent(id: string, academyId: string, input: UpdateEventInput, ctx: EventCtx) {
    const event = await EventModel.findOne({ _id: id, hostAcademyId: academyId })
    if (!event) {
      throw new EventServiceError('Event not found', 404)
    }

    const auditEntries: Array<{ fieldName: string; oldValue: unknown; newValue: unknown }> = []
    const fields = ['name', 'description', 'eventDate', 'venue', 'status'] as const
    for (const field of fields) {
      const newValue = input[field]
      if (newValue === undefined) continue
      const oldValue = event[field]
      if (oldValue !== newValue) {
        auditEntries.push({ fieldName: field, oldValue, newValue })
        // @ts-expect-error — dynamic assignment across a known field union
        event[field] = newValue
      }
    }

    if (auditEntries.length > 0) {
      await event.save()
      await AuditLogModel.create(
        auditEntries.map((entry) => ({
          userId: ctx.userId,
          entityType: 'Event',
          entityId: event._id,
          action: 'update' as const,
          fieldName: entry.fieldName,
          oldValue: entry.oldValue,
          newValue: entry.newValue,
          sessionId: ctx.sessionId,
          ip: ctx.ip,
        })),
      )
    }

    return this.#toDTO(event)
  }

  #toDTO(event: EventDocument) {
    return {
      id: event._id.toString(),
      hostAcademyId: event.hostAcademyId.toString(),
      name: event.name,
      description: event.description,
      eventDate: event.eventDate,
      venue: event.venue,
      status: event.status,
      createdBy: event.createdBy.toString(),
      createdAt: event.createdAt.toISOString(),
      updatedAt: event.updatedAt.toISOString(),
    }
  }
}

export class EventServiceError extends Error {
  constructor(
    message: string,
    public readonly statusCode: 404,
  ) {
    super(message)
    this.name = 'EventServiceError'
  }
}
