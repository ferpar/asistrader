import { describe, it, expect } from 'vitest'
import { computeExpectedOrders } from '../expectedOrders'
import type { GroupIrr, ScopeBlock, TradeIrr } from '../../../domain/irr/types'

function txn(over: Partial<TradeIrr>): TradeIrr {
  return {
    tradeId: 1,
    ticker: 'AAA',
    tickerName: null,
    currency: 'USD',
    status: 'close',
    dateOrdered: '2026-01-01',
    exitDate: '2026-01-10',
    holdingDays: 9,
    investmentNative: 100,
    profitNative: 10,
    investmentBase: 100,
    profitBase: 10,
    returnPct: 0.1,
    tir: 0.5,
    xirr: null,
    isWinner: true,
    fxDriftBase: 0,
    ...over,
  }
}

function group(over: Partial<GroupIrr>): GroupIrr {
  return {
    label: 'Portfolio',
    tickerName: null,
    currency: null,
    tradeCount: 0,
    investmentBase: 0,
    profitBase: 0,
    returnPct: 0,
    avgHoldingDays: 0,
    tir: 0,
    xirr: null,
    fxDriftBase: 0,
    ...over,
  }
}

// 3 winners (avg 10 days), 1 loser (avg 20 days). winRate = 0.75, loseRate = 0.25.
const scope: ScopeBlock = {
  transactions: [
    txn({ tradeId: 1, isWinner: true, profitNative: 10, exitDate: '2026-05-20' }),
    txn({ tradeId: 2, isWinner: true, profitNative: 10, exitDate: '2026-05-25' }),
    txn({ tradeId: 3, isWinner: true, profitNative: 10, exitDate: '2026-05-28' }),
    txn({ tradeId: 4, isWinner: false, profitNative: -5, exitDate: '2026-05-10' }),
  ],
  byTicker: [],
  byTickerWinners: [],
  byTickerLosers: [],
  portfolio: group({ tradeCount: 4, avgHoldingDays: 12.5 }),
  portfolioWinners: group({ tradeCount: 3, avgHoldingDays: 10 }),
  portfolioLosers: group({ tradeCount: 1, avgHoldingDays: 20 }),
}

const OPEN = 8
const today = new Date(2026, 4, 30, 12) // 2026-05-30 local noon

describe('computeExpectedOrders', () => {
  it('splits open orders by win rate, each side using its own avg days', () => {
    const r = computeExpectedOrders(scope, OPEN, today)
    // winners: 8 * 0.75 / 10 = 0.6 ; losers: 8 * 0.25 / 20 = 0.1
    expect(r.winners.daily).toBeCloseTo(0.6, 6)
    expect(r.losers.daily).toBeCloseTo(0.1, 6)
  })

  it('mixed daily is the sum of winners and losers', () => {
    const r = computeExpectedOrders(scope, OPEN, today)
    expect(r.mixed.daily).toBeCloseTo(r.winners.daily + r.losers.daily, 9)
    expect(r.mixed.daily).toBeCloseTo(0.7, 6)
  })

  it('expected today = days since that side last close * its daily rate', () => {
    const r = computeExpectedOrders(scope, OPEN, today)
    // last winner close 2026-05-28 → 2 days ago; 2 * 0.6 = 1.2
    expect(r.winners.today).toBeCloseTo(1.2, 6)
    // last loser close 2026-05-10 → 20 days ago; 20 * 0.1 = 2.0
    expect(r.losers.today).toBeCloseTo(2.0, 6)
    // last close overall 2026-05-28 → 2 days ago; 2 * 0.7 = 1.4
    expect(r.mixed.today).toBeCloseTo(1.4, 6)
  })

  it('returns 0 daily and null today for a side with no trades', () => {
    const empty: ScopeBlock = {
      ...scope,
      transactions: scope.transactions.filter((t) => t.isWinner),
      portfolioLosers: null,
    }
    const r = computeExpectedOrders(empty, OPEN, today)
    expect(r.losers.daily).toBe(0)
    expect(r.losers.today).toBeNull()
    // mixed now equals winners alone
    expect(r.mixed.daily).toBeCloseTo(r.winners.daily, 9)
  })

  it('handles zero open orders', () => {
    const r = computeExpectedOrders(scope, 0, today)
    expect(r.mixed.daily).toBe(0)
    expect(r.winners.today).toBe(0)
  })
})
