// Hardware integration boundary for a weigh-in scale (CLAUDE.md — Weigh-In
// Integration: "Integration must be isolated behind an adapter/service
// layer. Do not hardcode a single hardware vendor into the domain model.").
// A reading from here is never written directly as an official WeightRecord
// — the operator always confirms it first (see WeightService.recordWeight,
// called from EventEntryService.recordWeighIn / the athlete profile flow).
// If the adapter is disconnected or throws, the caller must fall back to
// manual entry — hardware failure must never block the weigh-in station.
export interface ScaleReading {
  weightKg: number
  timestamp: Date
}

export interface ScaleAdapter {
  getLatestReading(): Promise<ScaleReading | null>
  isConnected(): boolean
}

// No physical scale is wired up yet — this is the default adapter until a
// real vendor integration exists, and the one used in tests. Deterministic
// weight bounces slightly by athlete id so the "Ler da balança" affordance
// looks alive in local dev without ever exercising real hardware code.
export class MockScaleAdapter implements ScaleAdapter {
  #connected: boolean

  constructor(connected = true) {
    this.#connected = connected
  }

  isConnected(): boolean {
    return this.#connected
  }

  async getLatestReading(): Promise<ScaleReading | null> {
    if (!this.#connected) return null
    const jitter = Math.round((Math.sin(Date.now() / 5000) + 1) * 250) / 100 // 0.00–5.00, smooth over time
    return { weightKg: Math.round((60 + jitter) * 100) / 100, timestamp: new Date() }
  }
}

// Single shared instance for the process — mirrors how a real serial/USB
// scale driver would be a singleton bound to one physical port. Swap this
// line (or make it env-driven) when a real vendor adapter is implemented;
// nothing else in the codebase should need to change (that's the point of
// the interface boundary).
export const scaleAdapter: ScaleAdapter = new MockScaleAdapter(true)
