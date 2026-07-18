import { z } from 'zod'

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().positive().default(3001),
  MONGODB_URI: z.string().default('mongodb://127.0.0.1:27017/senseihub?replicaSet=sensei-rs'),
  JWT_SECRET: z.string().min(32).default('dev-secret-change-in-production-min-32-chars'),
  JWT_EXPIRES_IN: z.string().default('15m'),
  JWT_REFRESH_EXPIRES_IN: z.string().default('7d'),
  MONGO_CACHE_SIZE_GB: z.coerce.number().default(0.5),

  // Fase 7 — Cluster Dinâmico. Off by default: existing single-node dev/test
  // flows (pnpm dev:run, the whole Vitest suite) never touch mDNS/multicast
  // unless explicitly opted in. See packages/server/src/cluster/.
  CLUSTER_ENABLED: z.coerce.boolean().default(false),
  // Shared bootstrap secret for node-to-node POST /api/cluster/join calls —
  // a fresh joining node has no user/academy JWT to present, so this is a
  // separate auth mechanism (like a WiFi pre-shared key), not a user role.
  CLUSTER_SECRET: z.string().min(16).default('dev-cluster-secret-change-me'),
  CLUSTER_REPLICA_SET_NAME: z.string().default('sensei-rs'),
  CLUSTER_MONGO_PORT: z.coerce.number().int().positive().default(27017),
  CLUSTER_DISCOVERY_TIMEOUT_MS: z.coerce.number().int().positive().default(3000),
  // Auto-detected via the first non-internal IPv4 interface when unset (same
  // approach as the Fase 6 kiosk QR code) — override when auto-detection
  // picks the wrong NIC (e.g. a machine with both WiFi and a VPN adapter).
  CLUSTER_ADVERTISE_HOST: z.string().optional(),
})

const parsed = EnvSchema.safeParse(process.env)

if (!parsed.success) {
  console.error('Invalid environment variables:', parsed.error.flatten().fieldErrors)
  process.exit(1)
}

export const env = parsed.data
