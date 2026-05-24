import { describe, it, expect } from 'vitest'
import {
  cumulative,
  histogramBins,
  mean,
  normalCurve,
  normalPdf,
  rollingNormalParams,
  simpleMovingAverage,
  stdDev,
} from '../stats'

describe('mean', () => {
  it('averages the values', () => {
    expect(mean([2, 4, 6])).toBe(4)
  })

  it('returns 0 for an empty input', () => {
    expect(mean([])).toBe(0)
  })
})

describe('stdDev', () => {
  it('computes the sample standard deviation (n - 1)', () => {
    // values 2,4,4,4,5,5,7,9 -> sample std 2.13809...
    expect(stdDev([2, 4, 4, 4, 5, 5, 7, 9])).toBeCloseTo(2.13809, 4)
  })

  it('returns 0 for fewer than two values', () => {
    expect(stdDev([])).toBe(0)
    expect(stdDev([42])).toBe(0)
  })

  it('accepts a precomputed mean', () => {
    const values = [1, 2, 3, 4]
    expect(stdDev(values, mean(values))).toBeCloseTo(stdDev(values), 10)
  })
})

describe('histogramBins', () => {
  it('bins values into equal-width buckets that cover the full range', () => {
    const bins = histogramBins([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 5)
    expect(bins).toHaveLength(5)
    expect(bins[0].x0).toBe(0)
    expect(bins[bins.length - 1].x1).toBe(10)
    // Every value is accounted for exactly once.
    expect(bins.reduce((s, b) => s + b.count, 0)).toBe(11)
  })

  it('includes the maximum value in the last (right-closed) bin', () => {
    const bins = histogramBins([1, 2, 3, 4], 3)
    expect(bins[bins.length - 1].count).toBeGreaterThan(0)
    expect(bins.reduce((s, b) => s + b.count, 0)).toBe(4)
  })

  it('collapses identical values into a single bin', () => {
    const bins = histogramBins([5, 5, 5])
    expect(bins).toHaveLength(1)
    expect(bins[0].count).toBe(3)
  })

  it('returns no bins for an empty input', () => {
    expect(histogramBins([])).toEqual([])
  })
})

describe('cumulative', () => {
  it('accumulates counts and fractions up to each bin edge', () => {
    const bins = histogramBins([0, 1, 2, 3, 4, 5, 6, 7, 8, 9], 5)
    const cdf = cumulative(bins)
    expect(cdf[cdf.length - 1].count).toBe(10)
    expect(cdf[cdf.length - 1].fraction).toBeCloseTo(1, 10)
    // Running count is monotonically non-decreasing.
    for (let i = 1; i < cdf.length; i++) {
      expect(cdf[i].count).toBeGreaterThanOrEqual(cdf[i - 1].count)
    }
  })
})

describe('normalPdf', () => {
  it('peaks at the mean', () => {
    const peak = normalPdf(0, 0, 1)
    expect(peak).toBeCloseTo(0.3989, 4)
    expect(normalPdf(1, 0, 1)).toBeLessThan(peak)
  })

  it('returns 0 for a non-positive sigma', () => {
    expect(normalPdf(0, 0, 0)).toBe(0)
  })
})

describe('normalCurve', () => {
  it('samples the curve across the requested range', () => {
    const pts = normalCurve(0, 1, -3, 3, 12)
    expect(pts).toHaveLength(13)
    expect(pts[0].x).toBe(-3)
    expect(pts[pts.length - 1].x).toBe(3)
  })

  it('returns no points for a degenerate distribution', () => {
    expect(normalCurve(0, 0, -1, 1)).toEqual([])
  })
})

describe('rollingNormalParams', () => {
  it('produces one expanding-window fit per day', () => {
    const params = rollingNormalParams([2, 4, 6])
    expect(params).toHaveLength(3)
    expect(params[0]).toEqual({ mean: 2, std: 0 }) // single value
    expect(params[1].mean).toBe(3) // mean of [2,4]
    expect(params[2].mean).toBe(4) // mean of [2,4,6]
    expect(params[2].std).toBeCloseTo(stdDev([2, 4, 6]), 10)
  })

  it('returns an empty array for no values', () => {
    expect(rollingNormalParams([])).toEqual([])
  })
})

describe('simpleMovingAverage', () => {
  it('null-fills the first window-1 positions', () => {
    expect(simpleMovingAverage([1, 2, 3, 4, 5], 3)).toEqual([null, null, 2, 3, 4])
  })

  it('window of 1 mirrors the input', () => {
    expect(simpleMovingAverage([5, 7, 9], 1)).toEqual([5, 7, 9])
  })

  it('window larger than input yields all nulls', () => {
    expect(simpleMovingAverage([1, 2], 5)).toEqual([null, null])
  })

  it('window < 1 yields all nulls', () => {
    expect(simpleMovingAverage([1, 2, 3], 0)).toEqual([null, null, null])
  })

  it('matches the textbook mean at each window', () => {
    const v = [10, 20, 30, 40, 50, 60]
    expect(simpleMovingAverage(v, 4)).toEqual([null, null, null, 25, 35, 45])
  })
})
