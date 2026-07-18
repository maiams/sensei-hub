import type { MatchRules, ScoreType, SideScore, ScoreboardPhase } from '@sensei-hub/shared'

// Pure judo scoring rules (no I/O, no Mongoose) — same guarantee as
// domain/bracket. Rules per CBJ RNC 2025: ippon ends the fight; a 2nd
// waza-ari is awasete-ippon; the 3rd shido is hansoku-make (opponent wins);
// osaekomi converts to yuko/waza-ari/ippon by held seconds against the
// division's thresholds; in golden score the first score decides and an
// osaekomi ends at yuko.

export const EMPTY_SIDE_SCORE: SideScore = { ippon: 0, wazaari: 0, yuko: 0, shido: 0, hansokuMake: false }

export class ScoreboardRulesError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ScoreboardRulesError'
  }
}

export function applyScore(side: SideScore, type: ScoreType): SideScore {
  const next = { ...side }
  switch (type) {
    case 'ippon':
      if (next.ippon >= 1) throw new ScoreboardRulesError('Ippon already scored')
      next.ippon = 1
      break
    case 'wazaari':
      if (next.wazaari >= 2) throw new ScoreboardRulesError('Two waza-ari already scored')
      next.wazaari += 1
      if (next.wazaari === 2) next.ippon = 1 // awasete-ippon
      break
    case 'yuko':
      next.yuko += 1
      break
    case 'shido':
      if (next.shido >= 3) throw new ScoreboardRulesError('Three shido already given')
      next.shido += 1
      if (next.shido === 3) next.hansokuMake = true
      break
  }
  return next
}

export function removeScore(side: SideScore, type: ScoreType): SideScore {
  const next = { ...side }
  switch (type) {
    case 'ippon':
      if (next.ippon < 1) throw new ScoreboardRulesError('No ippon to remove')
      next.ippon = 0
      break
    case 'wazaari':
      if (next.wazaari < 1) throw new ScoreboardRulesError('No waza-ari to remove')
      if (next.wazaari === 2) next.ippon = 0 // undo awasete-ippon
      next.wazaari -= 1
      break
    case 'yuko':
      if (next.yuko < 1) throw new ScoreboardRulesError('No yuko to remove')
      next.yuko -= 1
      break
    case 'shido':
      if (next.shido < 1) throw new ScoreboardRulesError('No shido to remove')
      if (next.shido === 3) next.hansokuMake = false
      next.shido -= 1
      break
  }
  return next
}

// What an osaekomi held for `elapsedSeconds` is worth. In golden score the
// fight is over at yuko (RNC 2025: "no caso de osaekomi, o combate terminará
// no Yuko"), so the award is capped there.
export function osaekomiAward(elapsedSeconds: number, rules: MatchRules, phase: ScoreboardPhase): ScoreType | null {
  if (phase === 'golden_score') {
    return elapsedSeconds >= rules.osaekomiYukoSeconds ? 'yuko' : null
  }
  if (elapsedSeconds >= rules.osaekomiIpponSeconds) return 'ippon'
  if (elapsedSeconds >= rules.osaekomiWazaariSeconds) return 'wazaari'
  if (elapsedSeconds >= rules.osaekomiYukoSeconds) return 'yuko'
  return null
}

// Who currently leads on the board, and by what. Returns null on a genuine
// tie — the operator decides what happens next (golden score, or a manual
// 'decisao' when the division has golden score disabled).
export function leader(a: SideScore, b: SideScore): { side: 'A' | 'B'; method: string } | null {
  if (a.hansokuMake !== b.hansokuMake) {
    return { side: a.hansokuMake ? 'B' : 'A', method: 'hansoku-make' }
  }
  if (a.ippon !== b.ippon) return { side: a.ippon > b.ippon ? 'A' : 'B', method: 'ippon' }
  if (a.wazaari !== b.wazaari) return { side: a.wazaari > b.wazaari ? 'A' : 'B', method: 'wazaari' }
  if (a.yuko !== b.yuko) return { side: a.yuko > b.yuko ? 'A' : 'B', method: 'yuko' }
  return null
}

// A score that immediately ends the fight regardless of the clock.
export function endsFight(a: SideScore, b: SideScore, phase: ScoreboardPhase): boolean {
  if (a.ippon === 1 || b.ippon === 1) return true
  if (a.hansokuMake || b.hansokuMake) return true
  if (phase === 'golden_score') return leader(a, b) !== null // first score (or shido difference) decides
  return false
}
