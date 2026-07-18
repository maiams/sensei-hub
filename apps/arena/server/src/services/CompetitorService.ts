import { AthleteModel, type AthleteDocument } from '../repositories/AthleteModel.js'
import { AuditLogModel, type AuthCtx } from '@sensei-hub/core-server'
import { isValidCPF } from '@sensei-hub/shared'
import type { CreateCompetitorInput, UpdateCompetitorInput } from '@arena/shared'

export function isMinor(birthDate: string, referenceDate = new Date().toISOString().slice(0, 10)): boolean {
  const [by, bm, bd] = birthDate.split('-').map(Number) as [number, number, number]
  const [ry, rm, rd] = referenceDate.split('-').map(Number) as [number, number, number]
  let age = ry - by
  if (rm < bm || (rm === bm && rd < bd)) age--
  return age < 18
}

export class CompetitorService {
  async createCompetitor(input: CreateCompetitorInput, ctx: AuthCtx) {
    if (input.cpf && !isValidCPF(input.cpf)) {
      throw new CompetitorServiceError('Invalid CPF', 400)
    }

    // Minors need the guardian consent trail — free-text name/phone captured
    // at registration (import already enforces termos_aceitos at parse time).
    if (isMinor(input.birthDate) && !(input.guardianName && input.guardianPhone)) {
      throw new CompetitorServiceError('Guardian name and phone are required for athletes under 18', 400)
    }

    if (input.cpf) {
      const existing = await AthleteModel.findOne({ academyId: ctx.academyId, cpf: input.cpf })
      if (existing) {
        throw new CompetitorServiceError('CPF already registered in this organization', 409)
      }
    }

    let created: AthleteDocument
    try {
      created = await AthleteModel.create({ ...input, academyId: ctx.academyId })
    } catch (err) {
      if (this.#isDuplicateKeyError(err)) {
        throw new CompetitorServiceError('CPF already registered in this organization', 409)
      }
      throw err
    }

    await AuditLogModel.create({
      userId: ctx.userId,
      entityType: 'Athlete',
      entityId: created._id,
      action: 'create',
      sessionId: ctx.sessionId,
      ip: ctx.ip,
    })

    return this.#toDTO(created)
  }

  async getCompetitor(id: string, academyId: string) {
    const athlete = await AthleteModel.findOne({ _id: id, academyId })
    if (!athlete) {
      throw new CompetitorServiceError('Athlete not found', 404)
    }
    return this.#toDTO(athlete)
  }

  async listCompetitors(
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
        { clubName: { $regex: escaped, $options: 'i' } },
        { cpf: filters.q },
      ]
    }

    const [items, total] = await Promise.all([
      AthleteModel.find(query)
        .sort({ fullName: 1 })
        .skip((page - 1) * pageSize)
        .limit(pageSize),
      AthleteModel.countDocuments(query),
    ])

    return { items: items.map((a) => this.#toDTO(a)), total, page, pageSize }
  }

  async updateCompetitor(id: string, data: UpdateCompetitorInput, ctx: AuthCtx) {
    const athlete = await AthleteModel.findOne({ _id: id, academyId: ctx.academyId })
    if (!athlete) {
      throw new CompetitorServiceError('Athlete not found', 404)
    }

    if (data.cpf && data.cpf !== athlete.cpf) {
      if (!isValidCPF(data.cpf)) {
        throw new CompetitorServiceError('Invalid CPF', 400)
      }
      const existing = await AthleteModel.findOne({ academyId: ctx.academyId, cpf: data.cpf, _id: { $ne: id } })
      if (existing) {
        throw new CompetitorServiceError('CPF already registered in this organization', 409)
      }
    }

    const auditEntries: Array<{ fieldName: string; oldValue: unknown; newValue: unknown }> = []
    for (const [field, newValue] of Object.entries(data) as Array<[keyof UpdateCompetitorInput, unknown]>) {
      if (newValue === undefined) continue
      const oldValue = athlete[field as keyof AthleteDocument]
      if (oldValue === newValue) continue
      auditEntries.push({ fieldName: field, oldValue, newValue })
      ;(athlete as unknown as Record<string, unknown>)[field] = newValue
    }

    await athlete.save()

    for (const entry of auditEntries) {
      await AuditLogModel.create({
        userId: ctx.userId,
        entityType: 'Athlete',
        entityId: athlete._id,
        action: 'update',
        fieldName: entry.fieldName,
        oldValue: entry.oldValue,
        newValue: entry.newValue,
        sessionId: ctx.sessionId,
        ip: ctx.ip,
      })
    }

    return this.#toDTO(athlete)
  }

  #isDuplicateKeyError(err: unknown): boolean {
    return typeof err === 'object' && err !== null && 'code' in err && (err as { code: unknown }).code === 11000
  }

  #toDTO(athlete: AthleteDocument) {
    return {
      id: athlete._id.toString(),
      academyId: athlete.academyId.toString(),
      fullName: athlete.fullName,
      preferredName: athlete.preferredName,
      gender: athlete.gender,
      birthDate: athlete.birthDate,
      cpf: athlete.cpf,
      currentBelt: athlete.currentBelt,
      clubName: athlete.clubName,
      federationNumber: athlete.federationNumber,
      zempoNumber: athlete.zempoNumber,
      email: athlete.email,
      phone: athlete.phone,
      guardianName: athlete.guardianName,
      guardianPhone: athlete.guardianPhone,
      termsAccepted: athlete.termsAccepted,
      notes: athlete.notes,
      latestWeightKg: athlete.latestWeightKg,
      createdAt: athlete.createdAt.toISOString(),
      updatedAt: athlete.updatedAt.toISOString(),
    }
  }
}

export class CompetitorServiceError extends Error {
  constructor(
    message: string,
    public readonly statusCode: 400 | 404 | 409,
  ) {
    super(message)
    this.name = 'CompetitorServiceError'
  }
}
