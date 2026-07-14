import { WeightCategoryModel, type WeightCategoryRowSubdoc } from '../repositories/WeightCategoryModel.js'
import { AuditLogModel } from '../repositories/AuditLogModel.js'
import { getWeightCategories as getDefaultWeightCategories } from './AgeClassService.js'
import {
  AGE_CLASS_GROUPS,
  findAgeClassGroup,
  type AgeClass,
  type Gender,
  type WeightCategoryRow,
  type WeightCategoryGroupDTO,
} from '@sensei-hub/shared'

export interface WeightCategoryCtx {
  userId: string
  sessionId: string
  ip?: string
}

const EDITABLE_GENDERS: ReadonlyArray<'male' | 'female'> = ['male', 'female']

function validateCategoryOrder(categories: WeightCategoryRow[]): void {
  categories.forEach((cat, i) => {
    if (cat.maxKg === null && i !== categories.length - 1) {
      throw new WeightCategoryServiceError('Only the last category may be open (no maxKg)', 400)
    }
  })

  const capped = categories.filter((c): c is { label: string; maxKg: number } => c.maxKg !== null)
  for (let i = 1; i < capped.length; i++) {
    const prev = capped[i - 1]
    const curr = capped[i]
    if (!prev || !curr || curr.maxKg <= prev.maxKg) {
      throw new WeightCategoryServiceError('Categories must be in strictly ascending order by maxKg', 400)
    }
  }
}

export class WeightCategoryService {
  async listGroups(academyId: string): Promise<WeightCategoryGroupDTO[]> {
    const overrides = await WeightCategoryModel.find({ academyId })
    const overrideMap = new Map<string, WeightCategoryRowSubdoc[]>()
    for (const o of overrides) overrideMap.set(`${o.gender}:${o.ageClass}`, o.categories)

    const groups: WeightCategoryGroupDTO[] = []
    for (const group of AGE_CLASS_GROUPS) {
      for (const gender of EDITABLE_GENDERS) {
        groups.push(this.#buildGroupDTO(group.key, gender, overrideMap))
      }
    }
    return groups
  }

  async updateGroup(
    academyId: string,
    groupKey: string,
    gender: 'male' | 'female',
    categories: WeightCategoryRow[],
    ctx: WeightCategoryCtx,
  ): Promise<WeightCategoryGroupDTO> {
    const group = findAgeClassGroup(groupKey)
    if (!group) throw new WeightCategoryServiceError('Unknown category group', 404)

    validateCategoryOrder(categories)

    const previous = await this.#getEffectiveCategories(academyId, gender, group.ageClasses[0] as AgeClass)

    await Promise.all(
      group.ageClasses.map((ageClass) =>
        WeightCategoryModel.findOneAndUpdate(
          { academyId, gender, ageClass },
          { $set: { categories } },
          { upsert: true },
        ),
      ),
    )

    await AuditLogModel.create({
      userId: ctx.userId,
      entityType: 'WeightCategoryGroup',
      entityId: academyId,
      action: 'update',
      fieldName: `${groupKey}:${gender}`,
      oldValue: previous,
      newValue: categories,
      sessionId: ctx.sessionId,
      ip: ctx.ip,
    })

    return { groupKey: group.key, label: group.label, gender, categories, isDefault: false }
  }

  async resetGroup(
    academyId: string,
    groupKey: string,
    gender: 'male' | 'female',
    ctx: WeightCategoryCtx,
  ): Promise<WeightCategoryGroupDTO> {
    const group = findAgeClassGroup(groupKey)
    if (!group) throw new WeightCategoryServiceError('Unknown category group', 404)

    const previous = await this.#getEffectiveCategories(academyId, gender, group.ageClasses[0] as AgeClass)

    await WeightCategoryModel.deleteMany({ academyId, gender, ageClass: { $in: group.ageClasses } })

    await AuditLogModel.create({
      userId: ctx.userId,
      entityType: 'WeightCategoryGroup',
      entityId: academyId,
      action: 'delete',
      fieldName: `${groupKey}:${gender}`,
      oldValue: previous,
      newValue: getDefaultWeightCategories(gender, group.ageClasses[0] as AgeClass),
      sessionId: ctx.sessionId,
      ip: ctx.ip,
    })

    return this.#buildGroupDTO(groupKey, gender, new Map())
  }

  // Used by later phases (e.g. Fase 3A division setup) to resolve the categories
  // that actually apply for a given academy — override if the academy customized
  // it, otherwise the hardcoded FPJ default from AgeClassService.
  async getEffectiveCategories(academyId: string, gender: Gender, ageClass: AgeClass) {
    if (gender === 'not_informed') {
      return getDefaultWeightCategories(gender, ageClass)
    }
    return this.#getEffectiveCategories(academyId, gender, ageClass)
  }

  async #getEffectiveCategories(academyId: string, gender: 'male' | 'female', ageClass: AgeClass) {
    const override = await WeightCategoryModel.findOne({ academyId, gender, ageClass })
    return override ? override.categories : getDefaultWeightCategories(gender, ageClass)
  }

  #buildGroupDTO(
    groupKey: string,
    gender: 'male' | 'female',
    overrideMap: Map<string, WeightCategoryRowSubdoc[]>,
  ): WeightCategoryGroupDTO {
    const group = findAgeClassGroup(groupKey)
    if (!group) throw new WeightCategoryServiceError('Unknown category group', 404)

    const representativeAgeClass = group.ageClasses[0] as AgeClass
    const override = overrideMap.get(`${gender}:${representativeAgeClass}`)
    const categories = override ?? getDefaultWeightCategories(gender, representativeAgeClass)

    return {
      groupKey: group.key,
      label: group.label,
      gender,
      categories,
      isDefault: !override,
    }
  }
}

export class WeightCategoryServiceError extends Error {
  constructor(
    message: string,
    public readonly statusCode: 400 | 404,
  ) {
    super(message)
    this.name = 'WeightCategoryServiceError'
  }
}
