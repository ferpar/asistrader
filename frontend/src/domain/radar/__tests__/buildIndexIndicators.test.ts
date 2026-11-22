import { describe, expect, it } from 'vitest'
import { buildIndexIndicators, buildTickerIndicators } from '../indicatorBuild'

/** `n` business-day points of a Basket Index (one level per day, as the Basket Index endpoint returns). */
function points(n: number, value: (i: number) => number | null): { date: string; value: number | null }[] {
  const start = Date.UTC(2024, 0, 1)
  return Array.from({ length: n }, (_, i) => ({
    date: new Date(start + i * 86_400_000).toISOString().slice(0, 10),
    value: value(i),
  }))
}

/**
 * 253 points, last index 252. Levels hover around 100 (mild oscillation so RSI
 * has gains and losses) except: latest = 120, 21 back = 100, 63 back = 80,
 * 126 back = 60, 252 back = 50. So r1M = 0.2, r3M = 0.5, r6M = 1.0,
 * r1Y = 1.4 and score = 0.35·0.2 + 0.30·0.5 + 0.20·1.0 + 0.15·1.4 = 0.63.
 */
const KNOWN: Record<number, number> = { 252: 120, 231: 100, 189: 80, 126: 60, 0: 50 }
const oneYear = points(253, (i) => KNOWN[i] ?? 100 + Math.sin(i / 3) * 5)

describe('buildIndexIndicators', () => {
  it('gives a Basket Index the Momentum Score of its own levels', () => {
    const { momentum, error } = buildIndexIndicators('basket:7', oneYear, null)
    expect(error).toBeNull()
    expect(momentum.r1m).toBeCloseTo(0.2, 10)
    expect(momentum.r3m).toBeCloseTo(0.5, 10)
    expect(momentum.r6m).toBeCloseTo(1.0, 10)
    expect(momentum.r1y).toBeCloseTo(1.4, 10)
    expect(momentum.score).toBeCloseTo(0.63, 10)
  })

  it('produces the same indicator set a ticker with those closes gets', () => {
    const asTicker = buildTickerIndicators(
      'basket:7',
      oneYear.map((p) => ({ date: p.date, close: p.value!, adjClose: p.value })),
      null,
    )
    const asIndex = buildIndexIndicators('basket:7', oneYear, null)

    expect(asIndex).toEqual(asTicker)
    expect(asIndex.currentPrice).toBe(120)
    expect(asIndex.sma.bullishScore).not.toBeNull()
    expect(asIndex.linearRegression.lr200.r2).not.toBeNull()
    expect(asIndex.rsi.latest).not.toBeNull()
  })

  it('leaves the Momentum Score empty with less than a year of index history', () => {
    const { momentum, rsi } = buildIndexIndicators('basket:7', oneYear.slice(1), null)
    expect(momentum.r1m).toBeCloseTo(0.2, 10)
    expect(momentum.r1y).toBeNull()
    expect(momentum.score).toBeNull()
    expect(rsi.latest).not.toBeNull()
  })

  it('skips days without a level', () => {
    const result = buildIndexIndicators(
      'SPX',
      [
        { date: '2025-01-01', value: 100 },
        { date: '2025-01-02', value: null },
        { date: '2025-01-03', value: 102 },
      ],
      null,
    )
    expect(result.datedCloses).toEqual([
      { date: '2025-01-01', close: 100, adjClose: 100 },
      { date: '2025-01-03', close: 102, adjClose: 102 },
    ])
  })

  it('passes an upstream error through with an empty indicator set', () => {
    const result = buildIndexIndicators('basket:7', [], 'fetch failed')
    expect(result.error).toBe('fetch failed')
    expect(result.momentum.score).toBeNull()
    expect(result.datedCloses).toEqual([])
  })
})
