import { Schema, model } from 'mongoose'

export interface AcademyDocument {
  _id: Schema.Types.ObjectId
  name: string
  slug: string
  athleteSeq: number
  createdAt: Date
  updatedAt: Date
}

const academySchema = new Schema<AcademyDocument>(
  {
    name: { type: String, required: true, trim: true, maxlength: 200 },
    slug: { type: String, required: true, unique: true, lowercase: true, trim: true },
    // Atomically incremented via findByIdAndUpdate($inc) to generate enrollmentNumber.
    athleteSeq: { type: Number, required: true, default: 0 },
  },
  { timestamps: true },
)

export const AcademyModel = model<AcademyDocument>('Academy', academySchema)
