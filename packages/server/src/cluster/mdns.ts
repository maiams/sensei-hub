// Thin, focused wrapper around `multicast-dns` for the two things Fase 7
// needs: (1) announce/discover this node's `_senseihub._tcp.local` service
// so nodes can find each other and know who's currently primary, and
// (2) let the current primary answer `senseihub.local` A-record queries so
// tablets/phones (and the QR code from Fase 6) can reach "whichever machine
// is primary right now" without knowing its IP.
//
// Deliberate simplification: this is a closed protocol between sensei-hub
// nodes only, not a spec-perfect DNS-SD implementation for interop with
// generic Bonjour browsers — the TXT record carries a single JSON payload
// instead of standard key=value segments, and there's no separate SRV/A
// lookup step (the payload already includes the peer's mongod host:port).
// That's a deliberate trade-off for less code, not an oversight.

import createMdns, { type MulticastDNS, type QueryPacket, type ResponsePacket } from 'multicast-dns'
import type { ClusterNodeRole } from '@sensei-hub/shared'
import type { DiscoveredPeer } from './rules.js'

const SERVICE_TYPE = '_senseihub._tcp.local'
const PRIMARY_ALIAS = 'senseihub.local'

export interface ClusterAnnouncement {
  mongoHost: string // this node's own mongod "ip:port"
  serverPort: number
  role: ClusterNodeRole
  replicaSetName: string
}

interface TxtPayload {
  mongoHost: string
  serverPort: number
  role: ClusterNodeRole
  replicaSetName: string
}

export class MdnsCluster {
  #mdns: MulticastDNS
  #instanceName: string
  #announcement: ClusterAnnouncement | null = null
  #primaryAliasIp: string | null = null

  constructor() {
    // loopback:false — multicast-dns defaults to also delivering a
    // process's own outgoing packets back to itself. Without this, a node
    // discovers ITSELF while bootstrapping (its own provisional
    // role:'secondary' announcement, set before the discovery round even
    // starts) and treats it as a real peer with no primary, always
    // tripping the 'retry' branch. Each node has its own socket, so this
    // has no effect on discovering genuinely different peers.
    this.#mdns = createMdns({ loopback: false })
    this.#instanceName = `senseihub-${crypto.randomUUID()}.${SERVICE_TYPE}`
    this.#mdns.on('query', (query, rinfo) => this.#handleQuery(query, rinfo))
  }

  // Called once at startup and again on every role change (e.g. this node
  // becomes primary after an election) — the next query response reflects
  // the new state immediately, no restart needed.
  setAnnouncement(announcement: ClusterAnnouncement | null): void {
    this.#announcement = announcement
  }

  // Only the current primary should set this (to its own LAN IP) — see
  // ClusterManager, which toggles it on every role change.
  setPrimaryAlias(ip: string | null): void {
    this.#primaryAliasIp = ip
  }

  // Sends one PTR query for `_senseihub._tcp.local` and collects TXT
  // answers for `timeoutMs`. Filtering by replicaSetName is the caller's
  // job (see rules.ts filterPeersForReplicaSet) — this only decodes what
  // was heard on the wire.
  async discover(timeoutMs: number): Promise<DiscoveredPeer[]> {
    const found = new Map<string, DiscoveredPeer>() // keyed by mongoHost, de-dupes repeat responses

    const onResponse = (packet: ResponsePacket) => {
      // The responder puts the PTR in `answers` and the TXT payload in
      // `additionals` (see #handleQuery) — both need scanning here, that's
      // the whole point of using additionals instead of a second query.
      const records = [...(packet.answers ?? []), ...(packet.additionals ?? [])]
      for (const answer of records) {
        if (answer.type !== 'TXT' || !answer.name.endsWith(SERVICE_TYPE)) continue
        const parsed = decodeTxt(answer.data)
        if (!parsed) continue
        found.set(parsed.mongoHost, {
          host: parsed.mongoHost,
          serverPort: parsed.serverPort,
          role: parsed.role,
          replicaSetName: parsed.replicaSetName,
        })
      }
    }

    this.#mdns.on('response', onResponse)
    this.#mdns.query({ questions: [{ name: SERVICE_TYPE, type: 'PTR' }] })
    await sleep(timeoutMs)
    this.#mdns.off('response', onResponse)

    return [...found.values()]
  }

  destroy(): void {
    this.#mdns.destroy()
  }

  #handleQuery(query: QueryPacket, _rinfo: unknown): void {
    for (const q of query.questions ?? []) {
      if (q.type === 'PTR' && q.name === SERVICE_TYPE && this.#announcement) {
        const payload: TxtPayload = {
          mongoHost: this.#announcement.mongoHost,
          serverPort: this.#announcement.serverPort,
          role: this.#announcement.role,
          replicaSetName: this.#announcement.replicaSetName,
        }
        this.#mdns.respond({
          answers: [{ type: 'PTR', name: SERVICE_TYPE, data: this.#instanceName, ttl: 120 }],
          additionals: [{ type: 'TXT', name: this.#instanceName, data: JSON.stringify(payload), ttl: 120 }],
        })
      }

      if (q.type === 'A' && q.name === PRIMARY_ALIAS && this.#primaryAliasIp) {
        this.#mdns.respond({
          answers: [{ type: 'A', name: PRIMARY_ALIAS, data: this.#primaryAliasIp, ttl: 30 }],
        })
      }
    }
  }
}

function decodeTxt(data: unknown): TxtPayload | null {
  try {
    const buffers = Array.isArray(data) ? data : [data]
    const text = Buffer.isBuffer(buffers[0]) ? buffers[0].toString('utf8') : String(buffers[0])
    const parsed = JSON.parse(text) as Partial<TxtPayload>
    if (
      typeof parsed.mongoHost === 'string' &&
      typeof parsed.serverPort === 'number' &&
      typeof parsed.role === 'string' &&
      typeof parsed.replicaSetName === 'string'
    ) {
      return parsed as TxtPayload
    }
    return null
  } catch {
    return null
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
