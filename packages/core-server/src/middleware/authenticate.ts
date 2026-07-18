import type { FastifyRequest, FastifyReply } from 'fastify'
// Side-effect import: loads @fastify/jwt's declaration merging so
// request.jwtVerify()/app.jwt exist on the Fastify types within this package.
import '@fastify/jwt'
import type { UserRole } from '@sensei-hub/shared'

export interface AuthUser {
  id: string
  academyId: string
  role: UserRole
}

declare module 'fastify' {
  interface FastifyRequest {
    authUser: AuthUser
  }
}

export async function authenticate(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  try {
    const decoded = await request.jwtVerify<{ sub: string; academyId: string; role: UserRole }>()
    request.authUser = {
      id: decoded.sub,
      academyId: decoded.academyId,
      role: decoded.role,
    }
  } catch {
    await reply.status(401).send({ error: 'Unauthorized' })
  }
}
