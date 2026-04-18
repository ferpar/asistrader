import { describe, it, expect } from 'vitest'
import { Decimal } from '../../domain/shared/Decimal'
import { computeDaysToTarget, computeDaysRange, formatDaysRange } from '../timelineExpectations'

const d = (n: number) => Decimal.from(n)

describe('computeDaysToTarget', () => {
  it('divides absolute distance by absolute speed', () => {
    // |100 - 110| / |0.5| = 20
    expect(computeDaysToTarget(d(100), d(110), 0.5)).toBeCloseTo(20, 5)
  })

  it('ignores sign of speed (treated as pace, not direction)', () => {
    expect(computeDaysToTarget(d(100), d(110), -0.5)).toBeCloseTo(20, 5)
  })

  it('returns 0 when current equals target', () => {
    expect(computeDaysToTarget(d(100), d(100), 1)).toBe(0)
  })

  it('returns null for null speed', () => {
    expect(computeDaysToTarget(d(100), d(110), null)).toBeNull()
  })

  it('returns null for zero speed', () => {
    expect(computeDaysToTarget(d(100), d(110), 0)).toBeNull()
  })
})

describe('computeDaysRange', () => {
  it('returns [min, max] across the two speeds', () => {
    // distance 10. speedA=0.5 → 20d. speedB=2 → 5d. Range = {5, 20}.
    const r = computeDaysRange(d(100), d(110), 0.5, 2)
    expect(r).toEqual({ min: 5, max: 20 })
  })

  it('degenerates to a single value when one speed is null', () => {
    const r = computeDaysRange(d(100), d(110), null, 2)
    expect(r).toEqual({ min: 5, max: 5 })
  })

  it('returns null when both speeds are null', () => {
    expect(computeDaysRange(d(100), d(110), null, null)).toBeNull()
  })

  it('returns null when both speeds are zero', () => {
    expect(computeDaysRange(d(100), d(110), 0, 0)).toBeNull()
  })

  it('returns {0, 0} when current equals target regardless of speed', () => {
    expect(computeDaysRange(d(100), d(100), 0.5, 2)).toEqual({ min: 0, max: 0 })
  })
})

describe('formatDaysRange', () => {
  it('returns "-" for null', () => {
    expect(formatDaysRange(null)).toBe('-')
  })

  it('formats a two-valued range', () => {
    expect(formatDaysRange({ min: 3, max: 8 })).toBe('3–8d')
  })

  it('collapses equal min/max', () => {
    expect(formatDaysRange({ min: 5, max: 5 })).toBe('5d')
  })

  it('renders sub-day values as <1', () => {
    expect(formatDaysRange({ min: 0, max: 0 })).toBe('<1d')
    expect(formatDaysRange({ min: 0.3, max: 0.4 })).toBe('<1d')
  })

  it('rounds fractional days', () => {
    expect(formatDaysRange({ min: 1.4, max: 7.6 })).toBe('1–8d')
  })
})
