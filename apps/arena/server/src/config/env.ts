import { z } from 'zod'
import { createEnv } from '@sensei-hub/core-server'

export const env = createEnv(
  { port: 3001, mongodbUri: 'mongodb://127.0.0.1:27017/senseihub_arena?replicaSet=sensei-rs' },
  {
    // Fase 8 — Master/Backup declarado. This node's own declared cluster
    // role, set by the operator once at machine setup time (see
    // packages/desktop-runtime/src/machineRole.ts) and forwarded here as an
    // env var by Supervisor. 'off' (the default) is what every existing
    // single-node dev/test flow (pnpm dev:run, the whole Vitest suite) runs
    // as — no ClusterManager is constructed at all. 'station' also runs
    // without a ClusterManager: a station has no local mongod to manage, it
    // just needs a remote, replicaSet-aware MONGODB_URI (built by
    // Supervisor from the master/backup addresses entered once at station
    // setup) — see apps/arena/server/src/cluster/ClusterManager.ts's module
    // doc comment for why that alone is enough for failover.
    CLUSTER_ROLE: z.enum(['off', 'master', 'backup', 'station']).default('off'),
    CLUSTER_REPLICA_SET_NAME: z.string().default('sensei-rs'),
    CLUSTER_MONGO_PORT: z.coerce.number().int().positive().default(27017),
    // Auto-detected via the first non-internal IPv4 interface when unset (same
    // approach as the Fase 6 kiosk QR code) — override when auto-detection
    // picks the wrong NIC (e.g. a machine with both WiFi and a VPN adapter).
    CLUSTER_ADVERTISE_HOST: z.string().optional(),
  },
)
