import type { FastifyRequest, FastifyReply } from 'fastify'
import { ROLE_HIERARCHY, type UserRole } from '@sensei-hub/shared'

// `alsoAllow` grants a route to specific roles that sit *below* minRole in
// the hierarchy, without lowering minRole itself (which would silently also
// admit every role in between). Example: confirm-entry requires
// 'event_manager'+, but weigh_in_operator (hierarchy level 30, well below
// event_manager's 60) also needs it to close out its own weigh-in flow —
// while staff/coach (40/50, also below 60) must stay forbidden. Lowering
// minRole to weigh_in_operator would let staff/coach in too; alsoAllow lets
// us admit exactly the one extra role.
export function authorize(minRole: UserRole, opts?: { alsoAllow?: UserRole[] }) {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    if (!request.authUser) {
      await reply.status(401).send({ error: 'Unauthorized' })
      return
    }
    const { role } = request.authUser
    const meetsMinRole = ROLE_HIERARCHY[role] >= ROLE_HIERARCHY[minRole]
    const explicitlyAllowed = opts?.alsoAllow?.includes(role) ?? false
    if (!meetsMinRole && !explicitlyAllowed) {
      await reply.status(403).send({ error: 'Forbidden' })
    }
  }
}
