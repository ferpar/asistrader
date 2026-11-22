/**
 * The one builder that turns dated closes into an indicator set. Used by the
 * IndicatorStore (ticker pipeline) and RadarStore (benchmark pipeline), and
 * meant for any other close series (Basket Index, Performance Index).
 */
import type { DatedClose, TickerIndicators, RsiIndicator, MomentumScore } from './types'
import {
  computeSmaStructure,
  computePriceChanges,
  computeLinearRegressionStructure,
  computeRsi,
  computeMomentum,
} from './indicators'

export const EMPTY_SMA = { sma5: null, sma20: null, sma50: null, sma200: null, structure: null, bullishScore: null }
export const EMPTY_CHANGES = { avgChange50d: null, avgChangePct50d: null, avgChange5d: null, avgChangePct5d: null }
const EMPTY_LR_RESULT = { slope: null, slopePct: null, r2: null }
export const EMPTY_LR = { lr20: EMPTY_LR_RESULT, lr50: EMPTY_LR_RESULT, lr200: EMPTY_LR_RESULT }
export const EMPTY_RSI: RsiIndicator = {
  series: [],
  latest: null,
  pivots: { highs: [], lows: [] },
  divergence: { bearish: null, bullish: null },
}
export const EMPTY_MOMENTUM: MomentumScore = { r1m: null, r3m: null, r6m: null, r1y: null, score: null }

/**
 * Sync/fetch window, ISO date. 400 calendar days covers the 253 trading days
 * the Momentum Score's 1-year return needs, with room for holidays.
 */
const INDICATOR_WINDOW_DAYS = 400

export function startDate(): string {
  const d = new Date()
  d.setDate(d.getDate() - INDICATOR_WINDOW_DAYS)
  return d.toISOString().split('T')[0]
}

export const SYNC_THROTTLE_MS = 5 * 60 * 1000

/** Build one ticker's indicators from its dated closes (or an error). */
export function buildTickerIndicators(
  symbol: string,
  datedCloses: DatedClose[],
  error: string | null,
): TickerIndicators {
  if (error) {
    return {
      symbol,
      name: null,
      currentPrice: null,
      sma: EMPTY_SMA,
      priceChanges: EMPTY_CHANGES,
      linearRegression: EMPTY_LR,
      rsi: EMPTY_RSI,
      momentum: EMPTY_MOMENTUM,
      datedCloses: [],
      error,
    }
  }
  const closes = datedCloses.map((r) => r.close)
  if (closes.length === 0) {
    return {
      symbol,
      name: null,
      currentPrice: null,
      sma: EMPTY_SMA,
      priceChanges: EMPTY_CHANGES,
      linearRegression: EMPTY_LR,
      rsi: EMPTY_RSI,
      momentum: EMPTY_MOMENTUM,
      datedCloses: [],
      error: 'No price data available',
    }
  }
  const currentPrice = closes[closes.length - 1]
  return {
    symbol,
    name: null,
    currentPrice,
    sma: computeSmaStructure(closes, currentPrice),
    priceChanges: computePriceChanges(closes),
    linearRegression: computeLinearRegressionStructure(closes),
    rsi: computeRsi(datedCloses),
    momentum: computeMomentum(datedCloses.map((r) => r.adjClose)),
    datedCloses,
    error: null,
  }
}
