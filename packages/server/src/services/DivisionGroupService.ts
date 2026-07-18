import { DivisionTemplateModel, type DivisionTemplateDocument } from '../repositories/DivisionTemplateModel.js'
import { DivisionGroupModel, type DivisionGroupDocument } from '../repositories/DivisionGroupModel.js'
import { AuditLogModel } from '@sensei-hub/core-server'
import { findFpjPresetTemplate } from './fpjPreset.js'
import type { DivisionCtx } from './DivisionTemplateService.js'
import type { WeightCategoryRow, DivisionGroupDTO, CreateDivisionGroupInput, UpdateDivisionGroupInput } from '@sensei-hub/shared'

function validateCategoryOrder(categories: WeightCategoryRow[]): void {
  categories.forEach((cat, i) => {
    if (cat.maxKg === null && i !== categories.length - 1) {
      throw new DivisionGroupServiceError('Only the last category may be open (no maxKg)', 400)
    }
  })

  const capped = categories.filter((c): c is { label: string; maxKg: number } => c.maxKg !== null)
  for (let i = 1; i < capped.length; i++) {
    const prev = capped[i - 1]
    const curr = capped[i]
    if (!prev || !curr || curr.maxKg <= prev.maxKg) {
      throw new DivisionGroupServiceError('Categories must be in strictly ascending order by maxKg', 400)
    }
  }
}

export class DivisionGroupService {
  async listGroups(academyId: string, templateKey: string): Promise<DivisionGroupDTO[]> {
    const template = await this.#findTemplate(academyId, templateKey)
    const groups = await DivisionGroupModel.find({ academyId, divisionTemplateId: template._id }).sort({ order: 1 })
    return groups.map((g) => this.#toDTO(g))
  }

  async createGroup(
    academyId: string,
    templateKey: string,
    data: CreateDivisionGroupInput,
    ctx: DivisionCtx,
  ): Promise<DivisionGroupDTO> {
    const template = await this.#findTemplate(academyId, templateKey)
    validateCategoryOrder(data.categories)

    const last = await DivisionGroupModel.findOne({ academyId, divisionTemplateId: template._id }).sort({ order: -1 })
    const order = (last?.order ?? -1) + 1

    const group = await DivisionGroupModel.create({
      academyId,
      divisionTemplateId: template._id,
      label: data.label,
      order,
      categories: data.categories,
      sourcePreset: null,
    })

    await AuditLogModel.create({
      userId: ctx.userId,
      entityType: 'DivisionGroup',
      entityId: group._id,
      action: 'create',
      sessionId: ctx.sessionId,
      ip: ctx.ip,
    })

    return this.#toDTO(group)
  }

  async updateGroup(
    academyId: string,
    templateKey: string,
    groupId: string,
    data: UpdateDivisionGroupInput,
    ctx: DivisionCtx,
  ): Promise<DivisionGroupDTO> {
    const template = await this.#findTemplate(academyId, templateKey)
    const group = await DivisionGroupModel.findOne({ _id: groupId, academyId, divisionTemplateId: template._id })
    if (!group) {
      throw new DivisionGroupServiceError('Group not found', 404)
    }

    if (data.categories) {
      validateCategoryOrder(data.categories)
    }

    const auditEntries: Array<{ fieldName: string; oldValue: unknown; newValue: unknown }> = []
    if (data.label !== undefined && data.label !== group.label) {
      auditEntries.push({ fieldName: 'label', oldValue: group.label, newValue: data.label })
      group.label = data.label
    }
    if (data.categories !== undefined) {
      auditEntries.push({ fieldName: 'categories', oldValue: group.categories, newValue: data.categories })
      group.categories = data.categories
    }

    if (auditEntries.length === 0) {
      return this.#toDTO(group)
    }

    await group.save()
    await AuditLogModel.create(
      auditEntries.map((entry) => ({
        userId: ctx.userId,
        entityType: 'DivisionGroup',
        entityId: group._id,
        action: 'update' as const,
        fieldName: entry.fieldName,
        oldValue: entry.oldValue,
        newValue: entry.newValue,
        sessionId: ctx.sessionId,
        ip: ctx.ip,
      })),
    )

    return this.#toDTO(group)
  }

  async deleteGroup(academyId: string, templateKey: string, groupId: string, ctx: DivisionCtx): Promise<void> {
    const template = await this.#findTemplate(academyId, templateKey)
    const group = await DivisionGroupModel.findOne({ _id: groupId, academyId, divisionTemplateId: template._id })
    if (!group) {
      throw new DivisionGroupServiceError('Group not found', 404)
    }

    await DivisionGroupModel.deleteOne({ _id: group._id })

    await AuditLogModel.create({
      userId: ctx.userId,
      entityType: 'DivisionGroup',
      entityId: group._id,
      action: 'delete',
      oldValue: { label: group.label, categories: group.categories },
      sessionId: ctx.sessionId,
      ip: ctx.ip,
    })
  }

  async restoreFromPreset(academyId: string, templateKey: string, groupId: string, ctx: DivisionCtx): Promise<DivisionGroupDTO> {
    const template = await this.#findTemplate(academyId, templateKey)
    const group = await DivisionGroupModel.findOne({ _id: groupId, academyId, divisionTemplateId: template._id })
    if (!group) {
      throw new DivisionGroupServiceError('Group not found', 404)
    }
    if (!group.sourcePreset) {
      throw new DivisionGroupServiceError('This group did not come from a preset', 400)
    }

    const preset = findFpjPresetTemplate(group.sourcePreset.templateKey)
    if (!preset) {
      throw new DivisionGroupServiceError('Preset no longer available', 400)
    }

    const oldCategories = group.categories
    group.categories = preset.categories[group.sourcePreset.groupLabel]
    await group.save()

    await AuditLogModel.create({
      userId: ctx.userId,
      entityType: 'DivisionGroup',
      entityId: group._id,
      action: 'update',
      fieldName: 'categories',
      oldValue: oldCategories,
      newValue: group.categories,
      reason: 'restore-preset',
      sessionId: ctx.sessionId,
      ip: ctx.ip,
    })

    return this.#toDTO(group)
  }

  async #findTemplate(academyId: string, key: string): Promise<DivisionTemplateDocument> {
    const template = await DivisionTemplateModel.findOne({ academyId, key })
    if (!template) {
      throw new DivisionGroupServiceError('Division not found', 404)
    }
    return template
  }

  #toDTO(group: DivisionGroupDocument): DivisionGroupDTO {
    return {
      id: group._id.toString(),
      label: group.label,
      order: group.order,
      categories: group.categories,
      canRestoreFromPreset: group.sourcePreset !== null,
    }
  }
}

export class DivisionGroupServiceError extends Error {
  constructor(
    message: string,
    public readonly statusCode: 400 | 404,
  ) {
    super(message)
    this.name = 'DivisionGroupServiceError'
  }
}
