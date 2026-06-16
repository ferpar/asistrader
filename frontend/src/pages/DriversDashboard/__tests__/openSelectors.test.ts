import { describe, it, expect } from 'vitest'
import { Decimal } from '../../../domain/shared/Decimal'
import { buildTrade } from '../../../domain/trade/testing/fixtures'
import { buildLiveMetrics } from '../../../domain/radar/testing/fixtures'
import type { LiveMetrics, TradeWithMetrics } from '../../../domain/trade/types'
import { buildOpenRows, summarizeOpenRows } from '../openSelectors'

const NOW = new Date('2026-06-01T00:00:00Z')

function open(overrides: Partial<TradeWithMetrics> = {}): TradeWithMetrics {
  return buildTrade({
    status: 'open',
    datePlanned: new Date('2026-05-01'),
    dateActual: new Date('2026-05-10'),
    entryPrice: Decimal.from(100),
    stopLoss: Decimal.from(90),
    takeProfit: Decimal.from(120),
    ...overrides,
  })
}

/** Live metrics whose two distances place a row in profit or loss. */
function metricsToward(side: 'profit' | 'loss', mag: number, pnlPct = 0): LiveMetrics {
  return side === 'profit'
    ? buildLiveMetrics({ distanceToTP: Decimal.from(mag), distanceToSL: Decimal.from(-mag), unrealizedPnLPct: Decimal.from(pnlPct) })
    : buildLiveMetrics({ distanceToTP: Decimal.from(-mag), distanceToSL: Decimal.from(mag), unrealizedPnLPct: Decimal.from(pnlPct) })
}

describe('buildOpenRows', () => {
  it('only includes trades in open status', () => {
    const trades = [
      open({ id: 1, ticker: 'AAA' }),
      buildTrade({ id: 2, status: 'ordered' }),
      buildTrade({ id: 3, status: 'plan' }),
      buildTrade({ id: 4, status: 'close' }),
    ]
    const rows = buildOpenRows(trades, {}, [], NOW)
    expect(rows.map((r) => r.tradeId)).toEqual([1])
  })

  it('classifies the profit segment from live distances', () => {
    const metrics: Record<number, LiveMetrics> = { 10: metricsToward('profit', 0.5) }
    const [row] = buildOpenRows([open({ id: 10 })], metrics, [], NOW)
    expect(row.positionToTarget).toBeCloseTo(0.5)
    expect(row.segment).toBe('profit')
  })

  it('classifies the loss segment from live distances', () => {
    const metrics: Record<number, LiveMetrics> = { 10: metricsToward('loss', 0.4) }
    const [row] = buildOpenRows([open({ id: 10 })], metrics, [], NOW)
    expect(row.positionToTarget).toBeCloseTo(-0.4)
    expect(row.segment).toBe('loss')
  })

  it('is flat when there is no live price', () => {
    const [row] = buildOpenRows([open({ id: 10 })], {}, [], NOW)
    expect(row.positionToTarget).toBeNull()
    expect(row.segment).toBe('flat')
  })

  it('computes holding days from dateActual', () => {
    const [row] = buildOpenRows([open({ dateActual: new Date('2026-05-10') })], {}, [], NOW)
    expect(row.holdingDays).toBe(22)
  })

  it('falls back gracefully when dateActual is null', () => {
    const [row] = buildOpenRows([open({ dateActual: null })], {}, [], NOW)
    expect(row.holdingDays).toBeNull()
  })

  it('converts committed capital to base via the converter, keeping native amount', () => {
    const toBase: (amount: number, ccy: string | null, onDate: Date) => number = (
      amount,
      ccy,
    ) => (ccy === 'EUR' ? amount * 1.1 : amount)
    const trades = [
      open({ id: 1, amount: Decimal.from(1000), tickerCurrency: 'EUR' }),
      open({ id: 2, amount: Decimal.from(1000), tickerCurrency: 'USD' }),
    ]
    const rows = buildOpenRows(trades, {}, [], NOW, toBase)
    expect(rows[0].amount).toBe(1000) // native is preserved for the table
    expect(rows[0].committedBase).toBeCloseTo(1100) // EUR converted to base
    expect(rows[1].committedBase).toBe(1000) // base-currency trade unchanged
    expect(summarizeOpenRows(rows).totalCommitted).toBeCloseTo(2100)
  })

  it('defaults committedBase to the native amount without a converter', () => {
    const [row] = buildOpenRows([open({ amount: Decimal.from(1500) })], {}, [], NOW)
    expect(row.committedBase).toBe(1500)
  })

  it('marks long vs short by SL/entry relationship', () => {
    const longTrade = open({ id: 1, entryPrice: Decimal.from(100), stopLoss: Decimal.from(90) })
    const shortTrade = open({ id: 2, entryPrice: Decimal.from(100), stopLoss: Decimal.from(110) })
    const rows = buildOpenRows([longTrade, shortTrade], {}, [], NOW)
    expect(rows[0].isLong).toBe(true)
    expect(rows[1].isLong).toBe(false)
  })
})

describe('summarizeOpenRows', () => {
  it('returns zeros for an empty list', () => {
    const s = summarizeOpenRows([])
    expect(s.count).toBe(0)
    expect(s.totalCommitted).toBe(0)
    expect(s.avgPnLPct).toBeNull()
    expect(s.closestToTP).toBeNull()
    expect(s.closestToSL).toBeNull()
    expect(s.inProfitCount).toBe(0)
    expect(s.inLossCount).toBe(0)
  })

  it('computes segment counts, extremes, and averages', () => {
    const trades = [
      open({ id: 1, ticker: 'AAA', amount: Decimal.from(1000) }),
      open({ id: 2, ticker: 'BBB', amount: Decimal.from(2000) }),
      open({ id: 3, ticker: 'CCC', amount: Decimal.from(1000) }),
      open({ id: 4, ticker: 'DDD', amount: Decimal.from(1000), dateActual: new Date('2026-01-01') }),
    ]
    const metrics: Record<number, LiveMetrics> = {
      1: metricsToward('profit', 0.8, 0.1),
      2: metricsToward('profit', 0.3, 0.02),
      3: metricsToward('loss', 0.6, -0.06),
      4: metricsToward('loss', 0.2, -0.01),
    }
    const rows = buildOpenRows(trades, metrics, [], NOW)
    const s = summarizeOpenRows(rows)

    expect(s.count).toBe(4)
    expect(s.totalCommitted).toBe(5000)
    expect(s.inProfitCount).toBe(2)
    expect(s.inLossCount).toBe(2)
    expect(s.closestToTP?.ticker).toBe('AAA')
    expect(s.closestToSL?.ticker).toBe('CCC')
    expect(s.avgPnLPct).toBeCloseTo(0.0125)
    // DDD opened 2026-01-01 → 151 days before NOW, over the 90-day stale line.
    expect(s.staleCount).toBe(1)
  })
})
