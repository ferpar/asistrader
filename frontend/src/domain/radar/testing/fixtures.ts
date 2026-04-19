import { Decimal } from '../../shared/Decimal'
import type {
  TickerIndicators,
  SmaStructure,
  PriceChanges,
  LinearRegressionStructure,
  LinearRegressionResult,
  DatedClose,
} from '../types'
import type { LiveMetrics } from '../../trade/types'
import type { RadarViewState } from '../filterSort'
import { DEFAULT_VIEW_STATE } from '../filterSort'

export function buildSmaStructure(overrides?: Partial<SmaStructure>): SmaStructure {
  return {
    sma5: 100,
    sma20: 98,
    sma50: 95,
    sma200: 90,
    structure: '01234',
    ...overrides,
  }
}

export function buildPriceChanges(overrides?: Partial<PriceChanges>): PriceChanges {
  return {
    avgChange50d: 0.5,
    avgChangePct50d: 0.005,
    avgChange5d: 0.3,
    avgChangePct5d: 0.003,
    ...overrides,
  }
}

export function buildLinearRegressionResult(overrides?: Partial<LinearRegressionResult>): LinearRegressionResult {
  return {
    slope: 0.2,
    slopePct: 0.002,
    r2: 0.7,
    ...overrides,
  }
}

export function buildLinearRegression(overrides?: Partial<LinearRegressionStructure>): LinearRegressionStructure {
  return {
    lr20: buildLinearRegressionResult(),
    lr50: buildLinearRegressionResult(),
    lr200: buildLinearRegressionResult(),
    ...overrides,
  }
}

function defaultDatedCloses(): DatedClose[] {
  const out: DatedClose[] = []
  const start = new Date('2025-06-01')
  for (let i = 0; i < 60; i++) {
    const d = new Date(start)
    d.setDate(start.getDate() + i)
    out.push({ date: d.toISOString().slice(0, 10), close: 100 + i * 0.2 })
  }
  return out
}

export function buildTickerIndicators(overrides?: Partial<TickerIndicators>): TickerIndicators {
  return {
    symbol: 'AAPL',
    name: 'Apple Inc.',
    currentPrice: 100,
    sma: buildSmaStructure(),
    priceChanges: buildPriceChanges(),
    linearRegression: buildLinearRegression(),
    datedCloses: defaultDatedCloses(),
    error: null,
    ...overrides,
  }
}

export function buildLiveMetrics(overrides?: Partial<LiveMetrics>): LiveMetrics {
  return {
    currentPrice: Decimal.from(155),
    distanceToSL: Decimal.from(-0.25),
    distanceToTP: Decimal.from(0.25),
    distanceToPE: Decimal.from(0.01),
    unrealizedPnL: Decimal.from(50),
    unrealizedPnLPct: Decimal.from(0.05),
    ...overrides,
  }
}

export function buildViewState(overrides?: Partial<RadarViewState>): RadarViewState {
  return {
    ...DEFAULT_VIEW_STATE,
    ticker: { ...DEFAULT_VIEW_STATE.ticker, ...(overrides?.ticker ?? {}) },
    trade: { ...DEFAULT_VIEW_STATE.trade, ...(overrides?.trade ?? {}) },
    sort: { ...DEFAULT_VIEW_STATE.sort, ...(overrides?.sort ?? {}) },
    flatView: overrides?.flatView ?? DEFAULT_VIEW_STATE.flatView,
  }
}
