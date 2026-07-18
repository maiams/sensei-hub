import { Schema, model, type Types } from 'mongoose'

export type AuditAction = 'create' | 'update' | 'delete'

export interface AuditLogDocument {
  _id: Types.ObjectId
  userId: Types.ObjectId
  entityType: string
  entityId: Types.ObjectId
  action: AuditAction
  fieldName?: string
  oldValue?: unknown
  newValue?: unknown
  reason?: string
  sessionId: string
  ip?: string
  timestamp: Date
}

const auditLogSchema = new Schema<AuditLogDocument>(
  {
    userId: { type: Schema.Types.ObjectId, required: true },
    entityType: { type: String, required: true },
    entityId: { type: Schema.Types.ObjectId, required: true },
    action: { type: String, required: true, enum: ['create', 'update', 'delete'] },
    fieldName: { type: String },
    oldValue: { type: Schema.Types.Mixed },
    newValue: { type: Schema.Types.Mixed },
    reason: { type: String },
    sessionId: { type: String, required: true },
    ip: { type: String },
    timestamp: { type: Date, required: true, default: () => new Date() },
  },
  { versionKey: false },
)

auditLogSchema.index({ entityType: 1, entityId: 1, timestamp: -1 })
auditLogSchema.index({ userId: 1, timestamp: -1 })

export const AuditLogModel = model<AuditLogDocument>('AuditLog', auditLogSchema)
