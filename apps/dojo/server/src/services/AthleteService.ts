import mongoose, { type Types } from 'mongoose'
import { AthleteModel, type AthleteDocument } from '../repositories/AthleteModel.js'
import { GuardianModel, type GuardianDocument } from '../repositories/GuardianModel.js'
import { BeltRecordModel, type BeltRecordDocument } from '../repositories/BeltRecordModel.js'
import { AcademyModel, AuditLogModel, UserModel, type AuthCtx } from '@sensei-hub/core-server'
import { isValidCPF, hasMinRole } from '@sensei-hub/shared'
import { type CreateGuardianInput, type CreateBeltRecordInput, type CreateAthleteInput, type UpdateAthleteInput } from '@dojo/shared'

export type CreateAthleteParams = Omit<CreateAthleteInput, 'academyId'>
export type UpdateAthleteParams = UpdateAthleteInput

export function isMinor(birthDate: string, referenceDate = new Date().toISOString().slice(0, 10)): boolean {
  const [by, bm, bd] = birthDate.split('-').map(Number) as [number, number, number]
  const [ry, rm, rd] = referenceDate.split('-').map(Number) as [number, number, number]
  let age = ry - by
  if (rm < bm || (rm === bm && rd < bd)) age--
  return age < 18
}

export class AthleteService {
  async createAthlete(params: CreateAthleteParams, ctx: AuthCtx) {
    const { guardian, ...athleteFields } = params

    if (athleteFields.cpf && !isValidCPF(athleteFields.cpf)) {
      throw new AthleteServiceError('Invalid CPF', 400)
    }

    if (athleteFields.userId) {
      const user = await UserModel.findOne({ _id: athleteFields.userId, academyId: ctx.academyId, role: 'athlete', active: true })
      if (!user) throw new AthleteServiceError('Linked athlete user not found', 400)
    }

    if (isMinor(athleteFields.birthDate) && !guardian) {
      throw new AthleteServiceError('Guardian is required for athletes under 18', 400)
    }

    if (athleteFields.cpf) {
      const existing = await AthleteModel.findOne({ academyId: ctx.academyId, cpf: athleteFields.cpf })
      if (existing) {
        throw new AthleteServiceError('CPF already registered in this academy', 409)
      }
    }

    const session = await mongoose.startSession()
    try {
      let created: AthleteDocument | undefined
      await session.withTransaction(async () => {
        const academy = await AcademyModel.findByIdAndUpdate(
          ctx.academyId,
          { $inc: { athleteSeq: 1 } },
          { new: true, session },
        )
        if (!academy) {
          throw new AthleteServiceError('Academy not found', 404)
        }
        const enrollmentNumber = String(academy.athleteSeq).padStart(6, '0')

        const [athleteDoc] = await AthleteModel.create(
          [
            {
              academyId: ctx.academyId,
              userId: athleteFields.userId,
              enrollmentNumber,
              fullName: athleteFields.fullName,
              preferredName: athleteFields.preferredName,
              gender: athleteFields.gender,
              birthDate: athleteFields.birthDate,
              nationality: athleteFields.nationality ?? 'Brazilian',
              email: athleteFields.email,
              phone: athleteFields.phone,
              cpf: athleteFields.cpf,
              currentBelt: athleteFields.currentBelt,
              federationNumber: athleteFields.federationNumber,
              zempoNumber: athleteFields.zempoNumber,
              clubName: athleteFields.clubName,
              hasMedicalRestriction: athleteFields.hasMedicalRestriction ?? false,
              medical: { notes: athleteFields.medicalNotes, allergies: athleteFields.allergies },
              termsAccepted: athleteFields.termsAccepted ?? false,
              imageAuthorizationAccepted: athleteFields.imageAuthorizationAccepted ?? false,
            },
          ],
          { session },
        )
        if (!athleteDoc) {
          throw new Error('AthleteModel.create returned no document')
        }
        created = athleteDoc

        if (guardian) {
          await GuardianModel.create(
            [
              {
                athleteId: athleteDoc._id,
                name: guardian.name,
                relationship: guardian.relationship,
                phone: guardian.phone,
                email: guardian.email,
                cpf: guardian.cpf,
                termsAccepted: guardian.termsAccepted,
                imageAuthorizationAccepted: guardian.imageAuthorizationAccepted,
              },
            ],
            { session },
          )
        }

        await AuditLogModel.create(
          [
            {
              userId: ctx.userId,
              entityType: 'Athlete',
              entityId: athleteDoc._id,
              action: 'create',
              sessionId: ctx.sessionId,
              ip: ctx.ip,
            },
          ],
          { session },
        )
      })

      if (!created) {
        throw new Error('Athlete creation transaction did not produce a document')
      }
      return this.#toDTO(created)
    } catch (err) {
      if (this.#isDuplicateKeyError(err)) {
        throw new AthleteServiceError('CPF already registered in this academy', 409)
      }
      throw err
    } finally {
      await session.endSession()
    }
  }

