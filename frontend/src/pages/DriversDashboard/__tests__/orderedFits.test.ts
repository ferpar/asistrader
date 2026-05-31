import { describe, it, expect } from 'vitest'
import { computeFit, linearFit, localMean, quadraticFit } from '../orderedFits'

describe('linearFit', () => {
  it('returns the input unchanged for fewer than 2 points', () => {
    expect(linearFit([])).toEqual([])
    expect(linearFit([5])).toEqual([5])
  })

  it('recovers an exact linear relationship', () => {
    // y = 2x + 3
    const ys = [3, 5, 7, 9, 11]
    const out = linearFit(ys)
    expect(out[0]).toBeCloseTo(3)
    expect(out[4]).toBeCloseTo(11)
  })

  it('returns the mean line when y is constant', () => {
    const ys = [4, 4, 4, 4]
    expect(linearFit(ys).every((v) => Math.abs(v - 4) < 1e-9)).toBe(true)
  })
})

describe('quadraticFit', () => {
  it('falls back to a line when fewer than 3 points', () => {
    expect(quadraticFit([1, 3])).toEqual(linearFit([1, 3]))
  })

  it('recovers an exact quadratic relationship', () => {
    // y = x^2 + 1 over x = 0..4
    const ys = [1, 2, 5, 10, 17]
    const out = quadraticFit(ys)
    for (let i = 0; i < ys.length; i++) {
      expect(out[i]).toBeCloseTo(ys[i], 6)
    }
  })

  it('still produces a reasonable fit on noisy data', () => {
    // Quadratic plus small noise — the fit should sit near the true values.
    const truth = [1, 2, 5, 10, 17, 26]
    const ys = [1.2, 1.8, 5.1, 9.9, 17.2, 25.7]
    const out = quadraticFit(ys)
    for (let i = 0; i < truth.length; i++) {
      expect(Math.abs(out[i] - truth[i])).toBeLessThan(0.5)
    }
  })
})

describe('localMean', () => {
  it('averages over the window, clamping at boundaries', () => {
    const ys = [1, 2, 3, 4, 5]
    // radius 1 → window of 3, clamped: [1.5, 2, 3, 4, 4.5]
    expect(localMean(ys, 1)).toEqual([1.5, 2, 3, 4, 4.5])
  })

  it('returns the global mean when radius spans the whole array', () => {
    const ys = [10, 20, 30]
    const out = localMean(ys, 99)
    expect(out.every((v) => Math.abs(v - 20) < 1e-9)).toBe(true)
  })

  it('handles an empty input', () => {
    expect(localMean([], 5)).toEqual([])
  })
})

describe('computeFit', () => {
  it('returns null when mode is off', () => {
    expect(computeFit([1, 2, 3], 'off')).toBeNull()
  })

  it('returns null for too few points', () => {
    expect(computeFit([], 'linear')).toBeNull()
    expect(computeFit([5], 'quadratic')).toBeNull()
  })

  it('dispatches to the correct fitter', () => {
    const ys = [1, 2, 5, 10, 17]
    expect(computeFit(ys, 'linear')).toEqual(linearFit(ys))
    expect(computeFit(ys, 'quadratic')).toEqual(quadraticFit(ys))
    expect(computeFit(ys, 'local', 1)).toEqual(localMean(ys, 1))
  })
})
