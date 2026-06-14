import type { TradeEtaCell } from './tradeEta'
import type { DivergenceStrength } from './types'

/**
 * Shared, sign-only trend primitives behind both the (plan/ordered) convergence
 * score and the (open) health score. Each returns a normalised value in
 * [-1, +1]; the consumer multiplies by its weight and supplies the human note.
 *
 * `favor` is the direction that counts as *good* for the thing being scored:
 *   +1 → rising price is favourable, −1 → falling is favourable, 0 → unknown.
 * Convergence passes the fill direction toward PE; open health passes the trade
 * direction toward TP. Because the formulas are identical once `favor` is fixed,
 * the same primitives serve both.
 */
export type FavorSign = -1 | 0 | 1

// A 1%/day 5d momentum compresses to tanh(1) ≈ 0.76; calibrated for typical equities.
export const MOMENTUM_SCALE = 0.01
// A 0.5%/bar LR20 slope is a strong trend; produces tanh(1).
export const LR20_SCALE = 0.005

const DIV_STRENGTH: Record<DivergenceStrength, number> = {
  weak: 0.4,
  moderate: 0.7,
  strong: 1.0,
}

/**
 * Base drift signal from an ETA cell, before any target-specific sign:
 *   +1 ahead of baseline, −1 behind or receding, 0 on-pace/fresh, null no data.
 */
export function driftRaw(eta: TradeEtaCell | null): number | null {
  if (!eta) return null
  if (eta.projectedState === 'fresh') return 0
  if (eta.projectedState === 'none') return null
  if (eta.projectedState === 'receding') return -1
  const drift = eta.drift
  if (!drift) return null
  if (drift.state === 'ahead') return 1
  if (drift.state === 'behind') return -1
  return 0
}

export function momentumRaw(favor: FavorSign, avgChangePct5d: number): number {
  return favor * Math.tanh(avgChangePct5d / MOMENTUM_SCALE)
}

/** bullishScore is 0..10; normalised around 5 → bullishness in [-1, +1]. */
export function smaRaw(favor: FavorSign, bullishScore: number): number {
  return (favor * (bullishScore - 5)) / 5
}

export function lr20Raw(favor: FavorSign, slopePct: number): number {
  return favor * Math.tanh(slopePct / LR20_SCALE)
}

export function rsiRaw(
  favor: FavorSign,
  bullStrength: DivergenceStrength | null,
  bearStrength: DivergenceStrength | null,
): number {
  const bullWeight = bullStrength ? DIV_STRENGTH[bullStrength] : 0
  const bearWeight = bearStrength ? DIV_STRENGTH[bearStrength] : 0
  return favor * (bullWeight - bearWeight)
}
