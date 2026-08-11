import { z } from 'zod'

export const AttendanceResult = z.enum(['unmarked', 'present', 'absent'])
export type AttendanceResult = z.infer<typeof AttendanceResult>

export const AttendanceRequestStatus = z.enum(['pending', 'confirmed', 'rejected', 'expired'])
export type AttendanceRequestStatus = z.infer<typeof AttendanceRequestStatus>

export const LocationStatus = z.enum(['inside', 'outside', 'unavailable'])
export type LocationStatus = z.infer<typeof LocationStatus>

export const CreateTrainingClassInput = z.object({
  name: z.string().trim().min(2).max(120),
  description: z.string().trim().max(500).optional(),
})
export type CreateTrainingClassInput = z.infer<typeof CreateTrainingClassInput>

export const UpdateTrainingClassInput = CreateTrainingClassInput.partial().extend({ active: z.boolean().optional() })
export type UpdateTrainingClassInput = z.infer<typeof UpdateTrainingClassInput>

export const CreateEnrollmentInput = z.object({ athleteId: z.string().min(1) })
export type CreateEnrollmentInput = z.infer<typeof CreateEnrollmentInput>

export const EndEnrollmentInput = z.object({ reason: z.string().trim().min(3).max(500) })
export type EndEnrollmentInput = z.infer<typeof EndEnrollmentInput>

export const CreateLessonInput = z.object({
  classId: z.string().min(1),
  startsAt: z.string().datetime(),
  endsAt: z.string().datetime(),
  coachId: z.string().min(1).optional(),
})
export type CreateLessonInput = z.infer<typeof CreateLessonInput>

export const RequestLocationInput = z.object({
  status: LocationStatus,
  distanceMeters: z.number().nonnegative().max(100_000).optional(),
  accuracyMeters: z.number().nonnegative().max(100_000).optional(),
  capturedAt: z.string().datetime().optional(),
})

export const CreateAttendanceRequestInput = z.object({ location: RequestLocationInput.optional() })
export type CreateAttendanceRequestInput = z.infer<typeof CreateAttendanceRequestInput>

export const RejectAttendanceRequestInput = z.object({ reason: z.string().trim().min(3).max(500) })
export type RejectAttendanceRequestInput = z.infer<typeof RejectAttendanceRequestInput>

export const DirectAttendanceInput = z.object({
  athleteId: z.string().min(1),
  reason: z.string().trim().min(3).max(500).optional(),
})
export type DirectAttendanceInput = z.infer<typeof DirectAttendanceInput>

export const CorrectAttendanceInput = z.object({
  result: z.enum(['present', 'absent']),
  reason: z.string().trim().min(3).max(500),
})
export type CorrectAttendanceInput = z.infer<typeof CorrectAttendanceInput>
