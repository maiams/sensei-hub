import { MongoMemoryReplSet } from 'mongodb-memory-server'
import mongoose from 'mongoose'

let mongod: MongoMemoryReplSet

// Single-node replica set — mirrors production topology and is required for
// Mongoose sessions/transactions (e.g. AthleteService's atomic guardian create).
export async function connectTestDb(): Promise<void> {
  mongod = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } })
  await mongoose.connect(mongod.getUri(), { dbName: 'senseihub-test' })
}

export async function closeTestDb(): Promise<void> {
  await mongoose.connection.dropDatabase()
  await mongoose.connection.close()
  await mongod.stop()
}

export async function clearTestDb(): Promise<void> {
  const collections = mongoose.connection.collections
  for (const key of Object.keys(collections)) {
    await collections[key]?.deleteMany({})
  }
}
