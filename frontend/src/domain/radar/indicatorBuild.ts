/**
 * Low-level shared pieces for turning raw market-data rows into TickerIndicators.
 * Extracted so both the IndicatorStore (ticker pipeline) and RadarStore
 * (benchmark pipeline) can reuse the empty-state constants and builders.
 */
import type { MarketDataRowDTO } from '../../types/radar'
import type { TickerIndicators, RsiIndicator } from './types'
import {
  computeSmaStructure,
  computePriceChanges,
  computeLinearRegressionStructure,
  computeRsi,
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

/** Sync/fetch window: 300 days back, ISO date. */
export function startDate(): string {
  const d = new Date()
  d.setDate(d.getDate() - 300)
  return d.toISOString().split('T')[0]
}

export const SYNC_THROTTLE_MS = 5 * 60 * 1000

/** Build one ticker's indicators from its market-data rows (or an error). */
export function buildTickerIndicators(
  symbol: string,
  rows: MarketDataRowDTO[],
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
      datedCloses: [],
      error,
    }
  }
  const datedCloses = rows
    .filter((r): r is typeof r & { close: number } => r.close !== null)
    .map((r) => ({ date: r.date, close: r.close }))
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
    datedCloses,
    error: null,
  }
}
