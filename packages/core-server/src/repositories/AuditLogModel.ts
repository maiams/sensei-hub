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
  // `timestamp` is always the server's own clock at the moment it received
  // and committed the write — the authoritative "recebido em" for anything
  // ordering- or trust-sensitive. `occurredAt`/`stationId`/`clientSeq` are
  // only set when the write came from a client-side durable queue (offline
  // check-in/weigh-in replayed after a connectivity gap): `occurredAt` is the
  // operator's own device clock at the moment they acted ("ocorrido em" —
  // informational, station clocks are not trusted and this is never used to
  // order or gate anything), and `stationId`/`clientSeq` say which station
  // and its own monotonic counter, for a durable "who/where" even when the
  // request arrives well after the fact.
  occurredAt?: Date
  stationId?: string
  clientSeq?: number
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
    occurredAt: { type: Date },
    stationId: { type: String },
    clientSeq: { type: Number },
    timestamp: { type: Date, required: true, default: () => new Date() },
  },
  { versionKey: false },
)

auditLogSchema.index({ entityType: 1, entityId: 1, timestamp: -1 })
auditLogSchema.index({ userId: 1, timestamp: -1 })

export const AuditLogModel = model<AuditLogDocument>('AuditLog', auditLogSchema)
