import { describe, it, expect } from 'vitest'
import { Decimal } from '../../domain/shared/Decimal'
import {
  computeDaysToTarget,
  formatTimelineCell,
  RECEDING_MARK,
  computeDrift,
  formatDriftText,
  type TimelineRange,
} from '../timelineExpectations'

const d = (n: number) => Decimal.from(n)

const range = (lo: number | null, hi: number | null): TimelineRange => ({
  a: lo,
  b: hi,
  lo,
  hi,
  text: '',
})

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

describe('computeDrift', () => {
  it('classifies fully ahead when dynamic is entirely sooner than projected', () => {
    const dyn = range(5, 20)
    const proj = range(30, 60)
    const drift = computeDrift(dyn, proj)
    expect(drift).not.toBeNull()
    expect(drift!.state).toBe('ahead')
    expect(drift!.lo).toBe(5 - 60)
    expect(drift!.hi).toBe(20 - 30)
  })

  it('classifies fully behind when dynamic is entirely later than projected', () => {
    const dyn = range(50, 100)
    const proj = range(10, 20)
    const drift = computeDrift(dyn, proj)
    expect(drift!.state).toBe('behind')
    expect(drift!.lo).toBe(50 - 20)
    expect(drift!.hi).toBe(100 - 10)
  })

  it('classifies on-pace when ranges overlap', () => {
    const dyn = range(5, 25)
    const proj = range(10, 30)
    const drift = computeDrift(dyn, proj)
    expect(drift!.state).toBe('on-pace')
    expect(drift!.lo).toBe(5 - 30)
    expect(drift!.hi).toBe(25 - 10)
  })

  it('returns null when either side lacks numeric bounds', () => {
    expect(computeDrift(range(null, null), range(5, 10))).toBeNull()
    expect(computeDrift(range(5, 10), range(null, null))).toBeNull()
  })
})

describe('formatDriftText', () => {
  it('formats ahead as a positive magnitude range with "ahead" prefix', () => {
    expect(formatDriftText({ lo: -55, hi: -10, state: 'ahead' })).toBe('ahead 10–55d')
  })

  it('collapses equal ahead bounds', () => {
    expect(formatDriftText({ lo: -5, hi: -5, state: 'ahead' })).toBe('ahead 5d')
  })

  it('formats behind as a positive magnitude range with "behind" prefix', () => {
    expect(formatDriftText({ lo: 30, hi: 90, state: 'behind' })).toBe('behind 30–90d')
  })

  it('formats on-pace with signed bounds', () => {
    expect(formatDriftText({ lo: -25, hi: 15, state: 'on-pace' })).toBe('-25…+15d (on pace)')
  })
})
