import { describe, it, expect } from 'vitest'
import {
  roleFromVotes,
  mongoStateOf,
  planDeclareBackup,
  planPromotion,
  decidePromotionSafety,
  isStationOnline,
  buildClusterStatus,
  type RawReplicaSetConfig,
  type RawStatusMember,
} from '../cluster/rules.js'

function config(overrides: Partial<RawReplicaSetConfig> = {}): RawReplicaSetConfig {
  return {
    _id: 'sensei-rs',
    version: 1,
    members: [{ _id: 0, host: '10.0.0.1:27017', votes: 1, priority: 1 }],
    ...overrides,
  }
}

function statusMember(overrides: Partial<RawStatusMember> = {}): RawStatusMember {
  return { name: '10.0.0.1:27017', stateStr: 'PRIMARY', health: 1, ...overrides }
}

describe('roleFromVotes', () => {
  it('treats any positive vote count as master', () => {
    expect(roleFromVotes(1)).toBe('master')
  })
  it('treats zero votes as backup', () => {
    expect(roleFromVotes(0)).toBe('backup')
  })
})

describe('mongoStateOf', () => {
  it('reports unreachable when health is 0, regardless of stateStr', () => {
    expect(mongoStateOf({ name: 'a', stateStr: 'SECONDARY', health: 0 })).toBe('unreachable')
  })
  it('passes through a known stateStr', () => {
    expect(mongoStateOf({ name: 'a', stateStr: 'PRIMARY', health: 1 })).toBe('PRIMARY')
  })
  it('falls back to unknown for an unrecognized stateStr', () => {
    expect(mongoStateOf({ name: 'a', stateStr: 'ARBITER', health: 1 })).toBe('unknown')
  })
})

describe('planDeclareBackup', () => {
  it('adds the new host as a non-voting, no-priority member with the next _id', () => {
    const plan = planDeclareBackup(config(), '10.0.0.2:27017')
    expect(plan.action).toBe('reconfig')
    if (plan.action !== 'reconfig') throw new Error('unreachable')
    expect(plan.config.version).toBe(2)
    expect(plan.config.members).toHaveLength(2)
    expect(plan.config.members[1]).toEqual({ _id: 1, host: '10.0.0.2:27017', votes: 0, priority: 0 })
    // existing member untouched
    expect(plan.config.members[0]).toEqual({ _id: 0, host: '10.0.0.1:27017', votes: 1, priority: 1 })
  })

  it('is a no-op when the host is already a member', () => {
    const cfg = config({ members: [{ _id: 0, host: '10.0.0.1:27017', votes: 1, priority: 1 }, { _id: 1, host: '10.0.0.2:27017', votes: 0, priority: 0 }] })
    const plan = planDeclareBackup(cfg, '10.0.0.2:27017')
    expect(plan.action).toBe('noop')
  })

  it('picks the next _id as max+1, not members.length, to survive gaps left by prior reconfigs', () => {
    const cfg = config({ members: [{ _id: 0, host: 'a', votes: 1, priority: 1 }, { _id: 5, host: 'b', votes: 0, priority: 0 }] })
    const plan = planDeclareBackup(cfg, 'c')
    if (plan.action !== 'reconfig') throw new Error('unreachable')
    expect(plan.config.members[2]?._id).toBe(6)
  })
})

describe('planPromotion', () => {
  it('makes self the sole voter and demotes every other member', () => {
    const cfg = config({
      members: [
        { _id: 0, host: 'master:27017', votes: 1, priority: 1 },
        { _id: 1, host: 'backup:27017', votes: 0, priority: 0 },
      ],
    })
    const plan = planPromotion(cfg, 'backup:27017')
    expect(plan.action).toBe('reconfig')
    if (plan.action !== 'reconfig') throw new Error('unreachable')
    expect(plan.config.version).toBe(2)
    expect(plan.config.members).toEqual([
      { _id: 0, host: 'master:27017', votes: 0, priority: 0 },
      { _id: 1, host: 'backup:27017', votes: 1, priority: 1 },
    ])
  })

  it('errors when self is not a member of the set', () => {
    const plan = planPromotion(config(), 'ghost:27017')
    expect(plan.action).toBe('error')
  })

  it('errors when self is already the voting master', () => {
    const plan = planPromotion(config(), '10.0.0.1:27017')
    expect(plan.action).toBe('error')
  })

  it('does not remove the demoted former master from the config', () => {
    const cfg = config({
      members: [
        { _id: 0, host: 'master:27017', votes: 1, priority: 1 },
        { _id: 1, host: 'backup:27017', votes: 0, priority: 0 },
      ],
    })
    const plan = planPromotion(cfg, 'backup:27017')
    if (plan.action !== 'reconfig') throw new Error('unreachable')
    expect(plan.config.members.map((m) => m.host)).toContain('master:27017')
  })
})

