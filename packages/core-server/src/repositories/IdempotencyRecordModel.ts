import { Schema, model, type Types } from 'mongoose'

export type IdempotencyRecordStatus = 'in_progress' | 'completed'

// Durable dedup record for a client-generated idempotency key (see
// withIdempotency.ts). One document per (route, key): a station on flaky
// venue WiFi may replay the exact same queued write several times (network
// dropped after the server committed but before the ack reached the
// browser) — the SECOND, THIRD, ... arrival must return the identical
// result of the first, never re-run the business logic or invent a new
// error. `status: 'in_progress'` is a short-lived reservation that closes
// the race between two near-simultaneous replays of the same key (e.g. two
// browser tabs sharing the same IndexedDB outbox both draining at once);
// see withIdempotency.ts for how it's reclaimed if the original request
// crashed before completing.
export interface IdempotencyRecordDocument {
  _id: Types.ObjectId
  route: string
  key: string
  academyId: Types.ObjectId
  userId: Types.ObjectId
  status: IdempotencyRecordStatus
  statusCode?: number
  responseBody?: unknown
  createdAt: Date
}

const idempotencyRecordSchema = new Schema<IdempotencyRecordDocument>(
  {
    route: { type: String, required: true },
    key: { type: String, required: true },
    academyId: { type: Schema.Types.ObjectId, ref: 'Academy', required: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    status: { type: String, required: true, enum: ['in_progress', 'completed'], default: 'in_progress' },
    statusCode: { type: Number },
    responseBody: { type: Schema.Types.Mixed },
  },
  { timestamps: { createdAt: true, updatedAt: false }, versionKey: false },
)

idempotencyRecordSchema.index({ route: 1, key: 1 }, { unique: true })
// Idempotency records only need to outlive the connectivity gap they cover
// (minutes to hours during a single event day), never the tournament's
// permanent record — that's AuditLogModel. Auto-expire well past any
// plausible replay window so the collection doesn't grow unbounded across
// events; this is a dedup cache, not the source of truth.
idempotencyRecordSchema.index({ createdAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 30 })

export const IdempotencyRecordModel = model<IdempotencyRecordDocument>('IdempotencyRecord', idempotencyRecordSchema)
