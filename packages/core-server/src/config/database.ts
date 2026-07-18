import mongoose from 'mongoose'

export async function connectDatabase(mongodbUri: string): Promise<void> {
  mongoose.connection.on('connected', () => console.log('[db] connected'))
  mongoose.connection.on('disconnected', () => console.warn('[db] disconnected'))
  mongoose.connection.on('error', (err) => console.error('[db] error', err))

  await mongoose.connect(mongodbUri, {
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
