import { Schema, model, type Types } from 'mongoose'

export type LessonStatus = 'scheduled' | 'cancelled' | 'closed'

export interface LessonDocument {
  _id: Types.ObjectId
  academyId: Types.ObjectId
  classId: Types.ObjectId
  coachId: Types.ObjectId
  startsAt: Date
  endsAt: Date
  requestOpensAt: Date
  requestClosesAt: Date
  decisionDeadlineAt: Date
  status: LessonStatus
  createdAt: Date
  updatedAt: Date
}

const lessonSchema = new Schema<LessonDocument>({
  academyId: { type: Schema.Types.ObjectId, ref: 'Academy', required: true },
  classId: { type: Schema.Types.ObjectId, ref: 'TrainingClass', required: true },
  coachId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  startsAt: { type: Date, required: true },
  endsAt: { type: Date, required: true },
  requestOpensAt: { type: Date, required: true },
  requestClosesAt: { type: Date, required: true },
  decisionDeadlineAt: { type: Date, required: true },
  status: { type: String, required: true, enum: ['scheduled', 'cancelled', 'closed'], default: 'scheduled' },
}, { timestamps: true })

lessonSchema.index({ academyId: 1, classId: 1, startsAt: 1 }, { unique: true })
lessonSchema.index({ academyId: 1, startsAt: 1 })
lessonSchema.index({ academyId: 1, coachId: 1, startsAt: 1 })
lessonSchema.index({ status: 1, decisionDeadlineAt: 1 })

export const LessonModel = model<LessonDocument>('Lesson', lessonSchema)
