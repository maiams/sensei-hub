import { Schema, model, type Types } from 'mongoose'
import type { EventStatus } from '@sensei-hub/shared'

export interface EventDocument {
  _id: Types.ObjectId
  hostAcademyId: Types.ObjectId
  name: string
  description?: string
  eventDate: string // YYYY-MM-DD
  venue?: string
  status: EventStatus
  createdBy: Types.ObjectId
  createdAt: Date
  updatedAt: Date
}

const eventSchema = new Schema<EventDocument>(
  {
    hostAcademyId: { type: Schema.Types.ObjectId, ref: 'Academy', required: true },
    name: { type: String, required: true, trim: true, maxlength: 200 },
    description: { type: String, maxlength: 2000 },
    eventDate: { type: String, required: true },
    venue: { type: String, trim: true, maxlength: 200 },
    status: {
      type: String,
      required: true,
      enum: ['draft', 'registration', 'in_progress', 'completed', 'cancelled'],
      default: 'draft',
    },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true },
)

eventSchema.index({ hostAcademyId: 1, eventDate: -1 })

export const EventModel = model<EventDocument>('Event', eventSchema)
