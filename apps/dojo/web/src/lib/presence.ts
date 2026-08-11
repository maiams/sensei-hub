import { ApiError } from './api'

export type PresenceRole = 'athlete' | 'coach' | 'academy_admin' | 'super_admin' | string
export type AttendanceResult = 'unmarked' | 'present' | 'absent'
export type AttendanceRequestStatus = 'pending' | 'confirmed' | 'rejected' | 'expired'
export type LocationIndicator = 'inside' | 'outside' | 'unavailable'

export interface ClassGroupSummary {
  id: string
  name: string
  description?: string
  active: boolean
  studentCount?: number
  scheduleLabel?: string
  nextLessonAt?: string
}

export interface LessonSummary {
  id: string
  classId: string
  className: string
  coachId?: string
  startsAt: string
  endsAt: string
  status: 'scheduled' | 'cancelled' | 'closed'
  coachNames?: string[]
  requestOpensAt?: string
  requestClosesAt?: string
  pendingCount?: number
  presentCount?: number
  absentCount?: number
  unmarkedCount?: number
}

export interface RollCallItem {
  attendanceId: string
  athleteId: string
  athleteName: string
  birthDate?: string
  result: AttendanceResult
  request?: {
    id: string
    status: AttendanceRequestStatus
    locationStatus: LocationIndicator
    requestedAt?: string
    rejectionReason?: string
    expirationReason?: string
  }
  version?: number
}

export interface RollCallResponse {
  serverNow?: string
  lesson: LessonSummary
  items: RollCallItem[]
  capabilities?: {
    canDecide?: boolean
    canCorrect?: boolean
    canCancelLesson?: boolean
  }
}

export interface StudentDashboard {
  athlete: { id: string; fullName: string }
  currentClass?: { id: string; name: string }
  nextLesson?: LessonSummary
  request?: RollCallItem['request']
  attendance?: AttendanceHistoryItem
}

export interface AttendanceHistoryItem {
  id: string
  lessonId: string
  className?: string
  lessonStartsAt?: string
  result: AttendanceResult
  reason?: string
}

export interface PageResult<T> {
  items: T[]
  total: number
  page?: number
  pageSize?: number
}

export interface CapturedPosition {
  latitude: number
  longitude: number
  accuracyMeters: number
  capturedAtClient: string
}

export function calculateAge(birthDate: string | undefined, referenceDate = new Date()): number | null {
  if (!birthDate) return null
  const [year, month, day] = birthDate.split('-').map(Number)
  let age = referenceDate.getFullYear() - (year ?? referenceDate.getFullYear())
  const beforeBirthday = referenceDate.getMonth() + 1 < (month ?? 1)
    || (referenceDate.getMonth() + 1 === (month ?? 1) && referenceDate.getDate() < (day ?? 1))
  if (beforeBirthday) age--
  return Math.max(0, age)
}

export async function capturePosition(timeoutMs = 5000): Promise<CapturedPosition | undefined> {
  if (typeof navigator === 'undefined' || !navigator.geolocation) return undefined

  return new Promise((resolve) => {
    let settled = false
    const timeout = window.setTimeout(() => {
      if (!settled) {
        settled = true
        resolve(undefined)
      }
    }, timeoutMs)

    navigator.geolocation.getCurrentPosition(
      (position) => {
        if (settled) return
        settled = true
        window.clearTimeout(timeout)
        resolve({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracyMeters: position.coords.accuracy,
          capturedAtClient: new Date(position.timestamp).toISOString(),
        })
      },
      () => {
        if (settled) return
        settled = true
        window.clearTimeout(timeout)
        resolve(undefined)
      },
      { enableHighAccuracy: false, maximumAge: 30_000, timeout: timeoutMs },
    )
  })
}

export function makeIdempotencyKey(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`
}

export function presenceErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof ApiError) {
    if (error.status === 409) return 'A chamada mudou em outro aparelho. Atualize para ver o estado atual.'
    if (error.status === 403) return 'Você não tem permissão para realizar esta ação.'
    if (error.status === 404) return 'Este registro não está mais disponível.'
    if (error.status === 400 && error.message) return error.message
    if (error.status === 422 && error.message) return error.message
  }
  return fallback
}

export function formatLessonDate(value: string): string {
  return new Intl.DateTimeFormat('pt-BR', {
    weekday: 'short',
    day: '2-digit',
    month: 'short',
  }).format(new Date(value))
}

export function formatTime(value: string): string {
  return new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' }).format(new Date(value))
}

export function resultLabel(result: AttendanceResult): string {
  if (result === 'present') return 'Presente'
  if (result === 'absent') return 'Faltou'
  return 'Sem marcação'
}
