import { z } from 'zod'

export const UserRole = z.enum([
  'super_admin',
  'academy_admin',
  'event_manager',
  'coach',
  'staff',
  'weigh_in_operator',
  'scoreboard_operator',
  'athlete',
  'guardian',
])
export type UserRole = z.infer<typeof UserRole>

export const ROLE_HIERARCHY: Record<UserRole, number> = {
  super_admin: 100,
  academy_admin: 80,
  event_manager: 60,
  coach: 50,
  staff: 40,
  weigh_in_operator: 30,
  scoreboard_operator: 25,
  athlete: 10,
  guardian: 10,
}

export function hasMinRole(userRole: UserRole, minRole: UserRole): boolean {
  return ROLE_HIERARCHY[userRole] >= ROLE_HIERARCHY[minRole]
}

export const UserSchema = z.object({
  _id: z.string(),
  academyId: z.string(),
  email: z.string().email(),
  name: z.string().min(2).max(120),
  role: UserRole,
  active: z.boolean().default(true),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
})
export type User = z.infer<typeof UserSchema>
