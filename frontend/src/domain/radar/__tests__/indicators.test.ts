import { describe, it, expect } from 'vitest'
import { computeEma, computeEmaStructure, computePriceChanges } from '../indicators'

describe('computeEma', () => {
  it('returns null when insufficient data', () => {
    expect(computeEma([1, 2, 3], 5)).toBeNull()
    expect(computeEma([], 1)).toBeNull()
  })

  it('returns SMA when data length equals period', () => {
    const closes = [2, 4, 6, 8, 10]
    const result = computeEma(closes, 5)
    expect(result).toBeCloseTo(6, 5)
  })

  it('computes EMA correctly for known series', () => {
    // 10-day EMA of [22,22,22,22,22,22,22,22,22,22,23,24,25]
    // SMA of first 10 = 22, then k = 2/11 ≈ 0.1818
    // EMA after 23: 22 + 0.1818*(23-22) = 22.1818
    // EMA after 24: 22.1818 + 0.1818*(24-22.1818) = 22.5124
    // EMA after 25: 22.5124 + 0.1818*(25-22.5124) = 22.9647
    const closes = [22, 22, 22, 22, 22, 22, 22, 22, 22, 22, 23, 24, 25]
    const result = computeEma(closes, 10)!
    expect(result).toBeCloseTo(22.9647, 2)
  })
})

describe('computeEmaStructure', () => {
  it('returns all nulls when insufficient data for 200-day EMA', () => {
    const closes = Array(50).fill(100)
    const result = computeEmaStructure(closes, 100)
    expect(result.ema200).toBeNull()
    expect(result.structure).toBeNull()
    expect(result.ema5).not.toBeNull()
    expect(result.ema20).not.toBeNull()
    expect(result.ema50).not.toBeNull()
  })

  it('returns "01234" for bullish structure', () => {
    // Steadily rising prices: EMA200 < EMA50 < EMA20 < EMA5 < current price
    const closes: number[] = []
    for (let i = 0; i < 250; i++) closes.push(50 + i * 0.5)
    const currentPrice = closes[closes.length - 1]
    const result = computeEmaStructure(closes, currentPrice)
    expect(result.structure).toBe('01234')
  })

  it('returns "43210" for bearish structure', () => {
    // Steadily falling prices: current < EMA5 < EMA20 < EMA50 < EMA200
    const closes: number[] = []
    for (let i = 0; i < 250; i++) closes.push(200 - i * 0.5)
    const currentPrice = closes[closes.length - 1]
    const result = computeEmaStructure(closes, currentPrice)
    expect(result.structure).toBe('43210')
  })
})

describe('computePriceChanges', () => {
  it('returns all nulls for fewer than 2 closes', () => {
    expect(computePriceChanges([100]).avgChange5d).toBeNull()
    expect(computePriceChanges([]).avgChange50d).toBeNull()
  })

  it('computes 5d average changes correctly', () => {
    // 6 closes: changes are +1, +1, +1, +1, +1
    const closes = [100, 101, 102, 103, 104, 105]
    const result = computePriceChanges(closes)
    expect(result.avgChange5d).toBeCloseTo(1, 5)
    expect(result.avgChangePct5d).toBeCloseTo(0.0098, 3) // ~1% of ~101 avg
  })

  it('computes 50d average changes for short data', () => {
    // With only 6 data points, 50d uses all available data
    const closes = [100, 102, 104, 106, 108, 110]
    const result = computePriceChanges(closes)
    expect(result.avgChange50d).toBeCloseTo(2, 5)
    expect(result.avgChange5d).toBeCloseTo(2, 5)
  })

  it('handles negative changes', () => {
    const closes = [110, 108, 106, 104, 102, 100]
    const result = computePriceChanges(closes)
    expect(result.avgChange5d).toBeCloseTo(-2, 5)
    expect(result.avgChangePct5d!).toBeLessThan(0)
  })
})
