import bcrypt from 'bcryptjs'
import { UserModel } from '../repositories/UserModel.js'
import { AuditLogModel } from '../repositories/AuditLogModel.js'
import { ROLE_HIERARCHY, type UserRole } from '@sensei-hub/shared'
import type { Types } from 'mongoose'

const BCRYPT_ROUNDS = 12

export interface CreateUserParams {
  academyId: string
  email: string
  name: string
  password: string
  role: UserRole
  createdById: string
  createdByRole: UserRole
  sessionId: string
  ip?: string
}

export class UserService {
  async createUser(params: CreateUserParams) {
    const { academyId, email, name, password, role, createdById, createdByRole, sessionId, ip } = params

    if (ROLE_HIERARCHY[role] > ROLE_HIERARCHY[createdByRole]) {
      throw new UserServiceError('Cannot assign a role higher than your own', 403)
    }

    const existing = await UserModel.findOne({ email: email.toLowerCase() })
    if (existing) {
      throw new UserServiceError('Email already in use', 409)
    }

    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS)
    const user = await UserModel.create({ academyId, email, name, passwordHash, role })

    await AuditLogModel.create({
      userId: createdById,
      entityType: 'User',
      entityId: user._id,
      action: 'create',
      sessionId,
      ip,
    })

    return this.#toDTO(user)
  }

  async listUsers(academyId: string) {
    const users = await UserModel.find({ academyId, active: true }).sort({ name: 1 })
    return users.map((u) => this.#toDTO(u))
  }

  async changePassword(params: {
    userId: string
    oldPassword: string
    newPassword: string
    sessionId: string
    ip?: string
  }) {
    const { userId, oldPassword, newPassword, sessionId, ip } = params
    const user = await UserModel.findById(userId).select('+passwordHash')
    if (!user) throw new UserServiceError('User not found', 404)

    const match = await bcrypt.compare(oldPassword, user.passwordHash)
    if (!match) throw new UserServiceError('Incorrect current password', 401)

    user.passwordHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS)
    await user.save()

    await AuditLogModel.create({
      userId,
      entityType: 'User',
      entityId: user._id,
      action: 'update',
      fieldName: 'password',
      sessionId,
      ip,
    })
  }

  #toDTO(user: { _id: Types.ObjectId; academyId: Types.ObjectId; email: string; name: string; role: UserRole; active: boolean; createdAt: Date; updatedAt: Date }) {
    return {
      id: user._id.toString(),
      academyId: user.academyId.toString(),
      email: user.email,
      name: user.name,
      role: user.role,
      active: user.active,
      createdAt: user.createdAt.toISOString(),
      updatedAt: user.updatedAt.toISOString(),
    }
  }
}

export class UserServiceError extends Error {
  constructor(
    message: string,
    public readonly statusCode: 401 | 403 | 404 | 409,
  ) {
    super(message)
    this.name = 'UserServiceError'
  }
}
