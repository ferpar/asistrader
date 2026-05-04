import { describe, it, expect } from 'vitest'
import { parseDateOnly, localTodayIso, toLocalDateIso } from '../dateOnly'

describe('parseDateOnly', () => {
  it('returns a Date that renders as the same day in local time', () => {
    const d = parseDateOnly('2026-04-04')
    expect(d.getFullYear()).toBe(2026)
    expect(d.getMonth()).toBe(3)  // April = index 3
    expect(d.getDate()).toBe(4)
  })

  it('puts the time at noon to dodge DST/UTC boundary issues', () => {
    const d = parseDateOnly('2026-04-04')
    expect(d.getHours()).toBe(12)
    expect(d.getMinutes()).toBe(0)
  })

  it('passes ISO strings with time component through unchanged', () => {
    const iso = '2026-04-04T15:30:00Z'
    const d = parseDateOnly(iso)
    // Same instant as new Date(iso); we don't touch full timestamps.
    expect(d.toISOString()).toBe(new Date(iso).toISOString())
  })
})

describe('toLocalDateIso', () => {
  it('formats a Date as YYYY-MM-DD in the local zone', () => {
    const d = new Date(2026, 3, 4, 15, 30, 0)  // local time 2026-04-04 15:30
    expect(toLocalDateIso(d)).toBe('2026-04-04')
  })

  it('zero-pads single-digit months and days', () => {
    const d = new Date(2026, 0, 5)  // 2026-01-05
    expect(toLocalDateIso(d)).toBe('2026-01-05')
  })

  it('round-trips with parseDateOnly', () => {
    const original = '2026-04-04'
    expect(toLocalDateIso(parseDateOnly(original))).toBe(original)
  })
})

describe('localTodayIso', () => {
  it("returns today's local date as YYYY-MM-DD", () => {
    const today = new Date()
    const expected =
      `${today.getFullYear()}-` +
      `${String(today.getMonth() + 1).padStart(2, '0')}-` +
      `${String(today.getDate()).padStart(2, '0')}`
    expect(localTodayIso()).toBe(expected)
  })
})