  async getAthlete(id: string, ctx: Pick<AuthCtx, 'academyId' | 'role'>) {
    const includeMedical = hasMinRole(ctx.role, 'coach')
    const query = AthleteModel.findOne({ _id: id, academyId: ctx.academyId })
    const athlete = includeMedical ? await query.select('+medical') : await query

    if (!athlete) {
      throw new AthleteServiceError('Athlete not found', 404)
    }
    return this.#toDTO(athlete, includeMedical)
  }

  async listAthletes(
    academyId: string,
    filters: { q?: string | undefined; page?: number | undefined; pageSize?: number | undefined } = {},
  ) {
    const page = Math.max(1, filters.page ?? 1)
    const pageSize = Math.min(100, Math.max(1, filters.pageSize ?? 20))

    const query: Record<string, unknown> = { academyId }
    if (filters.q) {
      const escaped = filters.q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      query['$or'] = [
        { fullName: { $regex: escaped, $options: 'i' } },
        { cpf: filters.q },
        { enrollmentNumber: filters.q },
      ]
    }

    const [items, total] = await Promise.all([
      AthleteModel.find(query)
        .sort({ fullName: 1 })
        .skip((page - 1) * pageSize)
        .limit(pageSize),
      AthleteModel.countDocuments(query),
    ])

    return {
      items: items.map((a) => this.#toDTO(a)),
      total,
      page,
      pageSize,
    }
  }

  async updateAthlete(id: string, data: UpdateAthleteParams, ctx: AuthCtx) {
    // The route only requires 'staff' (front desk needs to fix a phone
    // number or belt typo), but medicalNotes/allergies are readable by
    // coach+ only (see #toDTO's includeMedical) — without this check a
    // staff-level PATCH could still *write* them, which would make the
    // read-side restriction pointless.
    if (
      (data.medicalNotes !== undefined || data.allergies !== undefined) &&
      !hasMinRole(ctx.role, 'coach')
    ) {
      throw new AthleteServiceError('Only coach and above can update medical notes/allergies', 403)
    }

    const athlete = await AthleteModel.findOne({ _id: id, academyId: ctx.academyId }).select('+medical')
    if (!athlete) {
      throw new AthleteServiceError('Athlete not found', 404)
    }

    if (data.cpf && data.cpf !== athlete.cpf) {
      if (!isValidCPF(data.cpf)) {
        throw new AthleteServiceError('Invalid CPF', 400)
      }
      const existing = await AthleteModel.findOne({ academyId: ctx.academyId, cpf: data.cpf, _id: { $ne: id } })
      if (existing) {
        throw new AthleteServiceError('CPF already registered in this academy', 409)
      }
    }

    if (data.userId !== undefined && data.userId !== athlete.userId?.toString()) {
      const user = await UserModel.findOne({ _id: data.userId, academyId: ctx.academyId, role: 'athlete', active: true })
      if (!user) throw new AthleteServiceError('Linked athlete user not found', 400)
    }

    const auditEntries: Array<{ fieldName: string; oldValue: unknown; newValue: unknown }> = []

    const simpleFields = [
      'userId', 'fullName', 'preferredName', 'gender', 'birthDate', 'nationality', 'email',
      'phone', 'cpf', 'currentBelt', 'federationNumber', 'zempoNumber', 'clubName', 'hasMedicalRestriction',
      'termsAccepted', 'imageAuthorizationAccepted',
    ] as const

    for (const field of simpleFields) {
      const newValue = data[field]
      if (newValue === undefined) continue
      const oldValue = athlete[field]
      if (oldValue !== newValue) {
        auditEntries.push({ fieldName: field, oldValue, newValue })
        // @ts-expect-error — dynamic assignment across a known field union
        athlete[field] = newValue
      }
    }

    if (data.medicalNotes !== undefined && data.medicalNotes !== athlete.medical?.notes) {
      auditEntries.push({ fieldName: 'medicalNotes', oldValue: athlete.medical?.notes, newValue: data.medicalNotes })
      athlete.medical = { ...athlete.medical, notes: data.medicalNotes }
    }
    if (data.allergies !== undefined && data.allergies !== athlete.medical?.allergies) {
      auditEntries.push({ fieldName: 'allergies', oldValue: athlete.medical?.allergies, newValue: data.allergies })
      athlete.medical = { ...athlete.medical, allergies: data.allergies }
    }

    if (auditEntries.length === 0) {
      return this.#toDTO(athlete, hasMinRole(ctx.role, 'coach'))
    }

    await athlete.save()

    await AuditLogModel.create(
      auditEntries.map((entry) => ({
        userId: ctx.userId,
        entityType: 'Athlete',
        entityId: athlete._id,
        action: 'update' as const,
        fieldName: entry.fieldName,
        oldValue: entry.oldValue,
        newValue: entry.newValue,
        sessionId: ctx.sessionId,
        ip: ctx.ip,
      })),
    )

    return this.#toDTO(athlete, hasMinRole(ctx.role, 'coach'))
  }

  async deactivateAthlete(id: string, reason: string, ctx: AuthCtx) {
    if (!reason || reason.trim().length === 0) {
      throw new AthleteServiceError('Reason is required', 400)
    }
    const athlete = await AthleteModel.findOne({ _id: id, academyId: ctx.academyId })
    if (!athlete) {
      throw new AthleteServiceError('Athlete not found', 404)
    }

    const oldStatus = athlete.status
    athlete.status = 'inactive'
    athlete.deactivatedReason = reason
    await athlete.save()

    await AuditLogModel.create({
      userId: ctx.userId,
      entityType: 'Athlete',
      entityId: athlete._id,
      action: 'update',
      fieldName: 'status',
      oldValue: oldStatus,
      newValue: 'inactive',
      reason,
      sessionId: ctx.sessionId,
      ip: ctx.ip,
    })
  }

  async addBeltRecord(athleteId: string, data: CreateBeltRecordInput, ctx: AuthCtx) {
    const athlete = await AthleteModel.findOne({ _id: athleteId, academyId: ctx.academyId })
    if (!athlete) {
      throw new AthleteServiceError('Athlete not found', 404)
    }

    const record = await BeltRecordModel.create({
      athleteId: athlete._id,
      belt: data.belt,
      grantedAt: data.grantedAt,
      grantedBy: ctx.userId,
      notes: data.notes,
    })

    const oldBelt = athlete.currentBelt
    athlete.currentBelt = data.belt
    await athlete.save()

    await AuditLogModel.create({
      userId: ctx.userId,
      entityType: 'Athlete',
      entityId: athlete._id,
      action: 'update',
      fieldName: 'currentBelt',
      oldValue: oldBelt,
      newValue: data.belt,
      sessionId: ctx.sessionId,
      ip: ctx.ip,
    })

    return this.#beltToDTO(record)
  }

  async listBeltRecords(athleteId: string, academyId: string) {
    const athlete = await AthleteModel.findOne({ _id: athleteId, academyId })
    if (!athlete) {
      throw new AthleteServiceError('Athlete not found', 404)
    }
    const records = await BeltRecordModel.find({ athleteId }).sort({ grantedAt: -1 })
    return records.map((r) => this.#beltToDTO(r))
  }

  async addGuardian(athleteId: string, data: CreateGuardianInput, ctx: AuthCtx) {
    const athlete = await AthleteModel.findOne({ _id: athleteId, academyId: ctx.academyId })
    if (!athlete) {
      throw new AthleteServiceError('Athlete not found', 404)
    }
    const existing = await GuardianModel.findOne({ athleteId })
    if (existing) {
      throw new AthleteServiceError('Guardian already registered for this athlete', 409)
    }

    const guardian = await GuardianModel.create({
      athleteId,
      name: data.name,
      relationship: data.relationship,
      phone: data.phone,
      email: data.email,
      cpf: data.cpf,
      termsAccepted: data.termsAccepted,
      imageAuthorizationAccepted: data.imageAuthorizationAccepted,
    })

    await AuditLogModel.create({
      userId: ctx.userId,
      entityType: 'Guardian',
      entityId: guardian._id,
      action: 'create',
      sessionId: ctx.sessionId,
      ip: ctx.ip,
    })

    return this.#guardianToDTO(guardian)
  }

  async getGuardian(athleteId: string, academyId: string) {
    const athlete = await AthleteModel.findOne({ _id: athleteId, academyId })
    if (!athlete) {
      throw new AthleteServiceError('Athlete not found', 404)
    }
    const guardian = await GuardianModel.findOne({ athleteId })
    if (!guardian) {
      throw new AthleteServiceError('No guardian registered for this athlete', 404)
    }
    return this.#guardianToDTO(guardian)
  }

  #isDuplicateKeyError(err: unknown): boolean {
    return typeof err === 'object' && err !== null && 'code' in err && (err as { code: unknown }).code === 11000
  }

  #toDTO(athlete: AthleteDocument & { _id: Types.ObjectId }, includeMedical = false) {
    return {
      id: athlete._id.toString(),
      academyId: athlete.academyId.toString(),
      userId: athlete.userId?.toString(),
      status: athlete.status,
      enrollmentNumber: athlete.enrollmentNumber,
      fullName: athlete.fullName,
      preferredName: athlete.preferredName,
      gender: athlete.gender,
      birthDate: athlete.birthDate,
      nationality: athlete.nationality,
      email: athlete.email,
      phone: athlete.phone,
      cpf: athlete.cpf,
      currentBelt: athlete.currentBelt,
      federationNumber: athlete.federationNumber,
      zempoNumber: athlete.zempoNumber,
      clubName: athlete.clubName,
      latestWeightKg: athlete.latestWeightKg,
      hasMedicalRestriction: athlete.hasMedicalRestriction,
      medicalNotes: includeMedical ? athlete.medical?.notes : undefined,
      allergies: includeMedical ? athlete.medical?.allergies : undefined,
      termsAccepted: athlete.termsAccepted,
      imageAuthorizationAccepted: athlete.imageAuthorizationAccepted,
      createdAt: athlete.createdAt.toISOString(),
      updatedAt: athlete.updatedAt.toISOString(),
    }
  }

  #beltToDTO(record: BeltRecordDocument) {
    return {
      id: record._id.toString(),
      athleteId: record.athleteId.toString(),
      belt: record.belt,
      grantedAt: record.grantedAt,
      grantedBy: record.grantedBy.toString(),
      notes: record.notes,
      createdAt: record.createdAt.toISOString(),
    }
  }

  #guardianToDTO(guardian: GuardianDocument) {
    return {
      id: guardian._id.toString(),
      athleteId: guardian.athleteId.toString(),
      name: guardian.name,
      relationship: guardian.relationship,
      phone: guardian.phone,
      email: guardian.email,
      cpf: guardian.cpf,
      userId: guardian.userId?.toString(),
      termsAccepted: guardian.termsAccepted,
      imageAuthorizationAccepted: guardian.imageAuthorizationAccepted,
      createdAt: guardian.createdAt.toISOString(),
      updatedAt: guardian.updatedAt.toISOString(),
    }
  }
}

export class AthleteServiceError extends Error {
  constructor(
    message: string,
    public readonly statusCode: 400 | 401 | 403 | 404 | 409,
  ) {
    super(message)
    this.name = 'AthleteServiceError'
  }
}
