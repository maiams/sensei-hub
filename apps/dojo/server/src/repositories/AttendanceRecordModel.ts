import { Schema, model, type Types } from 'mongoose'
import type { AttendanceResult } from '@dojo/shared'

export type AttendanceSource = 'roster' | 'student_request' | 'coach_entry' | 'request_rejected' | 'request_expired' | 'no_request' | 'correction'

export interface AttendanceRecordDocument {
  _id: Types.ObjectId
  academyId: Types.ObjectId
  lessonId: Types.ObjectId
  classId: Types.ObjectId
  athleteId: Types.ObjectId
  result: AttendanceResult
  source: AttendanceSource
  requestId?: Types.ObjectId
  recordedAt?: Date
  recordedBy?: Types.ObjectId
  version: number
  createdAt: Date
  updatedAt: Date
}

const attendanceRecordSchema = new Schema<AttendanceRecordDocument>({
  academyId: { type: Schema.Types.ObjectId, ref: 'Academy', required: true },
  lessonId: { type: Schema.Types.ObjectId, ref: 'Lesson', required: true },
  classId: { type: Schema.Types.ObjectId, ref: 'TrainingClass', required: true },
  athleteId: { type: Schema.Types.ObjectId, ref: 'Athlete', required: true },
  result: { type: String, required: true, enum: ['unmarked', 'present', 'absent'], default: 'unmarked' },
  source: { type: String, required: true, enum: ['roster', 'student_request', 'coach_entry', 'request_rejected', 'request_expired', 'no_request', 'correction'], default: 'roster' },
  requestId: { type: Schema.Types.ObjectId, ref: 'AttendanceRequest' },
  recordedAt: { type: Date },
  recordedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  version: { type: Number, required: true, default: 0 },
}, { timestamps: true })

attendanceRecordSchema.index({ academyId: 1, lessonId: 1, athleteId: 1 }, { unique: true })
attendanceRecordSchema.index({ academyId: 1, athleteId: 1, lessonId: 1 })

export const AttendanceRecordModel = model<AttendanceRecordDocument>('AttendanceRecord', attendanceRecordSchema)
