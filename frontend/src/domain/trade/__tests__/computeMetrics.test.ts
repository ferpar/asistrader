import { describe, it, expect } from 'vitest'
import { Decimal } from '../../shared/Decimal'
import { computeMetrics } from '../computeMetrics'
import { buildTrade, buildPriceData } from '../testing/fixtures'

describe('computeMetrics', () => {
  it('calculates distances and PnL correctly', () => {
    const trades = [
      buildTrade({ id: 1, ticker: 'AAPL', entryPrice: Decimal.from(100), stopLoss: Decimal.from(90), takeProfit: Decimal.from(120), units: 10 }),
    ]
    const prices = {
      AAPL: buildPriceData({ price: Decimal.from(110) }),
    }

    const result = computeMetrics(trades, prices)

    expect(result[1].currentPrice!.toNumber()).toBe(110)
    // distanceToSL = (110 - 90) / 110 ≈ 0.1818
    expect(result[1].distanceToSL!.toNumber()).toBeCloseTo(0.1818, 3)
    // distanceToTP = (120 - 110) / 110 ≈ 0.0909
    expect(result[1].distanceToTP!.toNumber()).toBeCloseTo(0.0909, 3)
    // distanceToPE = (110 - 100) / 100 = 0.10
    expect(result[1].distanceToPE!.toNumber()).toBeCloseTo(0.10)
    // unrealizedPnL = (110 - 100) * 10 = 100
    expect(result[1].unrealizedPnL!.toNumber()).toBe(100)
    // unrealizedPnLPct = (110 - 100) / 100 = 0.10
    expect(result[1].unrealizedPnLPct!.toNumber()).toBeCloseTo(0.10)
  })

  it('handles null/invalid prices', () => {
    const trades = [
      buildTrade({ id: 1, ticker: 'AAPL' }),
      buildTrade({ id: 2, ticker: 'MSFT' }),
    ]
    const prices = {
      AAPL: buildPriceData({ price: null, valid: false }),
      // MSFT not in prices at all
    }

    const result = computeMetrics(trades, prices)

    expect(result[1].currentPrice).toBeNull()
    expect(result[1].distanceToSL).toBeNull()
    expect(result[1].unrealizedPnL).toBeNull()

    expect(result[2].currentPrice).toBeNull()
    expect(result[2].distanceToSL).toBeNull()
  })

  it('handles empty trade list', () => {
    const result = computeMetrics([], { AAPL: buildPriceData({ price: Decimal.from(150) }) })
    expect(result).toEqual({})
  })

  it('handles multiple trades with same ticker', () => {
    const trades = [
      buildTrade({ id: 1, ticker: 'AAPL', entryPrice: Decimal.from(100), units: 10 }),
      buildTrade({ id: 2, ticker: 'AAPL', entryPrice: Decimal.from(105), units: 5 }),
    ]
    const prices = {
      AAPL: buildPriceData({ price: Decimal.from(110) }),
    }

    const result = computeMetrics(trades, prices)

    expect(result[1].currentPrice!.toNumber()).toBe(110)
    expect(result[2].currentPrice!.toNumber()).toBe(110)
    // Each trade gets its own PnL
    expect(result[1].unrealizedPnL!.toNumber()).toBe(100) // (110-100)*10
    expect(result[2].unrealizedPnL!.toNumber()).toBe(25)  // (110-105)*5
  })
})
