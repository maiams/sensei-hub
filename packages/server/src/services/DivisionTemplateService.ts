import { DivisionTemplateModel, type DivisionTemplateDocument } from '../repositories/DivisionTemplateModel.js'
import { DivisionGroupModel, type DivisionGroupDocument } from '../repositories/DivisionGroupModel.js'
import { AuditLogModel } from '../repositories/AuditLogModel.js'
import { FPJ_PRESET_TEMPLATES } from './fpjPreset.js'
import type { CreateDivisionTemplateInput, UpdateDivisionTemplateInput, DivisionTemplateDTO, DivisionGroupDTO } from '@sensei-hub/shared'

export interface DivisionCtx {
  userId: string
  academyId: string
  sessionId: string
  ip?: string
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

export class DivisionTemplateService {
  async listTemplates(academyId: string): Promise<DivisionTemplateDTO[]> {
    const templates = await DivisionTemplateModel.find({ academyId }).sort({ order: 1 })
    const groups = await DivisionGroupModel.find({ academyId }).sort({ order: 1 })

    const groupsByTemplate = new Map<string, DivisionGroupDocument[]>()
    for (const group of groups) {
      const key = group.divisionTemplateId.toString()
      const list = groupsByTemplate.get(key) ?? []
      list.push(group)
      groupsByTemplate.set(key, list)
    }

    return templates.map((t) => this.#toDTO(t, groupsByTemplate.get(t._id.toString()) ?? []))
  }

  async createTemplate(academyId: string, input: CreateDivisionTemplateInput, ctx: DivisionCtx): Promise<DivisionTemplateDTO> {
    const key = await this.#generateUniqueKey(academyId, input.label)
    const order = await this.#nextOrder(academyId)

    const template = await DivisionTemplateModel.create({
      academyId,
      key,
      label: input.label,
      minAge: input.minAge ?? null,
      maxAge: input.maxAge ?? null,
      order,
    })

    await AuditLogModel.create({
      userId: ctx.userId,
      entityType: 'DivisionTemplate',
      entityId: template._id,
      action: 'create',
      sessionId: ctx.sessionId,
      ip: ctx.ip,
    })

    return this.#toDTO(template, [])
  }

  async updateTemplate(
    academyId: string,
    key: string,
    input: UpdateDivisionTemplateInput,
    ctx: DivisionCtx,
  ): Promise<DivisionTemplateDTO> {
    const template = await DivisionTemplateModel.findOne({ academyId, key })
    if (!template) {
      throw new DivisionTemplateServiceError('Division not found', 404)
    }

    const auditEntries: Array<{ fieldName: string; oldValue: unknown; newValue: unknown }> = []
    const fields = ['label', 'minAge', 'maxAge'] as const
    for (const field of fields) {
      const newValue = input[field]
      if (newValue === undefined) continue
      const oldValue = template[field]
      if (oldValue !== newValue) {
        auditEntries.push({ fieldName: field, oldValue, newValue })
        // @ts-expect-error — dynamic assignment across a known field union
        template[field] = newValue
      }
    }

    if (auditEntries.length > 0) {
      await template.save()
      await AuditLogModel.create(
        auditEntries.map((entry) => ({
          userId: ctx.userId,
          entityType: 'DivisionTemplate',
          entityId: template._id,
          action: 'update' as const,
          fieldName: entry.fieldName,
          oldValue: entry.oldValue,
          newValue: entry.newValue,
          sessionId: ctx.sessionId,
          ip: ctx.ip,
        })),
      )
    }

    const groups = await DivisionGroupModel.find({ academyId, divisionTemplateId: template._id }).sort({ order: 1 })
    return this.#toDTO(template, groups)
  }

  async deleteTemplate(academyId: string, key: string, ctx: DivisionCtx): Promise<void> {
    const template = await DivisionTemplateModel.findOne({ academyId, key })
    if (!template) {
      throw new DivisionTemplateServiceError('Division not found', 404)
    }

    const groups = await DivisionGroupModel.find({ academyId, divisionTemplateId: template._id })

    await DivisionGroupModel.deleteMany({ academyId, divisionTemplateId: template._id })
    await DivisionTemplateModel.deleteOne({ _id: template._id })

    await AuditLogModel.create({
      userId: ctx.userId,
      entityType: 'DivisionTemplate',
      entityId: template._id,
      action: 'delete',
      oldValue: {
        label: template.label,
        minAge: template.minAge,
        maxAge: template.maxAge,
        groups: groups.map((g) => ({ label: g.label, categories: g.categories })),
      },
      sessionId: ctx.sessionId,
      ip: ctx.ip,
    })
  }

  // Idempotent — only creates the FPJ divisions that don't already exist (by
  // key) for this academy, so deleting one and reloading doesn't touch the rest.
  async loadFpjPreset(academyId: string, ctx: DivisionCtx): Promise<DivisionTemplateDTO[]> {
    const presetKeys = FPJ_PRESET_TEMPLATES.map((t) => t.key)
    const existing = await DivisionTemplateModel.find({ academyId, key: { $in: presetKeys } })
    const existingKeys = new Set(existing.map((t) => t.key))
    const toCreate = FPJ_PRESET_TEMPLATES.filter((t) => !existingKeys.has(t.key))

    if (toCreate.length === 0) return []

    let nextOrder = await this.#nextOrder(academyId)
    const created: DivisionTemplateDTO[] = []

    for (const preset of toCreate) {
      const template = await DivisionTemplateModel.create({
        academyId,
        key: preset.key,
        label: preset.label,
        minAge: preset.minAge,
        maxAge: preset.maxAge,
        order: nextOrder++,
      })

      const maleGroup = await DivisionGroupModel.create({
        academyId,
        divisionTemplateId: template._id,
        label: 'Masculino',
        order: 0,
        categories: preset.categories.male,
        sourcePreset: { templateKey: preset.key, groupLabel: 'male' },
      })
      const femaleGroup = await DivisionGroupModel.create({
        academyId,
        divisionTemplateId: template._id,
        label: 'Feminino',
        order: 1,
        categories: preset.categories.female,
        sourcePreset: { templateKey: preset.key, groupLabel: 'female' },
      })

      await AuditLogModel.create({
        userId: ctx.userId,
        entityType: 'DivisionTemplate',
        entityId: template._id,
        action: 'create',
        reason: 'load-fpj-preset',
        sessionId: ctx.sessionId,
        ip: ctx.ip,
      })

      created.push(this.#toDTO(template, [maleGroup, femaleGroup]))
    }

    return created
  }

  async #nextOrder(academyId: string): Promise<number> {
    const last = await DivisionTemplateModel.findOne({ academyId }).sort({ order: -1 })
    return (last?.order ?? -1) + 1
  }

  async #generateUniqueKey(academyId: string, label: string): Promise<string> {
    const base = slugify(label) || 'divisao'
    let candidate = base
    let suffix = 2
    while (await DivisionTemplateModel.exists({ academyId, key: candidate })) {
      candidate = `${base}-${suffix}`
      suffix++
    }
    return candidate
  }

  #toDTO(template: DivisionTemplateDocument, groups: DivisionGroupDocument[]): DivisionTemplateDTO {
    return {
      id: template._id.toString(),
      key: template.key,
      label: template.label,
      minAge: template.minAge,
      maxAge: template.maxAge,
      order: template.order,
      groups: groups.map((g) => ({
        id: g._id.toString(),
        label: g.label,
        order: g.order,
        categories: g.categories,
        canRestoreFromPreset: g.sourcePreset !== null,
      })),
    }
  }
}

export class DivisionTemplateServiceError extends Error {
  constructor(
    message: string,
    public readonly statusCode: 400 | 404 | 409,
  ) {
    super(message)
    this.name = 'DivisionTemplateServiceError'
  }
}
