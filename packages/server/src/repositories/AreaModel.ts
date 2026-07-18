import { Schema, model, type Types } from 'mongoose'

export interface AreaDocument {
  _id: Types.ObjectId
  eventId: Types.ObjectId
  name: string
  // null = accepts any division; a non-null list restricts this area to
  // specific divisions (e.g. a smaller mat reserved for Sub-11, or a
  // PCD-only area) — set manually by the organizer, never inferred.
  allowedDivisionIds: Types.ObjectId[] | null
  status: 'open' | 'closed'
  closedReason?: string
  closedAt?: Date
  createdAt: Date
  updatedAt: Date
}

const areaSchema = new Schema<AreaDocument>(
  {
    eventId: { type: Schema.Types.ObjectId, ref: 'Event', required: true },
    name: { type: String, required: true, trim: true, maxlength: 60 },
    allowedDivisionIds: { type: [Schema.Types.ObjectId], ref: 'Division', default: null },
    status: { type: String, required: true, enum: ['open', 'closed'], default: 'open' },
    closedReason: { type: String, trim: true },
    closedAt: { type: Date },
  },
  { timestamps: true },
)

areaSchema.index({ eventId: 1 })

export const AreaModel = model<AreaDocument>('Area', areaSchema)
