import { Schema, model, type Types } from 'mongoose'
import type { UserRole } from '@sensei-hub/shared'

export interface UserDocument {
  _id: Types.ObjectId
  academyId: Types.ObjectId
  email: string
  passwordHash: string
  name: string
  role: UserRole
  active: boolean
  createdAt: Date
  updatedAt: Date
}

const userSchema = new Schema<UserDocument>(
  {
    academyId: { type: Schema.Types.ObjectId, ref: 'Academy', required: true, index: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true, select: false },
    name: { type: String, required: true, trim: true, maxlength: 120 },
    role: {
      type: String,
      required: true,
      enum: [
        'super_admin',
        'academy_admin',
        'event_manager',
        'coach',
        'staff',
        'weigh_in_operator',
        'scoreboard_operator',
        'athlete',
        'guardian',
      ],
    },
    active: { type: Boolean, default: true },
  },
  { timestamps: true },
)

userSchema.index({ academyId: 1, role: 1 })

export const UserModel = model<UserDocument>('User', userSchema)
