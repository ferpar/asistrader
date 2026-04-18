import { describe, it, expect } from 'vitest'
import { Decimal } from '../../domain/shared/Decimal'
import { computeDaysToTarget, formatTimelineCell, RECEDING_MARK } from '../timelineExpectations'

const d = (n: number) => Decimal.from(n)

describe('computeDaysToTarget', () => {
  it('divides absolute distance by absolute speed when direction matches', () => {
    // target above current + positive speed → reaching
    expect(computeDaysToTarget(d(100), d(110), 0.5)).toBeCloseTo(20, 5)
  })

  it('returns "receding" when speed moves away from target', () => {
    // target above current but speed is negative → moving away
    expect(computeDaysToTarget(d(100), d(110), -0.5)).toBe('receding')
    // target below current but speed is positive → moving away
    expect(computeDaysToTarget(d(100), d(90), 0.5)).toBe('receding')
  })

  it('handles target below current with negative speed as reaching', () => {
    expect(computeDaysToTarget(d(100), d(90), -0.5)).toBeCloseTo(20, 5)
  })

  it('returns 0 when current equals target', () => {
    expect(computeDaysToTarget(d(100), d(100), 1)).toBe(0)
    expect(computeDaysToTarget(d(100), d(100), -1)).toBe(0)
  })

  it('returns null for null or zero speed', () => {
    expect(computeDaysToTarget(d(100), d(110), null)).toBeNull()
    expect(computeDaysToTarget(d(100), d(110), 0)).toBeNull()
  })
})

describe('formatTimelineCell', () => {
  it('returns "-" when both inputs are null', () => {
    expect(formatTimelineCell(null, null)).toBe('-')
  })

  it('renders a two-speed reaching range as min–max', () => {
    expect(formatTimelineCell(20, 5)).toBe('5–20d')
  })

  it('collapses equal reaching values', () => {
    expect(formatTimelineCell(5, 5)).toBe('5d')
  })

  it('renders a single numeric value when the other is null', () => {
    expect(formatTimelineCell(5, null)).toBe('5d')
    expect(formatTimelineCell(null, 8)).toBe('8d')
  })

  it('marks fully-receding as the receding symbol alone', () => {
    expect(formatTimelineCell('receding', 'receding')).toBe(RECEDING_MARK)
  })

  it('combines a reaching value with a receding marker when speeds disagree', () => {
    expect(formatTimelineCell(5, 'receding')).toBe(`5d ${RECEDING_MARK}`)
    expect(formatTimelineCell('receding', 8)).toBe(`8d ${RECEDING_MARK}`)
  })

  it('treats receding + null as receding', () => {
    expect(formatTimelineCell('receding', null)).toBe(RECEDING_MARK)
    expect(formatTimelineCell(null, 'receding')).toBe(RECEDING_MARK)
  })

  it('renders sub-day values as <1', () => {
    expect(formatTimelineCell(0, 0)).toBe('<1d')
    expect(formatTimelineCell(0.3, 0.4)).toBe('<1d')
  })

  it('rounds fractional days', () => {
    expect(formatTimelineCell(1.4, 7.6)).toBe('1–8d')
  })
})
