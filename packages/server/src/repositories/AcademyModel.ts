import { Schema, model } from 'mongoose'

export interface AcademyDocument {
  _id: Schema.Types.ObjectId
  name: string
  slug: string
  createdAt: Date
  updatedAt: Date
}

const academySchema = new Schema<AcademyDocument>(
  {
    name: { type: String, required: true, trim: true, maxlength: 200 },
    slug: { type: String, required: true, unique: true, lowercase: true, trim: true },
  },
  { timestamps: true },
)

export const AcademyModel = model<AcademyDocument>('Academy', academySchema)
