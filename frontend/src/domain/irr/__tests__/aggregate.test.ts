import { describe, it, expect } from 'vitest'
import { aggregateGroup, xirr } from '../aggregate'
import type { TradeIrr } from '../types'

function txn(over: Partial<TradeIrr> & { ticker: string }): TradeIrr {
  const investmentBase = over.investmentBase ?? 100
  const profitBase = over.profitBase ?? 20
  return {
    tradeId: over.tradeId ?? 1,
    ticker: over.ticker,
    tickerName: over.ticker,
    currency: over.currency ?? 'USD',
    status: 'close',
    // `in` checks honor an explicitly-passed null (?? would swallow it).
    dateOrdered: 'dateOrdered' in over ? over.dateOrdered ?? null : '2026-01-01',
    exitDate: 'exitDate' in over ? over.exitDate ?? null : '2026-07-01', // 181 days later
    holdingDays: over.holdingDays ?? 181,
    investmentNative: investmentBase,
    profitNative: profitBase,
    investmentBase,
    profitBase,
    returnPct: investmentBase !== 0 ? profitBase / investmentBase : 0,
    tir: over.tir ?? 0,
    xirr: over.xirr ?? null,
    isWinner: over.isWinner ?? profitBase > 0,
    fxDriftBase: over.fxDriftBase ?? 0,
  }
}

const ANNUAL_DAYS = 365

describe('aggregateGroup', () => {
  it('returns null for an empty set', () => {
    expect(aggregateGroup('x', [])).toBeNull()
  })

  it('capital-weights return and sums money fields', () => {
    const g = aggregateGroup('Tier A', [
      txn({ ticker: 'AAA', investmentBase: 100, profitBase: 20, holdingDays: 100, fxDriftBase: 1 }),
      txn({ ticker: 'BBB', investmentBase: 300, profitBase: 0, holdingDays: 200, fxDriftBase: -2 }),
    ])!
    expect(g.tradeCount).toBe(2)
    expect(g.investmentBase).toBe(400)
    expect(g.profitBase).toBe(20)
    expect(g.returnPct).toBeCloseTo(20 / 400, 10) // capital-weighted, not mean of returns
    expect(g.avgHoldingDays).toBe(150)
    expect(g.fxDriftBase).toBe(-1)
    // tir = returnPct / avgDays * 365
    expect(g.tir).toBeCloseTo((20 / 400 / 150) * ANNUAL_DAYS, 10)
  })

  it('leaves currency null (mixed group) so the card shows FX drift', () => {
    const g = aggregateGroup('Tier A', [txn({ ticker: 'AAA' })])!
    expect(g.currency).toBeNull()
    expect(g.tickerName).toBeNull()
  })

  it("a single-trade group's XIRR matches the analytic two-flow rate", () => {
    // Backend single-trade xirr = (proceeds/investment)^(365/days) - 1.
    const inv = 100
    const profit = 20
    const days = 181
    const expected = (((inv + profit) / inv) ** (ANNUAL_DAYS / days)) - 1
    const g = aggregateGroup('one', [
      txn({ ticker: 'AAA', investmentBase: inv, profitBase: profit, holdingDays: days,
            dateOrdered: '2026-01-01', exitDate: '2026-07-01' }),
    ])!
    expect(g.xirr).not.toBeNull()
    expect(g.xirr!).toBeCloseTo(expected, 5)
  })

  it('yields null XIRR when a trade lacks the dates needed to time its flows', () => {
    const g = aggregateGroup('one', [txn({ ticker: 'AAA', exitDate: null })])!
    expect(g.xirr).toBeNull()
    // Other metrics still aggregate.
    expect(g.tradeCount).toBe(1)
    expect(g.profitBase).toBe(20)
  })
})

describe('xirr', () => {
  it('returns null without a sign change', () => {
    expect(xirr([{ offsetDays: 0, amount: -100 }, { offsetDays: 365, amount: -50 }])).toBeNull()
  })

  it('returns ~0 when proceeds equal investment a year later', () => {
    const r = xirr([{ offsetDays: 0, amount: -100 }, { offsetDays: 365, amount: 100 }])
    expect(r).not.toBeNull()
    expect(r!).toBeCloseTo(0, 4)
  })

  it('recovers a known 100% annual rate (double in one year)', () => {
    const r = xirr([{ offsetDays: 0, amount: -100 }, { offsetDays: 365, amount: 200 }])
    expect(r!).toBeCloseTo(1, 4)
  })
})
