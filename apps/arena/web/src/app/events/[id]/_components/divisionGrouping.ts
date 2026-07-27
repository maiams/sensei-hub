// Groups the flat division list into a navigable Age Division > Group
// (gender/category) tree instead of the 78-empty/17-singleton flat list of
// 106 rows a real academy-preset import produces (see CLAUDE.md diagnosis).
//
// Divisions created via POST /divisions/import-from-templates always get
// `name: "${template.label} — ${group.label} — ${category.label}"` (see
// apps/arena/server/src/services/DivisionService.ts) plus sourceTemplateKey/
// sourceGroupId — that's the only reliable signal we have for grouping,
// since a Division has no separate ageDivision/gender fields of its own
// (free-text by design, see divisionTemplate.ts). Manually created divisions
// (no sourceTemplateKey) can't be split this way and are bucketed together
// under "Divisões manuais".

export interface DivisionLite {
  id: string
  name: string
  minAge: number | null
  maxAge: number | null
  weightLimitKg: number | null
  sourceTemplateKey?: string
  sourceGroupId?: string
}

export interface DivisionSubgroupNode {
  key: string
  label: string
  divisions: DivisionLite[]
}

export interface DivisionAgeGroupNode {
  key: string
  label: string
  subgroups: DivisionSubgroupNode[]
  loose: DivisionLite[] // ungrouped divisions directly under this age bucket (manual ones)
}

const MANUAL_BUCKET_KEY = '__manual__'
const MANUAL_BUCKET_LABEL = 'Divisões manuais / sem padrão'

function splitName(name: string): [string, string] | null {
  const parts = name.split(' — ')
  if (parts.length === 3) return [parts[0]!, parts[1]!]
  return null
}

export function groupDivisions(divisions: DivisionLite[]): DivisionAgeGroupNode[] {
  const ageOrder: string[] = []
  const ageNodes = new Map<string, DivisionAgeGroupNode>()

  for (const division of divisions) {
    const split = division.sourceTemplateKey ? splitName(division.name) : null

    if (!split) {
      let node = ageNodes.get(MANUAL_BUCKET_KEY)
      if (!node) {
        node = { key: MANUAL_BUCKET_KEY, label: MANUAL_BUCKET_LABEL, subgroups: [], loose: [] }
        ageNodes.set(MANUAL_BUCKET_KEY, node)
        ageOrder.push(MANUAL_BUCKET_KEY)
      }
      node.loose.push(division)
      continue
    }

    const [ageLabel, groupLabel] = split
    const ageKey = division.sourceTemplateKey!
    let ageNode = ageNodes.get(ageKey)
    if (!ageNode) {
      ageNode = { key: ageKey, label: ageLabel, subgroups: [], loose: [] }
      ageNodes.set(ageKey, ageNode)
      ageOrder.push(ageKey)
    }

    const subKey = division.sourceGroupId ?? groupLabel
    let subNode = ageNode.subgroups.find((s) => s.key === subKey)
    if (!subNode) {
      subNode = { key: subKey, label: groupLabel, divisions: [] }
      ageNode.subgroups.push(subNode)
    }
    subNode.divisions.push(division)
  }

  // Manual bucket last, everything else in first-seen (creation) order.
  ageOrder.sort((a, b) => {
    if (a === MANUAL_BUCKET_KEY) return 1
    if (b === MANUAL_BUCKET_KEY) return -1
    return 0
  })

  for (const node of ageNodes.values()) {
    for (const sub of node.subgroups) {
      sub.divisions.sort((a, b) => {
        if (a.weightLimitKg === null) return 1
        if (b.weightLimitKg === null) return -1
        return a.weightLimitKg - b.weightLimitKg
      })
    }
  }

  return ageOrder.map((key) => ageNodes.get(key)!)
}

// Short label for a division inside its subgroup — just the weight-category
// part (the "template — group —" prefix is already implied by the tree).
export function shortDivisionLabel(division: DivisionLite): string {
  const split = division.sourceTemplateKey ? splitName(division.name) : null
  if (!split) return division.name
  const parts = division.name.split(' — ')
  return parts[2] ?? division.name
}
