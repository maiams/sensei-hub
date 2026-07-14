import type { FastifyRequest, FastifyReply } from 'fastify'
import { ROLE_HIERARCHY, type UserRole } from '@sensei-hub/shared'

export function authorize(minRole: UserRole) {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    if (!request.authUser) {
      await reply.status(401).send({ error: 'Unauthorized' })
      return
    }
    if (ROLE_HIERARCHY[request.authUser.role] < ROLE_HIERARCHY[minRole]) {
      await reply.status(403).send({ error: 'Forbidden' })
    }
  }
}
