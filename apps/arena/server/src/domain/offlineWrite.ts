// Shared helper for the two flows the offline queue replays (check-in and
// weigh-in, see apps/arena/web/src/lib/offlineQueue.ts): resolving the
// domain-meaningful "when did this actually happen" timestamp.
//
// Station clocks are old, unmaintained notebooks — not trusted for anything
// order-sensitive (see AuthCtx's doc comment) — but the operator's own wall
// clock at the moment they acted is still the right value to store as the
// business timestamp (Attendance.checkedInAt, WeightRecord.recordedAt): a
// weigh-in that happened at 14:02 and only reached the server at 14:40 must
// be remembered as having happened at 14:02, not 14:40. The server's own
// receipt time is recorded separately and always (AuditLogModel.timestamp)
// — that one IS trustworthy and is never replaced by this.
//
// Falls back to "now" (server clock) whenever occurredAt is missing (the
// normal, always-online case) or fails to parse (defensive — a malformed
// header must never corrupt a stored date or crash the request).
export function resolveOccurredAt(occurredAt: string | undefined): Date {
  if (!occurredAt) return new Date()
  const parsed = new Date(occurredAt)
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed
}

// For the audit log's `occurredAt` annotation specifically: unlike
// resolveOccurredAt above (which always needs SOME business timestamp and
// so falls back to "now"), a malformed value here should just be omitted —
// recording a fabricated "client said now" would misrepresent what the
// client actually sent. Returns undefined for anything missing or
// unparsable so callers can `...(parsed ? { occurredAt: parsed } : {})`.
export function parseOccurredAtOrUndefined(occurredAt: string | undefined): Date | undefined {
  if (!occurredAt) return undefined
  const parsed = new Date(occurredAt)
  return Number.isNaN(parsed.getTime()) ? undefined : parsed
}
