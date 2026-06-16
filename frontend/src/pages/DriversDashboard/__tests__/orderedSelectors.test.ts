import { describe, it, expect } from 'vitest'
import { Decimal } from '../../../domain/shared/Decimal'
import { buildTrade } from '../../../domain/trade/testing/fixtures'
import {
  buildLiveMetrics,
  buildTickerIndicators,
  buildSmaStructure,
} from '../../../domain/radar/testing/fixtures'
import type { LiveMetrics, TradeWithMetrics } from '../../../domain/trade/types'
import {
  buildOrderedRows,
  filterBySign,
  matchesQuery,
  positionDomain,
  summarizeOrderedRows,
} from '../orderedSelectors'
import type { OrderedRow } from '../orderedSelectors'

const NOW = new Date('2026-06-01T00:00:00Z')

function ordered(overrides: Partial<TradeWithMetrics> = {}): TradeWithMetrics {
  return buildTrade({
    status: 'ordered',
    datePlanned: new Date('2026-05-01'),
    dateOrdered: new Date('2026-05-10'),
    ...overrides,
  })
}

describe('buildOrderedRows', () => {
  it('only includes trades in ordered status', () => {
    const trades = [
      ordered({ id: 1, ticker: 'AAA' }),
      buildTrade({ id: 2, status: 'open' }),
      buildTrade({ id: 3, status: 'plan' }),
      buildTrade({ id: 4, status: 'close' }),
    ]
    const rows = buildOrderedRows(trades, {}, [], NOW)
    expect(rows.map((r) => r.tradeId)).toEqual([1])
  })

  it('derives position % from live metrics distanceToPE', () => {
    const trade = ordered({ id: 10 })
    const metrics: Record<number, LiveMetrics> = {
      10: buildLiveMetrics({ distanceToPE: Decimal.from(-0.05) }),
    }
    const [row] = buildOrderedRows([trade], metrics, [], NOW)
    expect(row.positionPct).toBeCloseTo(-0.05)
  })

  it('computes order and plan ages in days', () => {
    const trade = ordered({
      datePlanned: new Date('2026-05-01'),
      dateOrdered: new Date('2026-05-10'),
    })
    const [row] = buildOrderedRows([trade], {}, [], NOW)
    expect(row.planAgeDays).toBe(31)
    expect(row.orderAgeDays).toBe(22)
    expect(row.planToOrderDays).toBe(9)
  })

  it('falls back gracefully when dateOrdered is null', () => {
    const trade = ordered({ dateOrdered: null })
    const [row] = buildOrderedRows([trade], {}, [], NOW)
    expect(row.orderAgeDays).toBeNull()
    expect(row.planToOrderDays).toBeNull()
  })

  it('marks long vs short by SL/entry relationship', () => {
    const longTrade = ordered({
      id: 1,
      entryPrice: Decimal.from(100),
      stopLoss: Decimal.from(90),
    })
    const shortTrade = ordered({
      id: 2,
      entryPrice: Decimal.from(100),
      stopLoss: Decimal.from(110),
    })
    const rows = buildOrderedRows([longTrade, shortTrade], {}, [], NOW)
    expect(rows[0].isLong).toBe(true)
    expect(rows[1].isLong).toBe(false)
  })

  it('enriches with radar drift when indicators are available', () => {
    const trade = ordered({ id: 5, ticker: 'AAPL' })
    const metrics = { 5: buildLiveMetrics() }
    const indicators = [
      buildTickerIndicators({
        symbol: 'AAPL',
        sma: buildSmaStructure({ bullishScore: 8 }),
      }),
    ]
    const [row] = buildOrderedRows([trade], metrics, indicators, NOW)
    // computeTradeEta returns a non-null badge for ordered trades when indicators
    // are present; we don't assert the exact value (depends on baseline dates)
    // but the bullishScore should pass through.
    expect(row.bullishScore).toBe(8)
  })
})

