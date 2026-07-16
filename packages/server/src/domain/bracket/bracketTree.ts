import type { BracketSize } from './types.js'

// log2(size) — number of rounds in the main bracket (QF+SF+Final = 3 for
// Chave-8, etc).
export function numRounds(size: BracketSize): number {
  return Math.log2(size)
}

// Matches per round r (1-based, 1 = round 1 / "quartas" for Chave-8).
export function matchesInRound(size: BracketSize, round: number): number {
  return size / 2 ** round
}

// The match number (1-based, sequential, unique) of the i-th match
// (0-based) in round r — matches docs/zempo-modelos/chave-eliminacao.md
// "Padrão geral": round r has size/2^r matches, numbering sequential from 1.
export function matchNumberFor(size: BracketSize, round: number, indexInRound: number): number {
  const before = size - size / 2 ** (round - 1)
  return before + indexInRound + 1
}

// Inverse of matchNumberFor, for a "round"-stage match only (bronze/repechage
// matches are numbered after size and aren't part of this scheme).
export function roundAndIndexFor(size: BracketSize, matchNumber: number): { round: number; index: number } {
  let cumulative = 0
  for (let round = 1; round <= numRounds(size); round++) {
    const count = matchesInRound(size, round)
    if (matchNumber <= cumulative + count) {
      return { round, index: matchNumber - cumulative - 1 }
    }
    cumulative += count
  }
  throw new RangeError(`matchNumber ${matchNumber} is out of range for bracket size ${size}`)
}
