import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { DeclareBackupInput, PromoteBackupInput, StationHeartbeatInput, type ClusterStatusDTO } from '@arena/shared'
import { ClusterManager, ClusterManagerError } from '../cluster/ClusterManager.js'
import { StationHeartbeatModel } from '../repositories/StationHeartbeatModel.js'
import { authenticate, authorize } from '@sensei-hub/core-server'

const DISABLED_STATUS: ClusterStatusDTO = {
  enabled: false,
  replicaSetName: null,
  selfHost: null,
  selfRole: null,
  master: null,
  backup: null,
  stations: [],
}

// `clusterManager` is only defined when this node's declared machine role is
// 'master' or 'backup' (see packages/desktop-runtime/src/machineRole.ts and
// apps/arena/server/src/index.ts, which construct it from CLUSTER_ROLE). A
// plain standalone install or a station notebook runs with it undefined —
// the human-facing GET/POST routes below degrade to DISABLED_STATUS / 404
// rather than 500ing. The heartbeat route is the one exception: it's plain
// authenticated Mongoose writes through whatever MONGODB_URI this node
// already has, so it works identically on every role (harmless no-op on a
// pure standalone single-machine install, since nothing ever reads it there).
export async function clusterRoutes(
  app: FastifyInstance,
  opts: { clusterManager?: ClusterManager },
): Promise<void> {
  const { clusterManager } = opts

  function handleError(err: unknown, reply: FastifyReply) {
    if (err instanceof ClusterManagerError) {
      return reply.status(err.statusCode).send({ error: err.message })
    }
    throw err
  }

  function ctxFrom(request: FastifyRequest) {
    return {
      userId: request.authUser.id,
      academyId: request.authUser.academyId,
      role: request.authUser.role,
      sessionId: request.id,
      ip: request.ip,
    }
  }

  // Infrastructure-level, not academy-scoped (cluster membership spans the
  // whole gym, not one academy) — gated on event_manager+ since that's the
  // role actually running an event day-to-day and who'd need to declare a
  // backup or promote it mid-event.
  app.get('/cluster/status', { preHandler: [authenticate, authorize('event_manager')] }, async (_request, reply) => {
    if (!clusterManager) return reply.send(DISABLED_STATUS)
    try {
      return reply.send(await clusterManager.getStatus())
    } catch (err) {
      return handleError(err, reply)
    }
  })

  app.post('/cluster/backup', { preHandler: [authenticate, authorize('event_manager')] }, async (request, reply) => {
    if (!clusterManager) {
      return reply.status(404).send({ error: 'Cluster mode is not enabled on this node' })
    }
    const parsed = DeclareBackupInput.safeParse(request.body)
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Validation failed', details: parsed.error.flatten() })
    }
    try {
      const status = await clusterManager.declareBackup(parsed.data.mongoHost, ctxFrom(request))
      return reply.status(201).send(status)
    } catch (err) {
      return handleError(err, reply)
    }
  })

  // Meant to be called against the BACKUP node's own API — see
  // ClusterManager.promote()'s doc comment. `confirm: true` is required in
  // the body so this can never fire from a stray click; a clear warning and
  // an explicit confirmation step belong on the frontend before this is
  // ever called.
  app.post('/cluster/promote', { preHandler: [authenticate, authorize('event_manager')] }, async (request, reply) => {
    if (!clusterManager) {
      return reply.status(404).send({ error: 'Cluster mode is not enabled on this node' })
    }
    const parsed = PromoteBackupInput.safeParse(request.body)
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Validation failed', details: parsed.error.flatten() })
    }
    try {
      const status = await clusterManager.promote(
        { acknowledgeSplitBrainRisk: parsed.data.acknowledgeSplitBrainRisk ?? false },
        ctxFrom(request),
      )
      return reply.send(status)
    } catch (err) {
      return handleError(err, reply)
    }
  })

  // Any station's own local server calls this directly against its own
  // Fastify (never proxied) — see apps/arena/web/src/lib/station.ts for the
  // stable per-browser stationId this reuses, and StationHeartbeatModel's
  // doc comment for why this is a plain Mongo write rather than anything
  // cluster-manager-specific. scoreboard_operator+ covers every role that
  // actually staffs an area station (mesário, pesagem, recepção).
  app.post(
    '/cluster/stations/heartbeat',
    { preHandler: [authenticate, authorize('scoreboard_operator')] },
    async (request, reply) => {
      const parsed = StationHeartbeatInput.safeParse(request.body)
      if (!parsed.success) {
        return reply.status(400).send({ error: 'Validation failed', details: parsed.error.flatten() })
      }
      await StationHeartbeatModel.findOneAndUpdate(
        { stationId: parsed.data.stationId },
        { $set: { lastSeenAt: new Date() } },
        { upsert: true },
      )
      return reply.status(204).send()
    },
  )
}
