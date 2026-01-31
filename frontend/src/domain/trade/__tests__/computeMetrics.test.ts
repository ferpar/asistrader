import { describe, it, expect } from 'vitest'
import { computeMetrics } from '../computeMetrics'
import { buildTrade } from '../testing/fixtures'

describe('computeMetrics', () => {
  it('calculates distances and PnL correctly', () => {
    const trades = [
      buildTrade({ id: 1, ticker: 'AAPL', entry_price: 100, stop_loss: 90, take_profit: 120, units: 10 }),
    ]
    const prices = {
      AAPL: { price: 110, currency: 'USD', valid: true },
    }

    const result = computeMetrics(trades, prices)

    expect(result[1].currentPrice).toBe(110)
    // distanceToSL = (110 - 90) / 110 ≈ 0.1818
    expect(result[1].distanceToSL).toBeCloseTo(0.1818, 3)
    // distanceToTP = (120 - 110) / 110 ≈ 0.0909
    expect(result[1].distanceToTP).toBeCloseTo(0.0909, 3)
    // distanceToPE = (110 - 100) / 100 = 0.10
    expect(result[1].distanceToPE).toBeCloseTo(0.10)
    // unrealizedPnL = (110 - 100) * 10 = 100
    expect(result[1].unrealizedPnL).toBe(100)
    // unrealizedPnLPct = (110 - 100) / 100 = 0.10
    expect(result[1].unrealizedPnLPct).toBeCloseTo(0.10)
  })

  it('handles null/invalid prices', () => {
    const trades = [
      buildTrade({ id: 1, ticker: 'AAPL' }),
      buildTrade({ id: 2, ticker: 'MSFT' }),
    ]
    const prices = {
      AAPL: { price: null, currency: null, valid: false },
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
    const result = computeMetrics([], { AAPL: { price: 150, currency: 'USD', valid: true } })
    expect(result).toEqual({})
  })

  it('handles multiple trades with same ticker', () => {
    const trades = [
      buildTrade({ id: 1, ticker: 'AAPL', entry_price: 100, units: 10 }),
      buildTrade({ id: 2, ticker: 'AAPL', entry_price: 105, units: 5 }),
    ]
    const prices = {
      AAPL: { price: 110, currency: 'USD', valid: true },
    }

    const result = computeMetrics(trades, prices)

    expect(result[1].currentPrice).toBe(110)
    expect(result[2].currentPrice).toBe(110)
    // Each trade gets its own PnL
    expect(result[1].unrealizedPnL).toBe(100) // (110-100)*10
    expect(result[2].unrealizedPnL).toBe(25)  // (110-105)*5
  })
})
