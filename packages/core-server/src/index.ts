export { createEnv, type EnvDefaults } from './config/env.js'
export { connectDatabase, disconnectDatabase, isDatabaseConnected } from './config/database.js'
export { authenticate, type AuthUser } from './middleware/authenticate.js'
export { authorize } from './middleware/authorize.js'
export type { AuthCtx } from './context.js'

export { AcademyModel, type AcademyDocument } from './repositories/AcademyModel.js'
export { UserModel, type UserDocument } from './repositories/UserModel.js'
export { RefreshTokenModel, type RefreshTokenDocument } from './repositories/RefreshTokenModel.js'
export { AuditLogModel, type AuditLogDocument } from './repositories/AuditLogModel.js'

export { AuthService, AuthError, type TokenPair, type JwtPayload } from './services/AuthService.js'
export { UserService, UserServiceError, type CreateUserParams } from './services/UserService.js'

export { authRoutes } from './routes/auth.js'
export { userRoutes } from './routes/users.js'
export { setupRoutes } from './routes/setup.js'
export { healthRoutes } from './routes/health.js'
