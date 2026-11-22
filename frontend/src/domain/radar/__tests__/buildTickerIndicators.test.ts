import { describe, expect, it } from 'vitest'
import { buildTickerIndicators } from '../indicatorBuild'
import type { DatedClose } from '../types'

/** `n` trading-day rows; raw close stays flat at 1000 so only adjusted closes can move the score. */
function rows(n: number, adj: (i: number) => number | null): DatedClose[] {
  const start = Date.UTC(2024, 0, 1)
  return Array.from({ length: n }, (_, i) => ({
    date: new Date(start + i * 86_400_000).toISOString().slice(0, 10),
    close: 1000,
    adjClose: adj(i),
  }))
}

/**
 * 253 rows, last index 252. Adjusted closes are 100 everywhere except:
 * latest = 120, 63 days back = 80, 126 back = 60, 252 back = 50.
 * So r1M = 0.2, r3M = 0.5, r6M = 1.0, r1Y = 1.4 and
 * score = 0.35·0.2 + 0.30·0.5 + 0.20·1.0 + 0.15·1.4 = 0.63.
 */
const KNOWN: Record<number, number> = { 252: 120, 189: 80, 126: 60, 0: 50 }
const oneYear = rows(253, (i) => KNOWN[i] ?? 100)

describe('buildTickerIndicators: Momentum Score', () => {
  it('blends the 1M/3M/6M/1Y adjusted-close returns 0.35/0.30/0.20/0.15', () => {
    const { momentum } = buildTickerIndicators('KO', oneYear, null)
    expect(momentum.r1m).toBeCloseTo(0.2, 10)
    expect(momentum.r3m).toBeCloseTo(0.5, 10)
    expect(momentum.r6m).toBeCloseTo(1.0, 10)
    expect(momentum.r1y).toBeCloseTo(1.4, 10)
    expect(momentum.score).toBeCloseTo(0.63, 10)
  })

  it('is empty, not partial, when there is less than a year of history', () => {
    // 252 rows reach back 251 trading days: 1M/3M/6M exist, 1Y does not.
    const { momentum } = buildTickerIndicators('KO', oneYear.slice(1), null)
    expect(momentum.r1m).toBeCloseTo(0.2, 10)
    expect(momentum.r1y).toBeNull()
    expect(momentum.score).toBeNull()
  })

  it('is empty when adjusted closes are missing (rows not backfilled yet)', () => {
    const { momentum, currentPrice } = buildTickerIndicators('KO', rows(300, () => null), null)
    expect(currentPrice).toBe(1000)
    expect(momentum).toEqual({ r1m: null, r3m: null, r6m: null, r1y: null, score: null })
  })

  it('is empty when the fetch errored', () => {
    const { momentum } = buildTickerIndicators('KO', [], 'fetch failed')
    expect(momentum.score).toBeNull()
  })
})
