import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { ClusterJoinRequest, type ClusterStatusDTO } from '@sensei-hub/shared'
import { ClusterManager, ClusterManagerError } from '../cluster/ClusterManager.js'
import { authenticate } from '../middleware/authenticate.js'
import { authorize } from '../middleware/authorize.js'
import { env } from '../config/env.js'

const DISABLED_STATUS: ClusterStatusDTO = {
  enabled: false,
  replicaSetName: null,
  selfHost: null,
  nodes: [],
  hasArbiter: false,
  needsArbiter: false,
}

// `clusterManager` is undefined when CLUSTER_ENABLED=false (the default —
// see packages/server/src/index.ts, which only constructs and bootstraps a
// ClusterManager when the env flag is on). Both routes degrade gracefully
// rather than 500ing when cluster mode is off.
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

  // Human-facing, infrastructure-level — super_admin only (not academy-
  // scoped: cluster membership isn't an academy concept).
  app.get('/cluster/status', { preHandler: [authenticate, authorize('super_admin')] }, async (_request, reply) => {
    if (!clusterManager) return reply.send(DISABLED_STATUS)
    try {
      return reply.send(await clusterManager.getStatus())
    } catch (err) {
      return handleError(err, reply)
    }
  })

  // Node-to-node only: a freshly-installed joining node has no user/academy
  // JWT to present, so this authenticates via a shared secret header
  // instead of the normal `authenticate` middleware.
  app.post('/cluster/join', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!clusterManager) {
      return reply.status(404).send({ error: 'Cluster mode is not enabled on this node' })
    }
    const secret = request.headers['x-cluster-secret']
    if (secret !== env.CLUSTER_SECRET) {
      return reply.status(401).send({ error: 'Invalid cluster secret' })
    }

    const parsed = ClusterJoinRequest.safeParse(request.body)
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Validation failed', details: parsed.error.flatten() })
    }

    try {
      await clusterManager.handleJoinRequest(parsed.data.mongoHost)
      return reply.status(204).send()
    } catch (err) {
      return handleError(err, reply)
    }
  })
}
