import { z } from 'zod'

// Physical presence check-in at an event — decoupled from EventEntry (which
// is per-division registration): one Attendance per athlete per event marks
// "this person is here", regardless of how many divisions they're entered
// in. 'qr'/'short_code' are reserved for future scanner/kiosk hardware (see
// CLAUDE.md Mobile Check-In); only 'staff_search' and 'manual' have UI today.
export const CheckInMethod = z.enum(['qr', 'short_code', 'staff_search', 'manual'])
export type CheckInMethod = z.infer<typeof CheckInMethod>

export const AttendanceStatus = z.enum(['active', 'revoked'])
export type AttendanceStatus = z.infer<typeof AttendanceStatus>

// POST /api/events/:id/checkin
export const CheckInInput = z.object({
  athleteId: z.string(),
  method: CheckInMethod,
})
export type CheckInInput = z.infer<typeof CheckInInput>

// DELETE /api/events/:id/checkin/:aid
export const UndoCheckInInput = z.object({
  reason: z.string().min(1).max(500),
})
export type UndoCheckInInput = z.infer<typeof UndoCheckInInput>

export const AttendanceDTO = z.object({
  id: z.string(),
  eventId: z.string(),
  athleteId: z.string(),
  method: CheckInMethod,
  operatorId: z.string(),
  checkedInAt: z.string().datetime(),
  status: AttendanceStatus,
  revokedReason: z.string().optional(),
  revokedBy: z.string().optional(),
  revokedAt: z.string().datetime().optional(),
  // How many of the athlete's 'registered' entries in this event were
  // advanced to 'checked_in' by this action (0 is valid — an athlete can be
  // checked in before staff assigns them to a division).
  entriesUpdated: z.number().int().nonnegative(),
})
export type AttendanceDTO = z.infer<typeof AttendanceDTO>
