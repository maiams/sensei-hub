import { Schema, model, type Types } from 'mongoose'
import type { AttendanceRequestStatus, LocationStatus } from '@dojo/shared'

export interface AttendanceRequestDocument {
  _id: Types.ObjectId
  academyId: Types.ObjectId
  lessonId: Types.ObjectId
  classId: Types.ObjectId
  athleteId: Types.ObjectId
  status: AttendanceRequestStatus
  requestedAt: Date
  locationStatus: LocationStatus
  distanceMeters?: number
  accuracyMeters?: number
  clientCapturedAt?: Date
  decidedAt?: Date
  decidedBy?: Types.ObjectId
  rejectionReason?: string
  expirationReason?: string
  createdAt: Date
  updatedAt: Date
}

const attendanceRequestSchema = new Schema<AttendanceRequestDocument>({
  academyId: { type: Schema.Types.ObjectId, ref: 'Academy', required: true },
  lessonId: { type: Schema.Types.ObjectId, ref: 'Lesson', required: true },
  classId: { type: Schema.Types.ObjectId, ref: 'TrainingClass', required: true },
  athleteId: { type: Schema.Types.ObjectId, ref: 'Athlete', required: true },
  status: { type: String, required: true, enum: ['pending', 'confirmed', 'rejected', 'expired'], default: 'pending' },
  requestedAt: { type: Date, required: true, default: () => new Date() },
  locationStatus: { type: String, required: true, enum: ['inside', 'outside', 'unavailable'], default: 'unavailable' },
  distanceMeters: { type: Number, min: 0 },
  accuracyMeters: { type: Number, min: 0 },
  clientCapturedAt: { type: Date },
  decidedAt: { type: Date },
  decidedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  rejectionReason: { type: String, maxlength: 500 },
  expirationReason: { type: String, maxlength: 500 },
}, { timestamps: true })

attendanceRequestSchema.index({ academyId: 1, lessonId: 1, athleteId: 1 }, { unique: true })
attendanceRequestSchema.index({ academyId: 1, status: 1, lessonId: 1 })

export const AttendanceRequestModel = model<AttendanceRequestDocument>('AttendanceRequest', attendanceRequestSchema)
