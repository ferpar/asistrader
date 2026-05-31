/**
 * Screening score — ranks the radar watchlist into A/B/C tiers from a composite
 * of two indicator families, weighted with HISTORICAL trade performance above
 * TECHNICAL signals.
 *
 * Everything is computed live from the latest indicators + IRR analysis; nothing
 * is persisted. Metrics are min-max normalized ACROSS the current rated set
 * (relative screen), then composed and cut by fixed score thresholds.
 *
 * A ticker is "rated" iff it has at least one closed (realized) trade. Untraded
 * tickers carry no historical family, so they're returned separately (unrated)
 * rather than tiered.
 */
import { annualizedTir, RSI_OVERBOUGHT, RSI_OVERSOLD } from '../radar/indicators'
import type { DivergenceSignal, TickerIndicators } from '../radar/types'
import type { ScopeBlock, TradeIrr } from '../irr/types'

export type Tier = 'A' | 'B' | 'C'

/** Raw per-ticker metric values (pre-normalization). Null = not computable. */
export interface MetricValues {
  // Historical (null for unrated tickers)
  avgReturnPerTrade: number | null
  winnerFreq: number | null
  loserFreq: number | null
  avgHoldingDays: number | null
  // Technical
  avgAnnualizedTir: number | null
  bullishScore: number | null
  divergence: number | null
  /** Scored RSI signal: oversold positive, overbought negative, in-band 0. */
  rsiBand: number | null
  /** Raw latest RSI, for display only (not scored). */
  rsiLatest: number | null
  momentum: number | null
}

export interface ScreenedTicker {
  symbol: string
  name: string | null
  rated: boolean
  /** Composite 0..100; null when unrated. */
  score: number | null
  tier: Tier | null
  familyScores: { historical: number | null; technical: number | null }
  metrics: MetricValues
  tradeCount: number
}

export interface ScreeningResult {
  tiers: { A: ScreenedTicker[]; B: ScreenedTicker[]; C: ScreenedTicker[] }
  unrated: ScreenedTicker[]
}

export interface ScreeningWeights {
  family: { historical: number; technical: number }
  historical: {
    avgReturnPerTrade: number
    winnerFreq: number
    loserFreq: number
    avgHoldingDays: number
  }
  technical: {
    avgAnnualizedTir: number
    bullishScore: number
    divergence: number
    rsiBand: number
    momentum: number
  }
}

/** Historical weighted above technical; tunable starting point. */
export const DEFAULT_WEIGHTS: ScreeningWeights = {
  family: { historical: 0.6, technical: 0.4 },
  historical: { avgReturnPerTrade: 0.35, winnerFreq: 0.3, loserFreq: 0.2, avgHoldingDays: 0.15 },
  technical: { avgAnnualizedTir: 0.3, bullishScore: 0.25, divergence: 0.2, rsiBand: 0.15, momentum: 0.1 },
}

/** Score thresholds for the A/B/C cut. */
export const TIER_A_MIN = 70
export const TIER_B_MIN = 45

/** Metrics where a lower raw value is better (inverted during normalization). */
const LOWER_IS_BETTER = new Set<keyof MetricValues>(['loserFreq', 'avgHoldingDays'])

const STRENGTH_SCALAR = { weak: 1, moderate: 2, strong: 3 } as const

const mean = (xs: number[]): number => xs.reduce((s, v) => s + v, 0) / xs.length

/** Signed strength: bullish divergence is positive, bearish negative. */
function divergenceScalar(div: { bearish: DivergenceSignal | null; bullish: DivergenceSignal | null }): number | null {
  const bull = div.bullish ? STRENGTH_SCALAR[div.bullish.strength] : 0
  const bear = div.bearish ? STRENGTH_SCALAR[div.bearish.strength] : 0
  if (!div.bullish && !div.bearish) return 0
  return bull - bear
}

/** Oversold (<30) rewards, overbought (>70) penalizes, in-band is neutral. */
function rsiBandScalar(rsi: number | null): number | null {
  if (rsi === null) return null
  if (rsi < RSI_OVERSOLD) return RSI_OVERSOLD - rsi
  if (rsi > RSI_OVERBOUGHT) return -(rsi - RSI_OVERBOUGHT)
  return 0
}

function technicalMetrics(ind: TickerIndicators): Pick<
  MetricValues,
  'avgAnnualizedTir' | 'bullishScore' | 'divergence' | 'rsiBand' | 'rsiLatest' | 'momentum'
> {
  const tirs = [ind.linearRegression.lr20, ind.linearRegression.lr50, ind.linearRegression.lr200]
    .map((lr) => annualizedTir(lr.slopePct))
    .filter((v): v is number => v !== null)
  const moms = [ind.priceChanges.avgChangePct5d, ind.priceChanges.avgChangePct50d].filter(
    (v): v is number => v !== null,
  )
  return {
    avgAnnualizedTir: tirs.length ? mean(tirs) : null,
    bullishScore: ind.sma.bullishScore,
    divergence: divergenceScalar(ind.rsi.divergence),
    rsiBand: rsiBandScalar(ind.rsi.latest),
    rsiLatest: ind.rsi.latest,
    momentum: moms.length ? mean(moms) : null,
  }
}

type HistoricalStats = Pick<
  MetricValues,
  'avgReturnPerTrade' | 'winnerFreq' | 'loserFreq' | 'avgHoldingDays'
> & { tradeCount: number }

