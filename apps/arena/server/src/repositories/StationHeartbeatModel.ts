import { Schema, model } from 'mongoose'

// Ephemeral "which area notebooks are alive right now" tracker for the
// master/backup cluster management screen. Deliberately NOT part of the
// audit trail — presence/absence of a heartbeat says nothing about business
// events, only "this station's own local server was able to reach the
// database a moment ago" — and deliberately NOT in-memory on ClusterManager,
// because a station's Fastify process is a physically separate machine from
// the master/backup: the only thing they share is this database (see
// apps/arena/server/src/cluster/ClusterManager.ts's module doc comment).
//
// A station writes its own row directly (POST /api/cluster/stations/
// heartbeat, any authenticated operator role) — no proxy, no special
// cluster-node auth, it's just a normal authenticated write through the
// same replicaSet-aware Mongo connection every other route already uses.
export interface StationHeartbeatDocument {
  stationId: string
  lastSeenAt: Date
}

const stationHeartbeatSchema = new Schema<StationHeartbeatDocument>(
  {
    stationId: { type: String, required: true, unique: true },
    lastSeenAt: { type: Date, required: true, default: () => new Date() },
  },
  { versionKey: false },
)

// A station that never comes back (decommissioned notebook, one-off event)
// shouldn't linger on the management screen forever — auto-expire well past
// any plausible "still mid-event" window.
stationHeartbeatSchema.index({ lastSeenAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 7 })

export const StationHeartbeatModel = model<StationHeartbeatDocument>('StationHeartbeat', stationHeartbeatSchema)
