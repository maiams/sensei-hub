import { randomBytes, createHash } from 'node:crypto'
import bcrypt from 'bcryptjs'
import type { FastifyInstance } from 'fastify'
import { UserModel } from '../repositories/UserModel.js'
import { RefreshTokenModel } from '../repositories/RefreshTokenModel.js'
import type { UserRole } from '@sensei-hub/shared'

export interface TokenPair {
  accessToken: string
  refreshToken: string
}

export interface JwtPayload {
  sub: string
  academyId: string
  role: UserRole
}

const REFRESH_TOKEN_BYTES = 32
const BCRYPT_ROUNDS = 12
// 7 days in ms
const REFRESH_TTL_MS = 7 * 24 * 60 * 60 * 1000

function hashToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex')
}

export class AuthService {
  constructor(private readonly app: FastifyInstance) {}

  async login(email: string, password: string): Promise<TokenPair & { user: { id: string; name: string; role: UserRole } }> {
    const user = await UserModel.findOne({ email: email.toLowerCase() }).select('+passwordHash')

    // Constant-time comparison even when user not found — avoids timing attacks
    const dummyHash = '$2a$12$invalidhashusedfortimingnormalization00000000000000000'
    const hash = user?.passwordHash ?? dummyHash
    const match = await bcrypt.compare(password, hash)

    if (!user || !match || !user.active) {
      throw new AuthError('Invalid credentials', 401)
    }

    return this.#issueTokens(user._id.toString(), user.academyId.toString(), user.role, user.name)
  }

  async refreshAccessToken(rawRefreshToken: string): Promise<TokenPair> {
    const tokenHash = hashToken(rawRefreshToken)
    const stored = await RefreshTokenModel.findOne({ tokenHash })

    if (!stored || stored.expiresAt < new Date()) {
      throw new AuthError('Invalid or expired refresh token', 401)
    }

    // Rotation: delete old token before issuing new one
    await RefreshTokenModel.deleteOne({ _id: stored._id })

    const user = await UserModel.findById(stored.userId)
    if (!user || !user.active) {
      throw new AuthError('User not found or inactive', 401)
    }

    const { accessToken, refreshToken } = await this.#issueTokens(
      user._id.toString(),
      user.academyId.toString(),
      user.role,
      user.name,
    )
    return { accessToken, refreshToken }
  }

  async logout(rawRefreshToken: string): Promise<void> {
    const tokenHash = hashToken(rawRefreshToken)
    await RefreshTokenModel.deleteOne({ tokenHash })
  }

  async #issueTokens(
    userId: string,
    academyId: string,
    role: UserRole,
    name: string,
  ): Promise<TokenPair & { user: { id: string; name: string; role: UserRole } }> {
    const payload: JwtPayload = { sub: userId, academyId, role }
    const accessToken = this.app.jwt.sign(payload)

    const rawRefresh = randomBytes(REFRESH_TOKEN_BYTES).toString('hex')
    const tokenHash = hashToken(rawRefresh)
    const expiresAt = new Date(Date.now() + REFRESH_TTL_MS)

    await RefreshTokenModel.create({ userId, tokenHash, expiresAt })

    return {
      accessToken,
      refreshToken: rawRefresh,
      user: { id: userId, name, role },
    }
  }
}

export class AuthError extends Error {
  constructor(
    message: string,
    public readonly statusCode: 401 | 403,
  ) {
    super(message)
    this.name = 'AuthError'
  }
}