/** Per-ticker historical stats from realized transactions, keyed by upper symbol. */
function historicalBySymbol(realized: ScopeBlock): Map<string, HistoricalStats> {
  const groups = new Map<string, TradeIrr[]>()
  for (const t of realized.transactions) {
    const key = t.ticker.toUpperCase()
    const list = groups.get(key)
    if (list) list.push(t)
    else groups.set(key, [t])
  }

  const out = new Map<string, HistoricalStats>()
  for (const [key, trades] of groups) {
    const winners = trades.filter((t) => t.isWinner).length
    const losers = trades.filter((t) => t.profitNative < 0).length
    const decisive = winners + losers
    out.set(key, {
      avgReturnPerTrade: mean(trades.map((t) => t.returnPct)),
      winnerFreq: decisive > 0 ? winners / decisive : null,
      loserFreq: decisive > 0 ? losers / decisive : null,
      avgHoldingDays: mean(trades.map((t) => t.holdingDays)),
      tradeCount: trades.length,
    })
  }
  return out
}

/** Min/max of a metric across the rated rows (non-null only). */
function extent(rows: ScreenedTicker[], key: keyof MetricValues): { min: number; max: number } | null {
  const vals = rows.map((r) => r.metrics[key]).filter((v): v is number => v !== null)
  if (!vals.length) return null
  return { min: Math.min(...vals), max: Math.max(...vals) }
}

/** Normalize one raw value to 0..1 given the metric's extent and direction. */
function normalize(value: number, key: keyof MetricValues, ext: { min: number; max: number }): number {
  if (ext.max - ext.min < 1e-12) return 0.5 // every ticker equal → neutral
  const t = (value - ext.min) / (ext.max - ext.min)
  return LOWER_IS_BETTER.has(key) ? 1 - t : t
}

/**
 * Weighted, weight-renormalized family score (0..1) over the metrics that are
 * present for this ticker. Null when no metric in the family is available.
 */
function familyScore01(
  metrics: MetricValues,
  weights: Record<string, number>,
  extents: Partial<Record<keyof MetricValues, { min: number; max: number } | null>>,
): number | null {
  let acc = 0
  let wSum = 0
  for (const k of Object.keys(weights) as (keyof MetricValues)[]) {
    const v = metrics[k]
    const ext = extents[k]
    if (v === null || !ext) continue
    acc += weights[k] * normalize(v, k, ext)
    wSum += weights[k]
  }
  return wSum > 0 ? acc / wSum : null
}

function tierFor(score: number): Tier {
  if (score >= TIER_A_MIN) return 'A'
  if (score >= TIER_B_MIN) return 'B'
  return 'C'
}

export function computeScreening(
  indicators: TickerIndicators[],
  realized: ScopeBlock,
  weights: ScreeningWeights = DEFAULT_WEIGHTS,
): ScreeningResult {
  const hist = historicalBySymbol(realized)

  // Build base rows with raw metrics; split rated vs unrated.
  const allRows: ScreenedTicker[] = indicators.map((ind) => {
    const h = hist.get(ind.symbol.toUpperCase())
    const tech = technicalMetrics(ind)
    return {
      symbol: ind.symbol,
      name: ind.name,
      rated: h !== undefined,
      score: null,
      tier: null,
      familyScores: { historical: null, technical: null },
      tradeCount: h?.tradeCount ?? 0,
      metrics: {
        avgReturnPerTrade: h?.avgReturnPerTrade ?? null,
        winnerFreq: h?.winnerFreq ?? null,
        loserFreq: h?.loserFreq ?? null,
        avgHoldingDays: h?.avgHoldingDays ?? null,
        ...tech,
      },
    }
  })

  const rated = allRows.filter((r) => r.rated)
  const unrated = allRows
    .filter((r) => !r.rated)
    .sort((a, b) => a.symbol.localeCompare(b.symbol))

  // Extents are computed across the rated set only.
  const keys: (keyof MetricValues)[] = [
    'avgReturnPerTrade', 'winnerFreq', 'loserFreq', 'avgHoldingDays',
    'avgAnnualizedTir', 'bullishScore', 'divergence', 'rsiBand', 'momentum',
  ]
  const extents: Partial<Record<keyof MetricValues, { min: number; max: number } | null>> = {}
  for (const k of keys) extents[k] = extent(rated, k)

  for (const row of rated) {
    const hist01 = familyScore01(row.metrics, weights.historical, extents)
    const tech01 = familyScore01(row.metrics, weights.technical, extents)
    row.familyScores = {
      historical: hist01 === null ? null : hist01 * 100,
      technical: tech01 === null ? null : tech01 * 100,
    }

    // Compose families, renormalizing over whichever are present.
    const hw = hist01 === null ? 0 : weights.family.historical
    const tw = tech01 === null ? 0 : weights.family.technical
    const totalW = hw + tw
    const score01 = totalW > 0 ? (hw * (hist01 ?? 0) + tw * (tech01 ?? 0)) / totalW : null
    row.score = score01 === null ? null : score01 * 100
    row.tier = row.score === null ? null : tierFor(row.score)
  }

  const tiers: ScreeningResult['tiers'] = { A: [], B: [], C: [] }
  for (const row of rated) {
    if (row.tier) tiers[row.tier].push(row)
  }
  for (const t of ['A', 'B', 'C'] as Tier[]) {
    tiers[t].sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
  }

  return { tiers, unrated }
}
