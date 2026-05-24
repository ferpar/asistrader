import { describe, it, expect } from 'vitest'
import {
  computeSma,
  computeSmaStructure,
  computePriceChanges,
  computeLinearRegression,
  computeLinearRegressionStructure,
  computeRsiSeries,
  findRsiPivots,
  detectDivergenceLine,
  computeRsi,
} from '../indicators'
import type { RsiPivot, DatedClose } from '../types'

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

  it('scores 10 for a textbook bullish stack', () => {
    const closes: number[] = []
    for (let i = 0; i < 250; i++) closes.push(50 + i * 0.5)
    const currentPrice = closes[closes.length - 1]
    const result = computeSmaStructure(closes, currentPrice)
    expect(result.bullishScore).toBe(10)
  })

  it('scores 0 for a textbook bearish stack', () => {
    const closes: number[] = []
    for (let i = 0; i < 250; i++) closes.push(200 - i * 0.5)
    const currentPrice = closes[closes.length - 1]
    const result = computeSmaStructure(closes, currentPrice)
    expect(result.bullishScore).toBe(0)
  })

  it('scores a partial 6 when price falls below all SMAs but SMAs remain bullish-ordered', () => {
    // 199 flat closes at 100 then one bar at 120 → sma5≈104, sma20=101, sma50=100.4, sma200≈100.1.
    // With currentPrice 99: ordered = [99, 104, 101, 100.4, 100.1]
    //   (P,*) pairs all false (4 lost). Remaining 6 SMA-vs-SMA pairs all true.
    const closes: number[] = []
    for (let i = 0; i < 199; i++) closes.push(100)
    closes.push(120)
    expect(computeSmaStructure(closes, 120).bullishScore).toBe(10)
    expect(computeSmaStructure(closes, 99).bullishScore).toBe(6)
  })

  it('returns null bullishScore when any SMA is null', () => {
    const closes = Array(50).fill(100) // sma200 unavailable
    const result = computeSmaStructure(closes, 100)
    expect(result.bullishScore).toBeNull()
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

describe('computeLinearRegression', () => {
  it('returns all nulls when data is shorter than the period', () => {
    const result = computeLinearRegression([1, 2, 3], 20)
    expect(result.slope).toBeNull()
    expect(result.slopePct).toBeNull()
    expect(result.r2).toBeNull()
  })

  it('returns all nulls for invalid period', () => {
    const result = computeLinearRegression([1, 2, 3, 4, 5], 1)
    expect(result.slope).toBeNull()
    expect(result.r2).toBeNull()
  })

  it('returns slope=1 and r2=1 for a perfectly rising line', () => {
    const closes: number[] = []
    for (let i = 1; i <= 50; i++) closes.push(i) // y = x
    const result = computeLinearRegression(closes, 50)
    expect(result.slope).toBeCloseTo(1, 8)
    expect(result.r2).toBeCloseTo(1, 8)
    // meanY = 25.5, slope = 1 → slopePct ≈ 1/25.5
    expect(result.slopePct).toBeCloseTo(1 / 25.5, 6)
  })

  it('returns negative slope and r2=1 for a perfectly falling line', () => {
    const closes: number[] = []
    for (let i = 0; i < 50; i++) closes.push(100 - i)
    const result = computeLinearRegression(closes, 50)
    expect(result.slope).toBeCloseTo(-1, 8)
    expect(result.r2).toBeCloseTo(1, 8)
    expect(result.slopePct!).toBeLessThan(0)
  })

  it('returns slope=0 and r2=null for a flat series (degenerate SS_tot)', () => {
    const closes = Array(50).fill(100)
    const result = computeLinearRegression(closes, 50)
    expect(result.slope).toBeCloseTo(0, 10)
    expect(result.r2).toBeNull()
    expect(result.slopePct).toBeCloseTo(0, 10)
  })

  it('produces correct sign and 0 < r2 < 1 for noisy upward trend', () => {
    const closes: number[] = []
    // y = i + alternating noise of ±2
    for (let i = 0; i < 50; i++) closes.push(i + (i % 2 === 0 ? 2 : -2))
    const result = computeLinearRegression(closes, 50)
    expect(result.slope!).toBeGreaterThan(0)
    expect(result.r2!).toBeGreaterThan(0)
    expect(result.r2!).toBeLessThan(1)
  })

  it('uses only the last N closes when more data is available', () => {
    // Long flat history then a sharp rise in the last 20 — slope should reflect only the last 20.
    const closes: number[] = Array(180).fill(100)
    for (let i = 0; i < 20; i++) closes.push(100 + i)
    const result = computeLinearRegression(closes, 20)
    expect(result.slope).toBeCloseTo(1, 8)
    expect(result.r2).toBeCloseTo(1, 8)
  })
})

describe('computeLinearRegressionStructure', () => {
  it('populates lr20/lr50/lr200 when given 250 points', () => {
    const closes: number[] = []
    for (let i = 0; i < 250; i++) closes.push(50 + i * 0.5)
    const result = computeLinearRegressionStructure(closes)
    expect(result.lr20.slope).not.toBeNull()
    expect(result.lr50.slope).not.toBeNull()
    expect(result.lr200.slope).not.toBeNull()
    expect(result.lr20.slope!).toBeGreaterThan(0)
    expect(result.lr200.slope!).toBeGreaterThan(0)
  })

  it('lr200 is null while lr20 and lr50 populate when given 100 points', () => {
    const closes: number[] = []
    for (let i = 0; i < 100; i++) closes.push(50 + i * 0.5)
    const result = computeLinearRegressionStructure(closes)
    expect(result.lr20.slope).not.toBeNull()
    expect(result.lr50.slope).not.toBeNull()
    expect(result.lr200.slope).toBeNull()
    expect(result.lr200.slopePct).toBeNull()
    expect(result.lr200.r2).toBeNull()
  })
})

describe('computeRsiSeries', () => {
  it('returns an all-null series shorter than period + 1', () => {
    const series = computeRsiSeries(Array(14).fill(100))
    expect(series).toHaveLength(14)
    expect(series.every((v) => v === null)).toBe(true)
  })

  it('leaves the warm-up region null and fills from index `period`', () => {
    const closes: number[] = []
    for (let i = 0; i < 30; i++) closes.push(100 + i)
    const series = computeRsiSeries(closes)
    expect(series.slice(0, 14).every((v) => v === null)).toBe(true)
    expect(series[14]).not.toBeNull()
  })

  it('returns 100 for a strictly rising series (no losses)', () => {
    const closes: number[] = []
    for (let i = 0; i < 20; i++) closes.push(100 + i)
    const series = computeRsiSeries(closes)
    expect(series[19]).toBeCloseTo(100, 8)
  })

  it('returns 0 for a strictly falling series (no gains)', () => {
    const closes: number[] = []
    for (let i = 0; i < 20; i++) closes.push(100 - i)
    const series = computeRsiSeries(closes)
    expect(series[19]).toBeCloseTo(0, 8)
  })

  it('returns 50 for a perfectly flat series', () => {
    const series = computeRsiSeries(Array(20).fill(100))
    expect(series[19]).toBeCloseTo(50, 8)
  })

  it('matches hand-computed Wilder smoothing for period 2', () => {
    // changes: +1, -1, +1, +1
    // seed: avgGain 0.5, avgLoss 0.5 -> 50
    // i3: avgGain 0.75, avgLoss 0.25 -> 75
    // i4: avgGain 0.875, avgLoss 0.125 -> 87.5
    const series = computeRsiSeries([10, 11, 10, 11, 12], 2)
    expect(series[0]).toBeNull()
    expect(series[1]).toBeNull()
    expect(series[2]).toBeCloseTo(50, 8)
    expect(series[3]).toBeCloseTo(75, 8)
    expect(series[4]).toBeCloseTo(87.5, 8)
  })
})

describe('findRsiPivots', () => {
  const dated = (n: number): DatedClose[] =>
    Array.from({ length: n }, (_, i) => ({ date: `2025-01-${String(i + 1).padStart(2, '0')}`, close: 100 + i }))

  it('detects a single swing high at the apex of a tent', () => {
    // values rise to a peak at index 10, then fall symmetrically
    const series = Array.from({ length: 21 }, (_, i) => 10 - Math.abs(i - 10))
    const { highs, lows } = findRsiPivots(series, dated(21))
    expect(highs).toHaveLength(1)
    expect(highs[0].index).toBe(10)
    expect(lows).toHaveLength(0)
  })

  it('ignores pivots within w of either edge', () => {
    // a high at index 2 cannot be confirmed with w=5
    const series = Array.from({ length: 21 }, (_, i) => (i === 2 ? 99 : 1))
    const { highs } = findRsiPivots(series, dated(21))
    expect(highs).toHaveLength(0)
  })

  it('records the local close extreme around a pivot', () => {
    const series = Array.from({ length: 21 }, (_, i) => 10 - Math.abs(i - 10))
    const closes: DatedClose[] = Array.from({ length: 21 }, (_, i) => ({
      date: `2025-01-${String(i + 1).padStart(2, '0')}`,
      close: i === 10 ? 200 : 100,
    }))
    const { highs } = findRsiPivots(series, closes)
    expect(highs[0].price).toBe(200) // max close within +/- w of the high
  })
})

describe('detectDivergenceLine', () => {
  const highs = (rows: [number, number, number][]): RsiPivot[] =>
    rows.map(([index, rsi, price]) => ({ index, rsi, price, date: `d${index}` }))

  it('flags a bearish divergence: lower RSI highs vs higher price highs', () => {
    const pivots = highs([
      [0, 80, 100],
      [10, 75, 110],
      [20, 70, 120],
    ])
    const sig = detectDivergenceLine(pivots, true)
    expect(sig).not.toBeNull()
    expect(sig!.rsiSlope).toBeLessThan(0)
    expect(sig!.pivots.map((p) => p.date)).toEqual(['d0', 'd10', 'd20']) // from, touch, pf
    expect(sig!.touchCount).toBe(3)
    expect(sig!.strength).toBe('moderate')
  })

  it('flags a bullish divergence: higher RSI lows vs lower price lows', () => {
    const pivots = highs([
      [0, 30, 120],
      [10, 35, 110],
      [20, 40, 100],
    ])
    const sig = detectDivergenceLine(pivots, false)
    expect(sig).not.toBeNull()
    expect(sig!.rsiSlope).toBeGreaterThan(0)
    expect(sig!.strength).toBe('moderate')
  })

  it('grades a clean 4-touch trendline as strong', () => {
    const pivots = highs([
      [0, 80, 100],
      [10, 75, 110],
      [20, 70, 115],
      [30, 65, 120],
    ])
    const sig = detectDivergenceLine(pivots, true)
    expect(sig!.touchCount).toBe(4)
    expect(sig!.pivots).toHaveLength(4) // every pivot lies on the line
    expect(sig!.strength).toBe('strong')
  })

  it('grades a bare two-pivot line as weak', () => {
    const pivots = highs([
      [0, 80, 100],
      [10, 70, 110],
    ])
    const sig = detectDivergenceLine(pivots, true)
    expect(sig!.touchCount).toBe(2)
    expect(sig!.strength).toBe('weak')
  })

  it('returns null when RSI highs are not descending', () => {
    const pivots = highs([
      [0, 70, 100],
      [10, 75, 110],
    ])
    expect(detectDivergenceLine(pivots, true)).toBeNull()
  })

  it('returns null when price does not confirm (no higher high)', () => {
    const pivots = highs([
      [0, 80, 120],
      [10, 70, 110],
    ])
    expect(detectDivergenceLine(pivots, true)).toBeNull()
  })

  it('returns null with fewer than two pivots', () => {
    expect(detectDivergenceLine(highs([[10, 70, 100]]), true)).toBeNull()
  })
})

describe('computeRsi', () => {
  it('produces a series aligned to the input and a non-null latest value', () => {
    const datedCloses: DatedClose[] = Array.from({ length: 60 }, (_, i) => ({
      date: `2025-01-${String(i + 1).padStart(2, '0')}`,
      close: 100 + Math.sin(i / 3) * 5,
    }))
    const rsi = computeRsi(datedCloses)
    expect(rsi.series).toHaveLength(60)
    expect(rsi.latest).not.toBeNull()
    expect(rsi.latest!).toBeGreaterThanOrEqual(0)
    expect(rsi.latest!).toBeLessThanOrEqual(100)
  })

  it('exposes swing pivots with dates for manual inspection', () => {
    // a sine wave yields alternating RSI swing highs and lows
    const datedCloses: DatedClose[] = Array.from({ length: 120 }, (_, i) => ({
      date: `2025-${String(Math.floor(i / 28) + 1).padStart(2, '0')}-${String((i % 28) + 1).padStart(2, '0')}`,
      close: 100 + Math.sin(i / 4) * 8,
    }))
    const rsi = computeRsi(datedCloses)
    expect(rsi.pivots.highs.length).toBeGreaterThan(0)
    expect(rsi.pivots.lows.length).toBeGreaterThan(0)
    for (const p of [...rsi.pivots.highs, ...rsi.pivots.lows]) {
      expect(p.date).toBe(datedCloses[p.index].date)
    }
  })

  it('reports no divergence and a null latest for empty input', () => {
    const rsi = computeRsi([])
    expect(rsi.series).toHaveLength(0)
    expect(rsi.latest).toBeNull()
    expect(rsi.divergence.bearish).toBeNull()
    expect(rsi.divergence.bullish).toBeNull()
  })
})
