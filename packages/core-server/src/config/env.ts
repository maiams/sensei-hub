import { z } from 'zod'

// Base env shared by every Sensei Hub server product. Each app calls
// createEnv() with its own defaults (port, mongo URI) and, when needed, an
// extension shape for product-specific variables (e.g. the arena CLUSTER_*
// block) — the same process.env is parsed once, at startup.
const baseShape = {
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  JWT_SECRET: z.string().min(32).default('dev-secret-change-in-production-min-32-chars'),
  JWT_EXPIRES_IN: z.string().default('15m'),
  JWT_REFRESH_EXPIRES_IN: z.string().default('7d'),
  MONGO_CACHE_SIZE_GB: z.coerce.number().default(0.5),
}

export interface EnvDefaults {
  port: number
  mongodbUri: string
}

type BaseEnvShape = typeof baseShape & {
  PORT: z.ZodDefault<z.ZodNumber>
  MONGODB_URI: z.ZodDefault<z.ZodString>
}

export function createEnv<TExtra extends z.ZodRawShape = Record<never, never>>(
  defaults: EnvDefaults,
  extraShape?: TExtra,
): z.infer<z.ZodObject<BaseEnvShape & TExtra>> {
  const schema = z.object({
    ...baseShape,
    PORT: z.coerce.number().int().positive().default(defaults.port),
    MONGODB_URI: z.string().default(defaults.mongodbUri),
    ...(extraShape ?? ({} as TExtra)),
  })

  const parsed = schema.safeParse(process.env)

  if (!parsed.success) {
    console.error('Invalid environment variables:', parsed.error.flatten().fieldErrors)
    process.exit(1)
  }

  return parsed.data as z.infer<z.ZodObject<BaseEnvShape & TExtra>>
}
