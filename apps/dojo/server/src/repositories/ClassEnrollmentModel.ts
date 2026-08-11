import { Schema, model, type Types } from 'mongoose'

export interface ClassEnrollmentDocument {
  _id: Types.ObjectId
  academyId: Types.ObjectId
  classId: Types.ObjectId
  athleteId: Types.ObjectId
  active: boolean
  startedAt: Date
  endedAt?: Date
  endedBy?: Types.ObjectId
  endReason?: string
  createdBy: Types.ObjectId
  createdAt: Date
  updatedAt: Date
}

const classEnrollmentSchema = new Schema<ClassEnrollmentDocument>({
  academyId: { type: Schema.Types.ObjectId, ref: 'Academy', required: true },
  classId: { type: Schema.Types.ObjectId, ref: 'TrainingClass', required: true },
  athleteId: { type: Schema.Types.ObjectId, ref: 'Athlete', required: true },
  active: { type: Boolean, required: true, default: true },
  startedAt: { type: Date, required: true, default: () => new Date() },
  endedAt: { type: Date },
  endedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  endReason: { type: String, maxlength: 500 },
  createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
}, { timestamps: true })

classEnrollmentSchema.index({ academyId: 1, athleteId: 1 }, { unique: true, partialFilterExpression: { active: true } })
classEnrollmentSchema.index({ academyId: 1, classId: 1, active: 1, athleteId: 1 })

export const ClassEnrollmentModel = model<ClassEnrollmentDocument>('ClassEnrollment', classEnrollmentSchema)