describe('matchesQuery', () => {
  const row = buildOrderedRows([ordered({ id: 1, number: 42, ticker: 'AAPL' })], {}, [], NOW)[0]

  it('matches everything for empty query', () => {
    expect(matchesQuery(row, '')).toBe(true)
    expect(matchesQuery(row, '   ')).toBe(true)
  })

  it('matches a pure-digit query against the trade number exactly', () => {
    expect(matchesQuery(row, '42')).toBe(true)
    expect(matchesQuery(row, '4')).toBe(false)
    expect(matchesQuery(row, '420')).toBe(false)
  })

  it('matches ticker substring case-insensitively otherwise', () => {
    expect(matchesQuery(row, 'aap')).toBe(true)
    expect(matchesQuery(row, 'AAPL')).toBe(true)
    expect(matchesQuery(row, 'msft')).toBe(false)
  })
})

describe('filterBySign', () => {
  const row = (positionPct: number | null): OrderedRow =>
    ({ tradeId: positionPct ?? 0, positionPct }) as OrderedRow

  const rows = [row(0.05), row(-0.03), row(0), row(null), row(0.1)]
  const pos = (r: OrderedRow) => r.positionPct

  it('returns every row for the "mixed" filter', () => {
    expect(filterBySign(rows, 'mixed', pos)).toBe(rows)
  })

  it('keeps only strictly-positive positions', () => {
    expect(filterBySign(rows, 'positive', pos).map((r) => r.positionPct)).toEqual([0.05, 0.1])
  })

  it('keeps only strictly-negative positions', () => {
    expect(filterBySign(rows, 'negative', pos).map((r) => r.positionPct)).toEqual([-0.03])
  })

  it('excludes null and exactly-zero positions from single-sided views', () => {
    const edge = [row(0), row(null)]
    expect(filterBySign(edge, 'positive', pos)).toEqual([])
    expect(filterBySign(edge, 'negative', pos)).toEqual([])
  })
})

describe('positionDomain', () => {
  it('is symmetric around zero for the "mixed" filter', () => {
    expect(positionDomain(0.2, 'mixed')).toEqual([-0.2, 0.2])
  })

  it('collapses the negative half for the positive filter', () => {
    expect(positionDomain(0.2, 'positive')).toEqual([0, 0.2])
  })

  it('collapses the positive half for the negative filter', () => {
    expect(positionDomain(0.2, 'negative')).toEqual([-0.2, 0])
  })

  it('never lets posMax go negative', () => {
    expect(positionDomain(-1, 'positive')).toEqual([0, 0])
  })
})

