import { describe, it, expect } from 'vitest'
import {
  decideBootstrapAction,
  filterPeersForReplicaSet,
  excludeSelf,
  computeNeedsArbiter,
  toClusterStatusDTO,
  type DiscoveredPeer,
  type RawMemberStatus,
} from '../cluster/rules.js'

function peer(overrides: Partial<DiscoveredPeer> = {}): DiscoveredPeer {
  return { host: '10.0.0.2:27017', serverPort: 3001, role: 'secondary', replicaSetName: 'sensei-rs', ...overrides }
}

function member(overrides: Partial<RawMemberStatus> = {}): RawMemberStatus {
  return { _id: 0, name: '10.0.0.1:27017', stateStr: 'PRIMARY', health: 1, ...overrides }
}

describe('filterPeersForReplicaSet', () => {
  it('keeps only peers announcing the target replica set name', () => {
    const peers = [
      peer({ host: 'a', replicaSetName: 'sensei-rs' }),
      peer({ host: 'b', replicaSetName: 'other-gym-rs' }),
    ]
    expect(filterPeersForReplicaSet(peers, 'sensei-rs')).toEqual([peers[0]])
  })
})

describe('excludeSelf', () => {
  it('removes a peer whose host matches selfHost (mDNS loopback defense)', () => {
    const peers = [peer({ host: '127.0.0.1:27017' }), peer({ host: '127.0.0.1:27020' })]
    expect(excludeSelf(peers, '127.0.0.1:27017')).toEqual([peers[1]])
  })
})

describe('decideBootstrapAction', () => {
  it('initiates when no peers were discovered', () => {
    expect(decideBootstrapAction([])).toEqual({ action: 'initiate' })
  })

  it('joins the discovered primary when one exists', () => {
    const primary = peer({ role: 'primary' })
    const secondary = peer({ host: 'other', role: 'secondary' })
    expect(decideBootstrapAction([secondary, primary])).toEqual({ action: 'join', primary })
  })

  it('retries when peers exist but none announced as primary (mid-election)', () => {
    const peers = [peer({ role: 'secondary' }), peer({ host: 'b', role: 'secondary' })]
    expect(decideBootstrapAction(peers)).toEqual({ action: 'retry' })
  })
})

describe('computeNeedsArbiter', () => {
  it('is false for a single-node set', () => {
    expect(computeNeedsArbiter([member({ stateStr: 'PRIMARY' })])).toBe(false)
  })

  it('is true for exactly 2 data-bearing members with no arbiter', () => {
    const members = [member({ _id: 0, stateStr: 'PRIMARY' }), member({ _id: 1, stateStr: 'SECONDARY' })]
    expect(computeNeedsArbiter(members)).toBe(true)
  })

  it('stays true even if one of the 2 members currently looks unreachable', () => {
    const members = [
      member({ _id: 0, stateStr: 'PRIMARY' }),
      member({ _id: 1, stateStr: 'SECONDARY', health: 0 }),
    ]
    expect(computeNeedsArbiter(members)).toBe(true)
  })

  it('is false once an arbiter is already present', () => {
    const members = [
      member({ _id: 0, stateStr: 'PRIMARY' }),
      member({ _id: 1, stateStr: 'SECONDARY' }),
      member({ _id: 2, stateStr: 'ARBITER' }),
    ]
    expect(computeNeedsArbiter(members)).toBe(false)
  })

  it('is false for 3+ data-bearing members (majority already survives one loss)', () => {
    const members = [
      member({ _id: 0, stateStr: 'PRIMARY' }),
      member({ _id: 1, stateStr: 'SECONDARY' }),
      member({ _id: 2, stateStr: 'SECONDARY' }),
    ]
    expect(computeNeedsArbiter(members)).toBe(false)
  })
})

describe('toClusterStatusDTO', () => {
  it('maps roles, marks isSelf, and flags needsArbiter/hasArbiter', () => {
    const members = [
      member({ _id: 0, name: '10.0.0.1:27017', stateStr: 'PRIMARY' }),
      member({ _id: 1, name: '10.0.0.2:27017', stateStr: 'SECONDARY' }),
    ]
    const dto = toClusterStatusDTO('sensei-rs', '10.0.0.1:27017', members, Date.now())

    expect(dto.enabled).toBe(true)
    expect(dto.replicaSetName).toBe('sensei-rs')
    expect(dto.nodes).toHaveLength(2)
    expect(dto.nodes.find((n) => n.host === '10.0.0.1:27017')).toMatchObject({ role: 'primary', isSelf: true })
    expect(dto.nodes.find((n) => n.host === '10.0.0.2:27017')).toMatchObject({ role: 'secondary', isSelf: false })
    expect(dto.hasArbiter).toBe(false)
    expect(dto.needsArbiter).toBe(true)
  })

  it('marks an unreachable member as unreachable regardless of stateStr', () => {
    const members = [
      member({ _id: 0, name: 'a', stateStr: 'PRIMARY' }),
      member({ _id: 1, name: 'b', stateStr: 'SECONDARY', health: 0 }),
    ]
    const dto = toClusterStatusDTO('sensei-rs', 'a', members, Date.now())
    expect(dto.nodes.find((n) => n.host === 'b')?.health).toBe('unreachable')
  })

  it('computes replication lag for a secondary and flags it lagging past the threshold', () => {
    const primaryOptimeMs = Date.now()
    const members = [
      member({ _id: 0, name: 'a', stateStr: 'PRIMARY', optimeDate: new Date(primaryOptimeMs).toISOString() }),
      member({
        _id: 1,
        name: 'b',
        stateStr: 'SECONDARY',
        optimeDate: new Date(primaryOptimeMs - 15_000).toISOString(),
      }),
    ]
    const dto = toClusterStatusDTO('sensei-rs', 'a', members, primaryOptimeMs, 10)
    const secondary = dto.nodes.find((n) => n.host === 'b')
    expect(secondary?.replicationLagSeconds).toBe(15)
    expect(secondary?.health).toBe('lagging')
  })

  it('leaves replicationLagSeconds null for the primary and for arbiters', () => {
    const members = [
      member({ _id: 0, name: 'a', stateStr: 'PRIMARY' }),
      member({ _id: 1, name: 'b', stateStr: 'SECONDARY' }),
      member({ _id: 2, name: 'c', stateStr: 'ARBITER' }),
    ]
    const dto = toClusterStatusDTO('sensei-rs', 'a', members, Date.now())
    expect(dto.nodes.find((n) => n.host === 'a')?.replicationLagSeconds).toBeNull()
    expect(dto.nodes.find((n) => n.host === 'c')?.replicationLagSeconds).toBeNull()
  })
})
