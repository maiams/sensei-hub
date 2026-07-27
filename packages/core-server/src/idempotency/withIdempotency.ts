import type { FastifyReply } from 'fastify'
import { IdempotencyRecordModel } from '../repositories/IdempotencyRecordModel.js'

export interface IdempotentResult {
  statusCode: number
  body: unknown
}

// How long a reservation can sit 'in_progress' before we assume the original
// request crashed (process killed, DB hiccup) rather than being genuinely
// slow, and let a fresh attempt reclaim the key. Generous on purpose — an
// old i3 notebook under load is exactly the hardware this exists for.
const STALE_RESERVATION_MS = 30_000
const POLL_INTERVAL_MS = 150
const POLL_ATTEMPTS = 12 // ~1.8s of waiting for a concurrent duplicate to finish

function isDuplicateKeyError(err: unknown): boolean {
  return typeof err === 'object' && err !== null && 'code' in err && (err as { code: unknown }).code === 11000
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function reserve(route: string, key: string, academyId: string, userId: string) {
  try {
    return await IdempotencyRecordModel.create({ route, key, academyId, userId, status: 'in_progress' })
  } catch (err) {
    if (isDuplicateKeyError(err)) return null
    throw err
  }
}

// Makes a route replay-safe against a client-generated idempotency key: the
// SAME key always yields the SAME {statusCode, body}, computed at most once.
// This is what turns "the offline queue resent this check-in because the
// network dropped after the server had already committed it" from a
// duplicate-effect bug into a harmless no-op replay.
//
// Contract:
//  - No key supplied (`key` undefined) -> runs `run()` directly, no dedup.
//    Every caller that doesn't come through the durable queue is unaffected.
//  - First time a key is seen -> `run()` executes, and its result (success
//    OR a deliberate business rejection like 404/409 — anything the route
//    itself decided to return) is persisted and sent.
//  - Same key again -> `run()` is NOT called; the persisted result is
//    replayed verbatim. A permanently-rejected write replays as the exact
//    same rejection every time, never a fresh attempt and never a different
//    error — the operator sees one stable outcome to act on.
//  - Two requests carrying the same key genuinely at once (e.g. two tabs
//    both draining the same IndexedDB outbox) — only one reservation wins;
//    the other polls briefly for the winner's result instead of running
//    `run()` a second time. If the winner never finishes (crashed mid-
//    request), the reservation is reclaimed after STALE_RESERVATION_MS so
//    the operation isn't stuck forever.
export async function withIdempotency(opts: {
  key: string | undefined
  route: string
  academyId: string
  userId: string
  reply: FastifyReply
  run: () => Promise<IdempotentResult>
}): Promise<void> {
  const { key, route, academyId, userId, reply, run } = opts

  if (!key) {
    const result = await run()
    reply.status(result.statusCode).send(result.body)
    return
  }

  let reservation = await reserve(route, key, academyId, userId)

  if (!reservation) {
    for (let attempt = 0; attempt < POLL_ATTEMPTS && !reservation; attempt++) {
      const existing = await IdempotencyRecordModel.findOne({ route, key })
      if (existing?.status === 'completed') {
        reply.status(existing.statusCode ?? 200).send(existing.responseBody)
        return
      }
      if (existing && Date.now() - existing.createdAt.getTime() > STALE_RESERVATION_MS) {
        await IdempotencyRecordModel.deleteOne({ _id: existing._id, status: 'in_progress' })
        reservation = await reserve(route, key, academyId, userId)
        if (reservation) break
        continue
      }
      await sleep(POLL_INTERVAL_MS)
    }
    if (!reservation) {
      reply.status(409).send({
        error: 'Operação idêntica ainda em processamento em outra requisição — tente novamente em instantes.',
      })
      return
    }
  }

  const result = await run()
  reservation.status = 'completed'
  reservation.statusCode = result.statusCode
  reservation.responseBody = result.body
  await reservation.save()
  reply.status(result.statusCode).send(result.body)
}
