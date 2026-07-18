import { Schema, model, type Types } from 'mongoose'
import type { EventStatus, OverweightPolicy } from '@sensei-hub/shared'

export interface EventDocument {
  _id: Types.ObjectId
  hostAcademyId: Types.ObjectId
  name: string
  description?: string
  eventDate: string // YYYY-MM-DD
  venue?: string
  status: EventStatus
  overweightPolicy: OverweightPolicy
  // Minimum rest (minutes) an athlete must have between two matches, enforced
  // by MatchDispatchService. Default is the CBJ national rule (RNC 2025,
  // p.28) — see packages/shared/src/domain/event.ts for the citation.
  restMinutesBetweenMatches: number
  // Hide names of athletes younger than this on public screens ("FirstName
  // L."); null = show full names. See shared CreateEventInput for details.
  publicHideNamesUnderAge: number | null
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
    overweightPolicy: {
      type: String,
      required: true,
      enum: ['disqualify', 'reallocate'],
      default: 'disqualify',
    },
    restMinutesBetweenMatches: { type: Number, required: true, default: 10 },
    publicHideNamesUnderAge: { type: Number, default: null },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true },
)

eventSchema.index({ hostAcademyId: 1, eventDate: -1 })

export const EventModel = model<EventDocument>('Event', eventSchema)
