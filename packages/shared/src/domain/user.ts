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

// POST /api/users (by academy_admin)
export const CreateUserInput = z.object({
  academyId: z.string(),
  email: z.string().email().toLowerCase(),
  name: z.string().min(2).max(120),
  password: z.string().min(8),
  role: UserRole,
})
export type CreateUserInput = z.infer<typeof CreateUserInput>

// POST /api/auth/setup (first-run, creates first academy + super_admin)
export const FirstRunSetupInput = z.object({
  academyName: z.string().min(2).max(200),
  adminName: z.string().min(2).max(120),
  adminEmail: z.string().email(),
  adminPassword: z.string().min(8),
})
export type FirstRunSetupInput = z.infer<typeof FirstRunSetupInput>

// API response — never includes passwordHash
export const UserDTO = z.object({
  _id: z.string(),
  academyId: z.string(),
  email: z.string().email(),
  name: z.string(),
  role: UserRole,
  active: z.boolean(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
})
export type UserDTO = z.infer<typeof UserDTO>

// Internal document schema
export const UserSchema = UserDTO
export type User = UserDTO

export const AcademySchema = z.object({
  _id: z.string(),
  name: z.string().min(2).max(200),
  slug: z.string(),
  createdAt: z.string().datetime(),
})
export type Academy = z.infer<typeof AcademySchema>

export const CreateAcademyInput = z.object({
  name: z.string().min(2).max(200),
})
export type CreateAcademyInput = z.infer<typeof CreateAcademyInput>
