import { describe, it, expect, vi } from 'vitest'
import { authorize } from '@sensei-hub/core-server'
import type { FastifyRequest, FastifyReply } from 'fastify'

function mockReply() {
  const reply = {
    status: vi.fn().mockReturnThis(),
    send: vi.fn().mockResolvedValue(undefined),
  }
  return reply as unknown as FastifyReply
}

describe('authorize middleware (unit)', () => {
  it('returns 401 when request.authUser is missing', async () => {
    const request = {} as FastifyRequest
    const reply = mockReply()

    await authorize('coach')(request, reply)

    expect(reply.status).toHaveBeenCalledWith(401)
    expect(reply.send).toHaveBeenCalledWith({ error: 'Unauthorized' })
  })

  it('returns 403 when authUser role is below minRole', async () => {
    const request = { authUser: { id: '1', academyId: 'a1', role: 'staff' } } as FastifyRequest
    const reply = mockReply()

    await authorize('academy_admin')(request, reply)

    expect(reply.status).toHaveBeenCalledWith(403)
    expect(reply.send).toHaveBeenCalledWith({ error: 'Forbidden' })
  })

  it('does not reply when authUser role meets minRole', async () => {
    const request = { authUser: { id: '1', academyId: 'a1', role: 'academy_admin' } } as FastifyRequest
    const reply = mockReply()

    await authorize('coach')(request, reply)

    expect(reply.status).not.toHaveBeenCalled()
    expect(reply.send).not.toHaveBeenCalled()
  })

  it('does not reply when authUser role exactly equals minRole', async () => {
    const request = { authUser: { id: '1', academyId: 'a1', role: 'coach' } } as FastifyRequest
    const reply = mockReply()

    await authorize('coach')(request, reply)

    expect(reply.status).not.toHaveBeenCalled()
    expect(reply.send).not.toHaveBeenCalled()
  })
})
