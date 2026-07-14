import { MongoMemoryServer } from 'mongodb-memory-server'
import mongoose from 'mongoose'

let mongod: MongoMemoryServer

export async function connectTestDb(): Promise<void> {
  mongod = await MongoMemoryServer.create()
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
