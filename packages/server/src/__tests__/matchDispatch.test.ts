import { describe, it, expect } from 'vitest'
import { pickNextMatch, type DispatchCandidate } from '../services/MatchDispatchService.js'

const NOW = new Date('2026-08-01T12:00:00.000Z')
const REST_MS = 10 * 60_000 // 10 minutes, the CBJ default

function candidate(overrides: Partial<DispatchCandidate> & Pick<DispatchCandidate, 'id'>): DispatchCandidate {
  return {
    matchNumber: 1,
    divisionId: 'div-1',
    athleteAId: 'athlete-a',
    athleteBId: 'athlete-b',
    updatedAt: NOW,
    ...overrides,
  }
}

describe('pickNextMatch', () => {
  it('returns null when there are no candidates', () => {
    expect(pickNextMatch([], new Map(), REST_MS, NOW)).toBeNull()
  })

  it('picks the oldest-ready candidate when nobody needs rest', () => {
    const older = candidate({ id: 'm1', updatedAt: new Date(NOW.getTime() - 60_000) })
    const newer = candidate({ id: 'm2', athleteAId: 'athlete-c', athleteBId: 'athlete-d', updatedAt: NOW })
    const picked = pickNextMatch([newer, older], new Map(), REST_MS, NOW)
    expect(picked?.id).toBe('m1')
  })

  it('excludes a candidate whose athlete decided a match less than the rest window ago', () => {
    const lastDecided = new Map([['athlete-a', new Date(NOW.getTime() - 5 * 60_000)]]) // 5 min ago, needs 10
    const blocked = candidate({ id: 'm1' })
    const clear = candidate({ id: 'm2', athleteAId: 'athlete-c', athleteBId: 'athlete-d' })
    const picked = pickNextMatch([blocked, clear], lastDecided, REST_MS, NOW)
    expect(picked?.id).toBe('m2')
  })

  it('includes a candidate once the rest window has fully elapsed', () => {
    const lastDecided = new Map([['athlete-a', new Date(NOW.getTime() - 10 * 60_000)]]) // exactly 10 min ago
    const match = candidate({ id: 'm1' })
    const picked = pickNextMatch([match], lastDecided, REST_MS, NOW)
    expect(picked?.id).toBe('m1')
  })

  it('returns null when every candidate has an athlete still resting', () => {
    const lastDecided = new Map([['athlete-b', new Date(NOW.getTime() - 1_000)]])
    const match = candidate({ id: 'm1' })
    expect(pickNextMatch([match], lastDecided, REST_MS, NOW)).toBeNull()
  })

  it('a rest record for an athlete not in a candidate never blocks that candidate', () => {
    const lastDecided = new Map([['athlete-z', NOW]]) // unrelated athlete, just decided
    const match = candidate({ id: 'm1' })
    expect(pickNextMatch([match], lastDecided, REST_MS, NOW)?.id).toBe('m1')
  })
})
