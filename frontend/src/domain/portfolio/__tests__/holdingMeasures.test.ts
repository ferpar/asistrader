import { describe, expect, it } from 'vitest'
import { buildTickerIndicators } from '../../radar/indicatorBuild'
import type { DatedClose } from '../../radar/types'
import { holdingMeasures } from '../holdingMeasures'

/**
 * 300 trading days of a steady climb: raw close = 100 + i (so the last 50
 * closes run 350..399, mean 374.5, slope 1/day, a perfect fit). Adjusted closes
 * are 100 except latest = 120, 63 back = 80, 126 back = 60, 252 back = 50,
 * giving a Momentum Score of 0.35·0.2 + 0.30·0.5 + 0.20·1.0 + 0.15·1.4 = 0.63.
 */
const ADJ: Record<number, number> = { 299: 120, 236: 80, 173: 60, 47: 50 }
function climbing(n = 300): DatedClose[] {
  const start = Date.UTC(2024, 0, 1)
  return Array.from({ length: n }, (_, i) => ({
    date: new Date(start + i * 86_400_000).toISOString().slice(0, 10),
    close: 100 + i,
    adjClose: ADJ[i] ?? 100,
  }))
}

describe('holdingMeasures', () => {
  it("reads a Holding's Momentum Score and radar measures from its ticker's indicators", () => {
    const m = holdingMeasures(buildTickerIndicators('KO', climbing(), null))
    expect(m.momentum).toBeCloseTo(0.63, 10)
    expect(m.bullishScore).toBe(10)
    expect(m.lrSlopePct).toBeCloseTo(1 / 374.5, 12)
    expect(m.lrR2).toBeCloseTo(1, 12)
    expect(m.tir).toBeCloseTo(365 / 374.5, 10)
    expect(m.rsi).toBe(100)
  })

  it('has every measure empty when the ticker has no indicators yet', () => {
    expect(holdingMeasures(undefined)).toEqual({
      momentum: null,
      bullishScore: null,
      lrSlopePct: null,
      lrR2: null,
      tir: null,
      rsi: null,
    })
  })
})
