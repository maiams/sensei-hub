import { Schema, model, type Types } from 'mongoose'

export interface RefreshTokenDocument {
  _id: Types.ObjectId
  userId: Types.ObjectId
  tokenHash: string
  expiresAt: Date
  createdAt: Date
}

const refreshTokenSchema = new Schema<RefreshTokenDocument>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    tokenHash: { type: String, required: true },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
)

// MongoDB removes documents automatically when expiresAt is reached
refreshTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 })

export const RefreshTokenModel = model<RefreshTokenDocument>('RefreshToken', refreshTokenSchema)