describe('decidePromotionSafety', () => {
  it('allows promotion when the old master is unreachable', () => {
    expect(decidePromotionSafety({ oldMasterReachableAndPrimary: false, acknowledgeSplitBrainRisk: false })).toEqual({
      allowed: true,
    })
  })

  it('refuses promotion when the old master is still alive and primary', () => {
    const result = decidePromotionSafety({ oldMasterReachableAndPrimary: true, acknowledgeSplitBrainRisk: false })
    expect(result.allowed).toBe(false)
    expect(result.reason).toMatch(/split-brain/i)
  })

  it('allows promotion despite a reachable old master when the risk is explicitly acknowledged', () => {
    expect(decidePromotionSafety({ oldMasterReachableAndPrimary: true, acknowledgeSplitBrainRisk: true })).toEqual({
      allowed: true,
    })
  })
})

describe('isStationOnline', () => {
  const now = Date.parse('2026-01-01T12:00:00.000Z')
  it('is online within the threshold', () => {
    expect(isStationOnline(new Date(now - 10_000).toISOString(), now)).toBe(true)
  })
  it('is offline past the threshold', () => {
    expect(isStationOnline(new Date(now - 40_000).toISOString(), now)).toBe(false)
  })
})

describe('buildClusterStatus', () => {
  it('assembles master/backup nodes, self role, and lag', () => {
    const now = Date.now()
    const dto = buildClusterStatus({
      replicaSetName: 'sensei-rs',
      selfHost: '10.0.0.1:27017',
      configMembers: [
        { _id: 0, host: '10.0.0.1:27017', votes: 1, priority: 1 },
        { _id: 1, host: '10.0.0.2:27017', votes: 0, priority: 0 },
      ],
      statusMembers: [
        statusMember({ name: '10.0.0.1:27017', stateStr: 'PRIMARY', optimeDate: new Date(now).toISOString() }),
        statusMember({ name: '10.0.0.2:27017', stateStr: 'SECONDARY', optimeDate: new Date(now - 5000).toISOString() }),
      ],
      stations: [{ stationId: 's1', lastSeenAt: new Date(now - 1000).toISOString() }],
      nowMs: now,
    })

    expect(dto.enabled).toBe(true)
    expect(dto.selfRole).toBe('master')
    expect(dto.master).toMatchObject({ host: '10.0.0.1:27017', role: 'master', isSelf: true, mongoState: 'PRIMARY' })
    expect(dto.backup).toMatchObject({ host: '10.0.0.2:27017', role: 'backup', isSelf: false, mongoState: 'SECONDARY' })
    expect(dto.backup?.replicationLagSeconds).toBe(5)
    expect(dto.stations).toEqual([{ stationId: 's1', lastSeenAt: expect.any(String), online: true }])
  })

  it('has no backup yet when only the master is a member', () => {
    const now = Date.now()
    const dto = buildClusterStatus({
      replicaSetName: 'sensei-rs',
      selfHost: '10.0.0.1:27017',
      configMembers: [{ _id: 0, host: '10.0.0.1:27017', votes: 1, priority: 1 }],
      statusMembers: [statusMember()],
      stations: [],
      nowMs: now,
    })
    expect(dto.master).not.toBeNull()
    expect(dto.backup).toBeNull()
  })

  it('marks an unreachable backup instead of computing a stale lag', () => {
    const now = Date.now()
    const dto = buildClusterStatus({
      replicaSetName: 'sensei-rs',
      selfHost: '10.0.0.1:27017',
      configMembers: [
        { _id: 0, host: '10.0.0.1:27017', votes: 1, priority: 1 },
        { _id: 1, host: '10.0.0.2:27017', votes: 0, priority: 0 },
      ],
      statusMembers: [statusMember(), statusMember({ name: '10.0.0.2:27017', stateStr: 'SECONDARY', health: 0 })],
      stations: [],
      nowMs: now,
    })
    expect(dto.backup?.mongoState).toBe('unreachable')
    expect(dto.backup?.replicationLagSeconds).toBeNull()
  })
})
