import { Schema, model, type Types } from 'mongoose'
import type { CheckInMethod, AttendanceStatus } from '@sensei-hub/shared'

export interface AttendanceDocument {
  _id: Types.ObjectId
  eventId: Types.ObjectId
  athleteId: Types.ObjectId
  academyId: Types.ObjectId
  method: CheckInMethod
  operatorId: Types.ObjectId
  checkedInAt: Date
  status: AttendanceStatus
  // How many 'registered' entries this specific check-in action advanced to
  // 'checked_in' at creation time — a historical fact, not a live count, so
  // it's persisted rather than recomputed on read.
  entriesUpdated: number
  revokedReason?: string
  revokedBy?: Types.ObjectId
  revokedAt?: Date
  createdAt: Date
  updatedAt: Date
}

const attendanceSchema = new Schema<AttendanceDocument>(
  {
    eventId: { type: Schema.Types.ObjectId, ref: 'Event', required: true },
    athleteId: { type: Schema.Types.ObjectId, ref: 'Athlete', required: true },
    academyId: { type: Schema.Types.ObjectId, ref: 'Academy', required: true },
    method: { type: String, required: true, enum: ['qr', 'short_code', 'staff_search', 'manual'] },
    operatorId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    checkedInAt: { type: Date, required: true, default: () => new Date() },
    status: { type: String, required: true, enum: ['active', 'revoked'], default: 'active' },
    entriesUpdated: { type: Number, required: true, default: 0 },
    revokedReason: { type: String, maxlength: 500 },
    revokedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    revokedAt: { type: Date },
  },
  { timestamps: true },
)

// Prevents two simultaneous active check-ins for the same athlete at the
// same event, while still allowing a fresh check-in after an `undo` (which
// sets status:'revoked' rather than deleting — audit trail, never lost).
attendanceSchema.index(
  { athleteId: 1, eventId: 1 },
  { unique: true, partialFilterExpression: { status: 'active' } },
)
attendanceSchema.index({ eventId: 1, status: 1, checkedInAt: -1 })

export const AttendanceModel = model<AttendanceDocument>('Attendance', attendanceSchema)
