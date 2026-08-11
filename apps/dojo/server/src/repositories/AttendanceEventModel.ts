import { Schema, model, type Types } from 'mongoose'

export type AttendanceEventType = 'roster_added' | 'requested' | 'confirmed' | 'rejected' | 'expired' | 'direct_present' | 'corrected'

export interface AttendanceEventDocument {
  _id: Types.ObjectId
  academyId: Types.ObjectId
  lessonId: Types.ObjectId
  classId: Types.ObjectId
  athleteId: Types.ObjectId
  attendanceId?: Types.ObjectId
  requestId?: Types.ObjectId
  type: AttendanceEventType
  actorId?: Types.ObjectId
  fromResult?: string
  toResult?: string
  reason?: string
  occurredAt: Date
}

const attendanceEventSchema = new Schema<AttendanceEventDocument>({
  academyId: { type: Schema.Types.ObjectId, ref: 'Academy', required: true },
  lessonId: { type: Schema.Types.ObjectId, ref: 'Lesson', required: true },
  classId: { type: Schema.Types.ObjectId, ref: 'TrainingClass', required: true },
  athleteId: { type: Schema.Types.ObjectId, ref: 'Athlete', required: true },
  attendanceId: { type: Schema.Types.ObjectId, ref: 'AttendanceRecord' },
  requestId: { type: Schema.Types.ObjectId, ref: 'AttendanceRequest' },
  type: { type: String, required: true, enum: ['roster_added', 'requested', 'confirmed', 'rejected', 'expired', 'direct_present', 'corrected'] },
  actorId: { type: Schema.Types.ObjectId, ref: 'User' },
  fromResult: { type: String },
  toResult: { type: String },
  reason: { type: String, maxlength: 500 },
  occurredAt: { type: Date, required: true, default: () => new Date() },
}, { versionKey: false })

attendanceEventSchema.index({ academyId: 1, lessonId: 1, athleteId: 1, occurredAt: 1 })
attendanceEventSchema.index({ attendanceId: 1, occurredAt: 1 })

export const AttendanceEventModel = model<AttendanceEventDocument>('AttendanceEvent', attendanceEventSchema)
