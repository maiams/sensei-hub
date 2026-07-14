import type { FastifyInstance } from 'fastify'
import bcrypt from 'bcryptjs'
import { AcademyModel } from '../repositories/AcademyModel.js'
import { UserModel } from '../repositories/UserModel.js'
import { FirstRunSetupInput } from '@sensei-hub/shared'

const BCRYPT_ROUNDS = 12

function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

export async function setupRoutes(app: FastifyInstance): Promise<void> {
  // GET /api/setup/status — used by frontend to decide whether to show setup page
  app.get('/setup/status', async (_req, reply) => {
    const count = await AcademyModel.countDocuments()
    return reply.send({ setupRequired: count === 0 })
  })

  // POST /api/setup — first-run only; blocked once an academy exists
  app.post('/setup', async (request, reply) => {
    const alreadySetup = await AcademyModel.countDocuments()
    if (alreadySetup > 0) {
      return reply.status(409).send({ error: 'Setup already completed' })
    }

    const parsed = FirstRunSetupInput.safeParse(request.body)
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Validation failed', details: parsed.error.flatten() })
    }

    const { academyName, adminName, adminEmail, adminPassword } = parsed.data

    const slug = slugify(academyName)
    const academy = await AcademyModel.create({ name: academyName, slug })

    const passwordHash = await bcrypt.hash(adminPassword, BCRYPT_ROUNDS)
    await UserModel.create({
      academyId: academy._id,
      email: adminEmail.toLowerCase(),
      passwordHash,
      name: adminName,
      role: 'super_admin',
    })

    return reply.status(201).send({
      message: 'Setup complete',
      academy: { id: academy._id.toString(), name: academy.name, slug: academy.slug },
    })
  })
}
