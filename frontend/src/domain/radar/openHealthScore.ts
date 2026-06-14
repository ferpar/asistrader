import type {
  SmaStructure,
  PriceChanges,
  LinearRegressionResult,
  RsiIndicator,
} from './types'
import type { TradeEtaCell } from './tradeEta'
import {
  driftRaw,
  momentumRaw,
  smaRaw,
  lr20Raw,
  rsiRaw,
  type FavorSign,
} from './trendSignals'
import type {
  ConvergenceComponent,
  ConvergenceConfidence,
  ConvergenceKey,
} from './convergenceScore'

/**
 * "Health" of an open position: is price trending toward the take-profit (good,
 * positive) or toward the stop-loss (bad, negative)? It reuses the convergence
 * trend primitives but anchors on the trade direction (toward TP is favourable)
 * and switches the drift target by segment — the TP ETA while in profit, the
 * SL ETA while in loss — so the urgency that matters in each segment drives it.
 */
export interface OpenHealthScore {
  /** Signed composite, clipped to [-100, +100]. Positive = heading to TP, negative = to SL. */
  score: number
  confidence: ConvergenceConfidence
  components: ConvergenceComponent[]
}

export interface OpenHealthInputs {
  /** Which rail the price sits on now — selects the drift target. */
  segment: 'profit' | 'loss' | 'flat'
  isLong: boolean
  tpEta: TradeEtaCell | null
  slEta: TradeEtaCell | null
  priceChanges: PriceChanges | null
  sma: SmaStructure | null
  lr20: LinearRegressionResult | null
  rsi: RsiIndicator | null
}

const WEIGHTS: Record<ConvergenceKey, number> = {
  drift: 30,
  momentum: 25,
  sma: 20,
  lr20: 15,
  rsi: 10,
}

const LABELS: Record<ConvergenceKey, string> = {
  drift: 'Drift vs target',
  momentum: '5d momentum',
  sma: 'SMA stack vs target',
  lr20: 'LR20 slope vs target',
  rsi: 'RSI divergence',
}

function clip(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n))
}

/** Drift toward the segment's relevant target: TP in profit (ahead = good),
 *  SL in loss (ahead = bad — reaching the stop sooner). */
function driftComponent(inputs: OpenHealthInputs): { raw: number | null; note: string } {
  const towardSl = inputs.segment === 'loss'
  const eta = towardSl ? inputs.slEta : inputs.tpEta
  const base = driftRaw(eta)
  if (base === null) return { raw: null, note: 'no data' }
  // In the loss segment "ahead" means hitting the stop sooner, so invert.
  const raw = towardSl ? -base : base
  const target = towardSl ? 'SL' : 'TP'
  const note =
    raw > 0 ? `drifting away from ${target}` : raw < 0 ? `drifting toward ${target}` : 'on pace'
  return { raw, note }
}

function momentumComponent(
  favor: FavorSign,
  priceChanges: PriceChanges | null,
): { raw: number | null; note: string } {
  if (!priceChanges || priceChanges.avgChangePct5d === null) return { raw: null, note: 'no data' }
  const raw = momentumRaw(favor, priceChanges.avgChangePct5d)
  const pct = (priceChanges.avgChangePct5d * 100).toFixed(2)
  const dir = raw >= 0 ? 'toward TP' : 'toward SL'
  return { raw, note: `5d avg ${pct}%/d (${dir})` }
}

function smaComponent(
  favor: FavorSign,
  sma: SmaStructure | null,
): { raw: number | null; note: string } {
  if (!sma || sma.bullishScore === null) return { raw: null, note: 'no data' }
  const raw = smaRaw(favor, sma.bullishScore)
  const trend = sma.bullishScore >= 7 ? 'bullish' : sma.bullishScore <= 3 ? 'bearish' : 'mixed'
  const verdict = raw > 0 ? 'favours TP' : raw < 0 ? 'favours SL' : 'mixed'
  return { raw, note: `${trend} ${sma.bullishScore}/10 (${verdict})` }
}

function lr20Component(
  favor: FavorSign,
  lr20: LinearRegressionResult | null,
): { raw: number | null; note: string } {
  if (!lr20 || lr20.slopePct === null) return { raw: null, note: 'no data' }
  const raw = lr20Raw(favor, lr20.slopePct)
  const pct = (lr20.slopePct * 100).toFixed(2)
  return { raw, note: `slope ${pct}%/bar` }
}

function rsiComponent(
  favor: FavorSign,
  rsi: RsiIndicator | null,
): { raw: number | null; note: string } {
  if (!rsi) return { raw: null, note: 'no data' }
  const bear = rsi.divergence.bearish
  const bull = rsi.divergence.bullish
  if (!bear && !bull) return { raw: 0, note: 'no divergence' }
  const raw = rsiRaw(favor, bull?.strength ?? null, bear?.strength ?? null)
  const parts: string[] = []
  if (bear) parts.push(`${bear.strength} bearish`)
  if (bull) parts.push(`${bull.strength} bullish`)
  return { raw, note: parts.join(' + ') || 'no divergence' }
}

export function computeOpenHealthScore(inputs: OpenHealthInputs): OpenHealthScore | null {
  // Favourable price direction is toward TP: up for a long, down for a short.
  const favor: FavorSign = inputs.isLong ? 1 : -1

  const parts: { key: ConvergenceKey; raw: number | null; note: string }[] = [
    { key: 'drift', ...driftComponent(inputs) },
    { key: 'momentum', ...momentumComponent(favor, inputs.priceChanges) },
    { key: 'sma', ...smaComponent(favor, inputs.sma) },
    { key: 'lr20', ...lr20Component(favor, inputs.lr20) },
    { key: 'rsi', ...rsiComponent(favor, inputs.rsi) },
  ]

  // If no component carries any signal, the score is meaningless.
  if (!parts.some((p) => p.raw !== null)) return null

  const components: ConvergenceComponent[] = parts.map((p) => ({
    key: p.key,
    label: LABELS[p.key],
    weight: WEIGHTS[p.key],
    raw: p.raw,
    contribution: p.raw === null ? 0 : p.raw * WEIGHTS[p.key],
    note: p.note,
  }))

  const score = clip(
    components.reduce((sum, c) => sum + c.contribution, 0),
    -100,
    100,
  )

  const driftAvailable = parts[0].raw !== null
  const supportingAvailable = parts.slice(1).filter((p) => p.raw !== null).length
  const confidence: ConvergenceConfidence =
    driftAvailable && supportingAvailable >= 3
      ? 'high'
      : driftAvailable || supportingAvailable >= 2
        ? 'partial'
        : 'low'

  return { score, confidence, components }
}
