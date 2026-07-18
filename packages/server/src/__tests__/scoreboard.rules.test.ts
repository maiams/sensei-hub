import { describe, it, expect } from 'vitest'
import {
  applyScore,
  removeScore,
  osaekomiAward,
  leader,
  endsFight,
  EMPTY_SIDE_SCORE,
  ScoreboardRulesError,
} from '../domain/scoreboard/rules.js'
import { CBJ_DEFAULT_MATCH_RULES } from '@sensei-hub/shared'

describe('scoreboard rules (pure)', () => {
  it('second waza-ari is awasete-ippon, and removing one undoes it', () => {
    const one = applyScore(EMPTY_SIDE_SCORE, 'wazaari')
    expect(one).toMatchObject({ wazaari: 1, ippon: 0 })

    const two = applyScore(one, 'wazaari')
    expect(two).toMatchObject({ wazaari: 2, ippon: 1 })
    expect(() => applyScore(two, 'wazaari')).toThrow(ScoreboardRulesError)

    const undone = removeScore(two, 'wazaari')
    expect(undone).toMatchObject({ wazaari: 1, ippon: 0 })
  })

  it('third shido is hansoku-make, and removing one undoes it', () => {
    let s = EMPTY_SIDE_SCORE
    s = applyScore(s, 'shido')
    s = applyScore(s, 'shido')
    expect(s.hansokuMake).toBe(false)
    s = applyScore(s, 'shido')
    expect(s.hansokuMake).toBe(true)
    expect(() => applyScore(s, 'shido')).toThrow(ScoreboardRulesError)

    s = removeScore(s, 'shido')
    expect(s).toMatchObject({ shido: 2, hansokuMake: false })
  })

  it('removing a score that does not exist throws', () => {
    expect(() => removeScore(EMPTY_SIDE_SCORE, 'yuko')).toThrow(ScoreboardRulesError)
    expect(() => removeScore(EMPTY_SIDE_SCORE, 'ippon')).toThrow(ScoreboardRulesError)
  })

  it('osaekomi converts by held time against the division thresholds (CBJ: 5/10/20)', () => {
    const r = CBJ_DEFAULT_MATCH_RULES
    expect(osaekomiAward(4, r, 'regular')).toBeNull()
    expect(osaekomiAward(5, r, 'regular')).toBe('yuko')
    expect(osaekomiAward(9, r, 'regular')).toBe('yuko')
    expect(osaekomiAward(10, r, 'regular')).toBe('wazaari')
    expect(osaekomiAward(19, r, 'regular')).toBe('wazaari')
    expect(osaekomiAward(20, r, 'regular')).toBe('ippon')
  })

  it('in golden score the osaekomi award is capped at yuko (RNC 2025)', () => {
    const r = CBJ_DEFAULT_MATCH_RULES
    expect(osaekomiAward(4, r, 'golden_score')).toBeNull()
    expect(osaekomiAward(25, r, 'golden_score')).toBe('yuko')
  })

  it('leader ranks ippon > waza-ari > yuko and ignores shido counts (except hansoku-make)', () => {
    const a1 = applyScore(EMPTY_SIDE_SCORE, 'yuko')
    expect(leader(a1, EMPTY_SIDE_SCORE)).toEqual({ side: 'A', method: 'yuko' })

    const b1 = applyScore(EMPTY_SIDE_SCORE, 'wazaari')
    expect(leader(a1, b1)).toEqual({ side: 'B', method: 'wazaari' })

    // shido alone never decides the board
    const twoShidos = applyScore(applyScore(EMPTY_SIDE_SCORE, 'shido'), 'shido')
    expect(leader(twoShidos, EMPTY_SIDE_SCORE)).toBeNull()

    const hansoku = applyScore(twoShidos, 'shido')
    expect(leader(hansoku, EMPTY_SIDE_SCORE)).toEqual({ side: 'B', method: 'hansoku-make' })
  })

  it('golden score ends at the first score, but not at a lone shido', () => {
    expect(endsFight(EMPTY_SIDE_SCORE, EMPTY_SIDE_SCORE, 'golden_score')).toBe(false)

    const yuko = applyScore(EMPTY_SIDE_SCORE, 'yuko')
    expect(endsFight(yuko, EMPTY_SIDE_SCORE, 'golden_score')).toBe(true)
    expect(endsFight(yuko, EMPTY_SIDE_SCORE, 'regular')).toBe(false)

    const shido = applyScore(EMPTY_SIDE_SCORE, 'shido')
    expect(endsFight(shido, EMPTY_SIDE_SCORE, 'golden_score')).toBe(false)
  })
})
