import { AthleteModel } from '../repositories/AthleteModel.js'
import { WeightRecordModel, type WeightRecordDocument } from '../repositories/WeightRecordModel.js'
import { AuditLogModel } from '@sensei-hub/core-server'
import type { WeightSource } from '@sensei-hub/shared'
import type { AuthCtx } from '@sensei-hub/core-server'

export class WeightService {
  async recordWeight(athleteId: string, weightKg: number, source: WeightSource, ctx: AuthCtx) {
    const athlete = await AthleteModel.findOne({ _id: athleteId, academyId: ctx.academyId })
    if (!athlete) {
      throw new WeightServiceError('Athlete not found', 404)
    }

    const record = await WeightRecordModel.create({
      athleteId,
      weightKg,
      source,
      operatorId: ctx.userId,
      recordedAt: new Date(),
    })

    athlete.latestWeightKg = weightKg
    await athlete.save()

    await AuditLogModel.create({
      userId: ctx.userId,
      entityType: 'WeightRecord',
      entityId: record._id,
      action: 'create',
      sessionId: ctx.sessionId,
      ip: ctx.ip,
    })

    return this.#toDTO(record)
  }

  async listWeightRecords(athleteId: string, academyId: string) {
    const athlete = await AthleteModel.findOne({ _id: athleteId, academyId })
    if (!athlete) {
      throw new WeightServiceError('Athlete not found', 404)
    }
    const records = await WeightRecordModel.find({ athleteId }).sort({ recordedAt: -1 })
    return records.map((r) => this.#toDTO(r))
  }

  async correctWeight(originalRecordId: string, newWeightKg: number, reason: string, ctx: AuthCtx) {
    if (!reason || reason.trim().length === 0) {
      throw new WeightServiceError('Correction reason is required', 400)
    }

    const original = await WeightRecordModel.findById(originalRecordId)
    if (!original) {
      throw new WeightServiceError('Weight record not found', 404)
    }

    const athlete = await AthleteModel.findOne({ _id: original.athleteId, academyId: ctx.academyId })
    if (!athlete) {
      throw new WeightServiceError('Weight record not found', 404)
    }

    // Append-only correction — the original record is never mutated or deleted.
    const corrected = await WeightRecordModel.create({
      athleteId: original.athleteId,
      weightKg: newWeightKg,
      source: 'corrected',
      operatorId: ctx.userId,
      recordedAt: new Date(),
      correctionReason: reason,
      originalRecordId: original._id,
    })

    athlete.latestWeightKg = newWeightKg
    await athlete.save()

    await AuditLogModel.create({
      userId: ctx.userId,
      entityType: 'WeightRecord',
      entityId: corrected._id,
      action: 'update',
      fieldName: 'weightKg',
      oldValue: original.weightKg,
      newValue: newWeightKg,
      reason,
      sessionId: ctx.sessionId,
      ip: ctx.ip,
    })

    return this.#toDTO(corrected)
  }

  #toDTO(record: WeightRecordDocument) {
    return {
      id: record._id.toString(),
      athleteId: record.athleteId.toString(),
      weightKg: record.weightKg,
      source: record.source,
      operatorId: record.operatorId.toString(),
      recordedAt: record.recordedAt.toISOString(),
      correctionReason: record.correctionReason,
      originalRecordId: record.originalRecordId?.toString(),
    }
  }
}

export class WeightServiceError extends Error {
  constructor(
    message: string,
    public readonly statusCode: 400 | 404,
  ) {
    super(message)
    this.name = 'WeightServiceError'
  }
}
