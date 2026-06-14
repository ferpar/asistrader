import type {
  SmaStructure,
  PriceChanges,
  LinearRegressionResult,
  RsiIndicator,
} from './types'
import type { TradeEtaCell } from './tradeEta'
import { momentumRaw, smaRaw, lr20Raw, rsiRaw, type FavorSign } from './trendSignals'

export type ConvergenceKey = 'drift' | 'momentum' | 'sma' | 'lr20' | 'rsi'

export interface ConvergenceComponent {
  key: ConvergenceKey
  label: string
  /** Max absolute contribution this component can make to the final score. */
  weight: number
  /** Normalised value in [-1, +1], or null when inputs were missing. */
  raw: number | null
  /** Signed contribution to the composite score, weight * raw (0 when raw is null). */
  contribution: number
  /** Short human-readable note for the tooltip — e.g. "behind" or "no data". */
  note: string
}

export type ConvergenceConfidence = 'high' | 'partial' | 'low'

export interface ConvergenceScore {
  /** Signed composite, clipped to [-100, +100]. Positive = converging on PE with trade direction. */
  score: number
  confidence: ConvergenceConfidence
  components: ConvergenceComponent[]
}

export interface ConvergenceInputs {
  /** Signed (current - PE) / PE. Null when no live price.
   *  Sign drives the "fill direction": > 0 → price must fall to reach PE,
   *  < 0 → price must rise. This is independent of long/short.
   */
  positionPct: number | null
  /** Radar ETA cell for the PE target. Null when not computable. */
  peEta: TradeEtaCell | null
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
  drift: 'Drift vs PE',
  momentum: '5d momentum',
  sma: 'SMA stack vs fill',
  lr20: 'LR20 slope vs fill',
  rsi: 'RSI divergence',
}

/** Direction that favours filling toward PE: +1 = rising favourable (price below
 *  PE), −1 = falling favourable (price above PE), 0 = unknown (null/at PE). */
function fillFavor(positionPct: number | null): FavorSign {
  if (positionPct === null || positionPct === 0) return 0
  return positionPct > 0 ? -1 : 1
}

function driftComponent(peEta: TradeEtaCell | null): { raw: number | null; note: string } {
  if (!peEta) return { raw: null, note: 'no data' }
  if (peEta.projectedState === 'fresh') return { raw: 0, note: 'new — no baseline yet' }
  if (peEta.projectedState === 'none') return { raw: null, note: 'no projection' }
  if (peEta.projectedState === 'receding') return { raw: -1, note: 'baseline trend moved away from PE' }
  const drift = peEta.drift
  if (!drift) return { raw: null, note: 'no drift data' }
  if (drift.state === 'ahead') return { raw: 1, note: 'ahead of baseline ETA' }
  if (drift.state === 'behind') return { raw: -1, note: 'behind baseline ETA' }
  return { raw: 0, note: 'on pace' }
}

function momentumComponent(
  positionPct: number | null,
  priceChanges: PriceChanges | null,
): { raw: number | null; note: string } {
  if (positionPct === null || !priceChanges || priceChanges.avgChangePct5d === null) {
    return { raw: null, note: 'no data' }
  }
  // When positionPct is ~0 the fill direction is ambiguous; treat as neutral.
  if (positionPct === 0) return { raw: 0, note: 'already at PE' }
  const raw = momentumRaw(fillFavor(positionPct), priceChanges.avgChangePct5d)
  const pct = (priceChanges.avgChangePct5d * 100).toFixed(2)
  const dir = raw >= 0 ? 'toward PE' : 'away from PE'
  return { raw, note: `5d avg ${pct}%/d (${dir})` }
}

function smaComponent(
  positionPct: number | null,
  sma: SmaStructure | null,
): { raw: number | null; note: string } {
  if (!sma || sma.bullishScore === null) return { raw: null, note: 'no data' }
  const favor = fillFavor(positionPct)
  if (favor === 0) return { raw: null, note: 'fill direction unknown' }
  // When price is above PE (must fall), a bearish trend favours filling; when
  // below PE (must rise), a bullish trend favours filling.
  const raw = smaRaw(favor, sma.bullishScore)
  const trend =
    sma.bullishScore >= 7 ? 'bullish' : sma.bullishScore <= 3 ? 'bearish' : 'mixed'
  const verdict = raw > 0 ? 'favours fill' : raw < 0 ? 'pushes away' : 'mixed'
  return { raw, note: `${trend} ${sma.bullishScore}/10 (${verdict})` }
}

function lr20Component(
  positionPct: number | null,
  lr20: LinearRegressionResult | null,
): { raw: number | null; note: string } {
  if (!lr20 || lr20.slopePct === null) return { raw: null, note: 'no data' }
  const favor = fillFavor(positionPct)
  if (favor === 0) return { raw: null, note: 'fill direction unknown' }
  const raw = lr20Raw(favor, lr20.slopePct)
  const pct = (lr20.slopePct * 100).toFixed(2)
  return { raw, note: `slope ${pct}%/bar` }
}

function rsiComponent(
  positionPct: number | null,
  rsi: RsiIndicator | null,
): { raw: number | null; note: string } {
  if (!rsi) return { raw: null, note: 'no data' }
  const favor = fillFavor(positionPct)
  if (favor === 0) return { raw: null, note: 'fill direction unknown' }
  const bear = rsi.divergence.bearish
  const bull = rsi.divergence.bullish
  if (!bear && !bull) return { raw: 0, note: 'no divergence' }
  // A bearish RSI divergence hints at a top → price may fall (favours fill when
  // price must fall). Bullish divergence hints at a bottom → favours a rise.
  const raw = rsiRaw(favor, bull?.strength ?? null, bear?.strength ?? null)
  const parts: string[] = []
  if (bear) parts.push(`${bear.strength} bearish`)
  if (bull) parts.push(`${bull.strength} bullish`)
  return { raw, note: parts.join(' + ') || 'no divergence' }
}

function clip(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n))
}

export function computeConvergenceScore(inputs: ConvergenceInputs): ConvergenceScore | null {
  const { positionPct, peEta, priceChanges, sma, lr20, rsi } = inputs

  const parts: { key: ConvergenceKey; raw: number | null; note: string }[] = [
    { key: 'drift', ...driftComponent(peEta) },
    { key: 'momentum', ...momentumComponent(positionPct, priceChanges) },
    { key: 'sma', ...smaComponent(positionPct, sma) },
    { key: 'lr20', ...lr20Component(positionPct, lr20) },
    { key: 'rsi', ...rsiComponent(positionPct, rsi) },
  ]

  // If no component carries any signal, the score is meaningless.
  const anySignal = parts.some((p) => p.raw !== null)
  if (!anySignal) return null

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

  // Confidence: drift is the anchor, momentum/SMA carry the next-most weight.
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

/** Short label for a score, used on chips when space is tight. */
export function convergenceBand(score: number): 'strong-pos' | 'pos' | 'neutral' | 'neg' | 'strong-neg' {
  if (score >= 50) return 'strong-pos'
  if (score >= 15) return 'pos'
  if (score > -15) return 'neutral'
  if (score > -50) return 'neg'
  return 'strong-neg'
}
