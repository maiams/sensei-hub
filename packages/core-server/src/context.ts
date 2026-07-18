import type { UserRole } from '@sensei-hub/shared'

// Authenticated request context passed from routes into services — carries
// everything the audit trail needs (who, from which academy, which session).
export interface AuthCtx {
  userId: string
  academyId: string
  role: UserRole
  sessionId: string
  ip?: string
}
