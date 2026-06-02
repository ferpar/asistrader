import { describe, it, expect } from 'vitest'
import { fillsOnRise, deriveOrderType, wouldAutoSettle } from '../orderType'

describe('fillsOnRise', () => {
  it('matches the backend truth table', () => {
    expect(fillsOnRise('long', 'limit')).toBe(false) // dip to entry
    expect(fillsOnRise('long', 'stop')).toBe(true) // break up to entry
    expect(fillsOnRise('short', 'limit')).toBe(true) // rise to entry
    expect(fillsOnRise('short', 'stop')).toBe(false) // break down to entry
  })
})

describe('deriveOrderType', () => {
  // entry below current -> price must fall to reach it
  it('long with entry below current -> limit', () => {
    expect(deriveOrderType('long', 90, 100)).toBe('limit')
  })
  it('short with entry below current -> stop', () => {
    expect(deriveOrderType('short', 90, 100)).toBe('stop')
  })
  // entry above current -> price must rise to reach it
  it('long with entry above current -> stop', () => {
    expect(deriveOrderType('long', 110, 100)).toBe('stop')
  })
  it('short with entry above current -> limit', () => {
    expect(deriveOrderType('short', 110, 100)).toBe('limit')
  })
  it('returns null when entry equals current (ambiguous)', () => {
    expect(deriveOrderType('long', 100, 100)).toBeNull()
    expect(deriveOrderType('short', 100, 100)).toBeNull()
  })

  it('the derived type never auto-settles', () => {
    for (const [dir, entry, current] of [
      ['long', 90, 100],
      ['long', 110, 100],
      ['short', 90, 100],
      ['short', 110, 100],
    ] as const) {
      const derived = deriveOrderType(dir, entry, current)!
      expect(wouldAutoSettle(dir, derived, entry, current)).toBe(false)
    }
  })
})

describe('wouldAutoSettle', () => {
  it('flags a long limit placed above the current price', () => {
    // long limit fills on a dip; if entry is already above current it fills now
    expect(wouldAutoSettle('long', 'limit', 110, 100)).toBe(true)
    expect(wouldAutoSettle('long', 'limit', 90, 100)).toBe(false)
  })
  it('flags a long stop placed below the current price', () => {
    expect(wouldAutoSettle('long', 'stop', 90, 100)).toBe(true)
    expect(wouldAutoSettle('long', 'stop', 110, 100)).toBe(false)
  })
  it('flags a short limit placed below the current price', () => {
    expect(wouldAutoSettle('short', 'limit', 90, 100)).toBe(true)
    expect(wouldAutoSettle('short', 'limit', 110, 100)).toBe(false)
  })
  it('flags a short stop placed above the current price', () => {
    expect(wouldAutoSettle('short', 'stop', 110, 100)).toBe(true)
    expect(wouldAutoSettle('short', 'stop', 90, 100)).toBe(false)
  })
  it('never flags a market order', () => {
    expect(wouldAutoSettle('long', 'market', 110, 100)).toBe(false)
    expect(wouldAutoSettle('short', 'market', 90, 100)).toBe(false)
  })
})
