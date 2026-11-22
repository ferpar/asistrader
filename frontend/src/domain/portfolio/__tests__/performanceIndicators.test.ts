import { describe, expect, it } from 'vitest'
import { buildTickerIndicators } from '../../radar/indicatorBuild'
import { buildPerformanceIndicators } from '../performanceIndicators'
import type { PortfolioHistory, PortfolioHistoryRow } from '../types'

/** A history of `n` business days whose Performance Index follows `level(i)`. */
function history(n: number, level: (i: number) => number): PortfolioHistory {
  const start = Date.UTC(2024, 0, 1)
  const rows: PortfolioHistoryRow[] = Array.from({ length: n }, (_, i) => ({
    date: new Date(start + i * 86_400_000).toISOString().slice(0, 10),
    invested: 1000,
    portfolioValue: 1000 + i,
    unrealizedGain: i,
    unrealizedGainPct: i / 1000,
    realizedGain: 0,
    totalGain: i,
    weightedDaysOpen: i,
    performanceIndex: level(i),
  }))
  return { currency: 'EUR', rows }
}

/**
 * 253 rows, last index 252. The index oscillates around 100 except: latest =
 * 120, 21 back = 100, 63 back = 80, 126 back = 60, 252 back = 50. So r1M = 0.2,
 * r3M = 0.5, r6M = 1.0, r1Y = 1.4 and score = 0.35·0.2 + 0.30·0.5 + 0.20·1.0 +
 * 0.15·1.4 = 0.63.
 */
const KNOWN: Record<number, number> = { 252: 120, 231: 100, 189: 80, 126: 60, 0: 50 }
const oneYear = history(253, (i) => KNOWN[i] ?? 100 + Math.sin(i / 3) * 5)

describe('buildPerformanceIndicators', () => {
  it('measures the Performance Index, not the Portfolio Value', () => {
    const { momentum, currentPrice, error } = buildPerformanceIndicators('portfolio:1', oneYear)
    expect(error).toBeNull()
    expect(currentPrice).toBe(120)
    expect(momentum.r1m).toBeCloseTo(0.2, 10)
    expect(momentum.r3m).toBeCloseTo(0.5, 10)
    expect(momentum.r6m).toBeCloseTo(1.0, 10)
    expect(momentum.r1y).toBeCloseTo(1.4, 10)
    expect(momentum.score).toBeCloseTo(0.63, 10)
  })

  it('produces the same indicator set a ticker with those closes and adjusted closes gets', () => {
    const asTicker = buildTickerIndicators(
      'portfolio:1',
      oneYear.rows.map((r) => ({ date: r.date, close: r.performanceIndex, adjClose: r.performanceIndex })),
      null,
    )
    const asPortfolio = buildPerformanceIndicators('portfolio:1', oneYear)

    expect(asPortfolio).toEqual(asTicker)
    expect(asPortfolio.sma.bullishScore).not.toBeNull()
    expect(asPortfolio.linearRegression.lr200.r2).not.toBeNull()
    expect(asPortfolio.rsi.latest).not.toBeNull()
  })

  it('leaves the Momentum Score empty with less than a year of history', () => {
    const { momentum, rsi } = buildPerformanceIndicators('portfolio:1', history(100, (i) => 100 + i))
    expect(momentum.r1m).not.toBeNull()
    expect(momentum.r1y).toBeNull()
    expect(momentum.score).toBeNull()
    expect(rsi.latest).not.toBeNull()
  })

  it('reports no data for a Portfolio without history', () => {
    const result = buildPerformanceIndicators('portfolio:1', { currency: 'EUR', rows: [] })
    expect(result.error).not.toBeNull()
    expect(result.momentum.score).toBeNull()
  })
})
