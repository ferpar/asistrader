import { describe, it, expect } from 'vitest'
import { computeSma, computeSmaStructure, computePriceChanges } from '../indicators'

describe('computeSma', () => {
  it('returns null when insufficient data', () => {
    expect(computeSma([1, 2, 3], 5)).toBeNull()
    expect(computeSma([], 1)).toBeNull()
  })

  it('returns the average when data length equals period', () => {
    expect(computeSma([2, 4, 6, 8, 10], 5)).toBe(6)
  })

  it('uses only the last N closes when more data is available', () => {
    // Last 5 of [1..10]: 6+7+8+9+10 = 40, /5 = 8
    expect(computeSma([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 5)).toBe(8)
  })

  it('computes correctly for period 2', () => {
    // Last 2 of [10, 20, 30]: (20+30)/2 = 25
    expect(computeSma([10, 20, 30], 2)).toBe(25)
  })

  it('handles a single-element period', () => {
    expect(computeSma([42], 1)).toBe(42)
  })
})

describe('computeSmaStructure', () => {
  it('returns all-null fields when insufficient data for 200-period SMA', () => {
    const closes = Array(50).fill(100)
    const result = computeSmaStructure(closes, 100)
    expect(result.sma200).toBeNull()
    expect(result.structure).toBeNull()
    expect(result.sma5).not.toBeNull()
    expect(result.sma20).not.toBeNull()
    expect(result.sma50).not.toBeNull()
  })

  it('returns "01234" for a steadily rising bullish series', () => {
    // Rising prices ⇒ current > SMA5 > SMA20 > SMA50 > SMA200
    const closes: number[] = []
    for (let i = 0; i < 250; i++) closes.push(50 + i * 0.5)
    const currentPrice = closes[closes.length - 1]
    const result = computeSmaStructure(closes, currentPrice)
    expect(result.structure).toBe('01234')
  })

  it('returns "43210" for a steadily falling bearish series', () => {
    const closes: number[] = []
    for (let i = 0; i < 250; i++) closes.push(200 - i * 0.5)
    const currentPrice = closes[closes.length - 1]
    const result = computeSmaStructure(closes, currentPrice)
    expect(result.structure).toBe('43210')
  })

  it('computes individual SMA values matching hand-verified math', () => {
    // 200 closes, all = 100. Each SMA(5/20/50/200) = 100.
    const closes = Array(200).fill(100)
    const result = computeSmaStructure(closes, 100)
    expect(result.sma5).toBe(100)
    expect(result.sma20).toBe(100)
    expect(result.sma50).toBe(100)
    expect(result.sma200).toBe(100)
  })

  it('returns correct structure when current price matches an SMA exactly', () => {
    // 200 closes all 100; current price 100. All values equal -> sort is stable.
    // structure should still be 5 chars from {0,1,2,3,4}.
    const closes = Array(200).fill(100)
    const result = computeSmaStructure(closes, 100)
    expect(result.structure).toHaveLength(5)
    expect(new Set(result.structure!.split(''))).toEqual(new Set(['0', '1', '2', '3', '4']))
  })
})

describe('computePriceChanges', () => {
  it('returns all nulls for fewer than 2 closes', () => {
    expect(computePriceChanges([100]).avgChange5d).toBeNull()
    expect(computePriceChanges([]).avgChange50d).toBeNull()
  })

  it('computes 5d average changes correctly', () => {
    const closes = [100, 101, 102, 103, 104, 105]
    const result = computePriceChanges(closes)
    expect(result.avgChange5d).toBeCloseTo(1, 5)
    expect(result.avgChangePct5d).toBeCloseTo(0.0098, 3)
  })

  it('computes 50d average changes for short data', () => {
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