describe('summarizeOrderedRows', () => {
  it('returns zeros for an empty list', () => {
    const summary = summarizeOrderedRows([])
    expect(summary.count).toBe(0)
    expect(summary.totalCommitted).toBe(0)
    expect(summary.avgPositionPct).toBeNull()
    expect(summary.closestToFill).toBeNull()
    expect(summary.furthestFromFill).toBeNull()
  })

  it('computes averages, extremes, and stale count', () => {
    const trades = [
      ordered({ id: 1, ticker: 'AAA', amount: Decimal.from(1000), dateOrdered: new Date('2026-05-25') }),
      ordered({ id: 2, ticker: 'BBB', amount: Decimal.from(2000), dateOrdered: new Date('2026-03-01') }),
    ]
    const metrics: Record<number, LiveMetrics> = {
      1: buildLiveMetrics({ distanceToPE: Decimal.from(0.01) }),
      2: buildLiveMetrics({ distanceToPE: Decimal.from(-0.15) }),
    }
    const rows = buildOrderedRows(trades, metrics, [], NOW)
    const summary = summarizeOrderedRows(rows)

    expect(summary.count).toBe(2)
    expect(summary.totalCommitted).toBe(3000)
    expect(summary.avgPositionPct).toBeCloseTo(-0.07)
    expect(summary.closestToFill?.ticker).toBe('AAA')
    expect(summary.furthestFromFill?.ticker).toBe('BBB')
    // Trade #2 was ordered 92 days before NOW — over the 30-day stale threshold.
    expect(summary.staleCount).toBe(1)
    expect(summary.hasDriftData).toBe(false)
  })

  it('counts trend-aligned by fill direction, not long/short', () => {
    // Two longs with the same bullish SMA stack, on opposite sides of PE.
    const trades = [
      // Below PE (must rise): a bullish stack favours the fill → aligned.
      ordered({ id: 1, ticker: 'UP', entryPrice: Decimal.from(100), stopLoss: Decimal.from(90) }),
      // Above PE (must fall): a bullish stack pushes price further away → NOT aligned.
      ordered({ id: 2, ticker: 'DN', entryPrice: Decimal.from(100), stopLoss: Decimal.from(90) }),
    ]
    const metrics: Record<number, LiveMetrics> = {
      1: buildLiveMetrics({ distanceToPE: Decimal.from(-0.05) }),
      2: buildLiveMetrics({ distanceToPE: Decimal.from(0.05) }),
    }
    const indicators = [
      buildTickerIndicators({ symbol: 'UP', sma: buildSmaStructure({ bullishScore: 8 }) }),
      buildTickerIndicators({ symbol: 'DN', sma: buildSmaStructure({ bullishScore: 8 }) }),
    ]
    const rows = buildOrderedRows(trades, metrics, indicators, NOW)
    const summary = summarizeOrderedRows(rows)
    // Only the below-PE long counts, even though both are longs with the same stack.
    expect(summary.trendAlignedCount).toBe(1)

    // A bearish stack above PE (must fall) favours the fill → aligned.
    const bearishAbove = buildOrderedRows(
      [ordered({ id: 3, ticker: 'DN', entryPrice: Decimal.from(100), stopLoss: Decimal.from(90) })],
      { 3: buildLiveMetrics({ distanceToPE: Decimal.from(0.05) }) },
      [buildTickerIndicators({ symbol: 'DN', sma: buildSmaStructure({ bullishScore: 2 }) })],
      NOW,
    )
    expect(summarizeOrderedRows(bearishAbove).trendAlignedCount).toBe(1)
  })

  it('counts an order whose price is moving away from PE as drifting away', () => {
    // PE below current price (must fall to fill) while the trend is rising →
    // the live ETA recedes, so the order is diverging from PE.
    const trade = ordered({
      id: 1,
      ticker: 'AAPL',
      entryPrice: Decimal.from(100),
      stopLoss: Decimal.from(90),
    })
    const metrics: Record<number, LiveMetrics> = {
      1: buildLiveMetrics({ currentPrice: Decimal.from(110), distanceToPE: Decimal.from(0.1) }),
    }
    // Default fixture price changes are positive (rising) — away from a PE below.
    const indicators = [buildTickerIndicators({ symbol: 'AAPL' })]
    const [row] = buildOrderedRows([trade], metrics, indicators, NOW)
    expect(row.peDiverging).toBe(true)
    expect(summarizeOrderedRows([row]).driftingAwayCount).toBe(1)
  })

  it('ignores trend alignment when position is null or exactly at PE', () => {
    const trades = [
      ordered({ id: 1, ticker: 'AT', entryPrice: Decimal.from(100), stopLoss: Decimal.from(90) }),
      ordered({ id: 2, ticker: 'NO', entryPrice: Decimal.from(100), stopLoss: Decimal.from(90) }),
    ]
    const metrics: Record<number, LiveMetrics> = {
      1: buildLiveMetrics({ distanceToPE: Decimal.from(0) }),
      // id 2 has no live metrics → positionPct null
    }
    const indicators = [
      buildTickerIndicators({ symbol: 'AT', sma: buildSmaStructure({ bullishScore: 9 }) }),
      buildTickerIndicators({ symbol: 'NO', sma: buildSmaStructure({ bullishScore: 1 }) }),
    ]
    const rows = buildOrderedRows(trades, metrics, indicators, NOW)
    expect(summarizeOrderedRows(rows).trendAlignedCount).toBe(0)
  })
})
