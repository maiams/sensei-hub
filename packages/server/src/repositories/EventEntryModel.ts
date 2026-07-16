import { Schema, model, type Types } from 'mongoose'
import type { EventEntryStatus, RegistrationMethod } from '@sensei-hub/shared'

export interface EventEntryDocument {
  _id: Types.ObjectId
  eventId: Types.ObjectId
  divisionId: Types.ObjectId
  confirmedDivisionId?: Types.ObjectId
  athleteId: Types.ObjectId
  academyId: Types.ObjectId
  registrationMethod: RegistrationMethod
  importJobId?: Types.ObjectId
  status: EventEntryStatus
  declaredWeightKg?: number
  confirmedWeightKg?: number
  notes?: string
  withdrawnReason?: string
  disqualifiedReason?: string
  createdAt: Date
  updatedAt: Date
}

const eventEntrySchema = new Schema<EventEntryDocument>(
  {
    eventId: { type: Schema.Types.ObjectId, ref: 'Event', required: true },
    divisionId: { type: Schema.Types.ObjectId, ref: 'Division', required: true },
    confirmedDivisionId: { type: Schema.Types.ObjectId, ref: 'Division' },
    athleteId: { type: Schema.Types.ObjectId, ref: 'Athlete', required: true },
    academyId: { type: Schema.Types.ObjectId, ref: 'Academy', required: true },
    registrationMethod: { type: String, required: true, enum: ['import', 'manual'] },
    importJobId: { type: Schema.Types.ObjectId, ref: 'ImportJob' },
    status: {
      type: String,
      required: true,
      enum: ['incomplete', 'registered', 'checked_in', 'weighed_in', 'confirmed', 'disqualified', 'withdrawn'],
      default: 'registered',
    },
    declaredWeightKg: { type: Number },
    confirmedWeightKg: { type: Number },
    notes: { type: String, maxlength: 500 },
    withdrawnReason: { type: String, maxlength: 500 },
    disqualifiedReason: { type: String, maxlength: 500 },
  },
  { timestamps: true },
)

// One active entry per athlete per division — prevents accidental double
// registration. The same athlete CAN have entries in different divisions of
// the same event (e.g. a declared-weight backup bracket).
eventEntrySchema.index({ eventId: 1, divisionId: 1, athleteId: 1 }, { unique: true })
eventEntrySchema.index({ eventId: 1, status: 1 })

export const EventEntryModel = model<EventEntryDocument>('EventEntry', eventEntrySchema)
