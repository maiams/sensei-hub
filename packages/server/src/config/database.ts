import mongoose from 'mongoose'
import { env } from './env.js'

export async function connectDatabase(): Promise<void> {
  mongoose.connection.on('connected', () => console.log('[db] connected'))
  mongoose.connection.on('disconnected', () => console.warn('[db] disconnected'))
  mongoose.connection.on('error', (err) => console.error('[db] error', err))

  await mongoose.connect(env.MONGODB_URI, {
    serverSelectionTimeoutMS: 5000,
    heartbeatFrequencyMS: 2000,
    writeConcern: { w: 'majority' },
  })
}

export async function disconnectDatabase(): Promise<void> {
  await mongoose.disconnect()
}

export function isDatabaseConnected(): boolean {
  return mongoose.connection.readyState === 1
}
