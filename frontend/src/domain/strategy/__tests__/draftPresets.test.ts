import { describe, it, expect } from 'vitest'
import {
  PRESET_ORDER,
  buildStrategySnapshot,
  defaultPreset,
  isDraftable,
  orderedPresets,
  presetByKind,
} from '../draftPresets'
import type { DraftPreset, DraftPresetKind, DraftResult } from '../types'

function preset(kind: DraftPresetKind, d2: number): DraftPreset {
  return {
    kind,
    d2,
    winRate: 0.6,
    expectancy: 0.02,
    expectancyPerDay: 0.002,
    efficiency: 0.0015,
    winRateCi: [0.5, 0.7],
    efficiencyCi: [0.001, 0.002],
    nTrials: 120,
    entry: 100,
    stopLoss: 96,
    takeProfit: 106,
  }
}

function result(presets: DraftPreset[], overrides: Partial<DraftResult> = {}): DraftResult {
  return {
    confident: true,
    reason: null,
    breakevenWinRate: 0.4,
    fillRate: 0.8,
    ticker: 'AAA',
    lastBarDate: '2026-06-16',
    referencePrice: 100,
    referencePriceLive: true,
    speed: 0.01,
    engineLabel: 'Historical Expected Days',
    engineDescription: 'desc',
    presets,
    candidates: [],
    ...overrides,
  }
}

describe('orderedPresets', () => {
  it('sorts into aggressive -> regular -> conservative', () => {
    const r = result([preset('conservative', 30), preset('regular', 15), preset('aggressive', 5)])
    expect(orderedPresets(r).map((p) => p.kind)).toEqual(PRESET_ORDER)
  })
})

describe('defaultPreset', () => {
  it('prefers regular', () => {
    const r = result([preset('aggressive', 5), preset('regular', 15)])
    expect(defaultPreset(r)?.kind).toBe('regular')
  })

  it('falls back to the first ordered preset when no regular', () => {
    const r = result([preset('conservative', 30), preset('aggressive', 5)])
    expect(defaultPreset(r)?.kind).toBe('aggressive')
  })

  it('returns null when there are no presets', () => {
    expect(defaultPreset(result([]))).toBeNull()
  })
})

describe('presetByKind', () => {
  it('finds the requested kind', () => {
    const r = result([preset('regular', 15), preset('aggressive', 5)])
    expect(presetByKind(r, 'aggressive')?.d2).toBe(5)
    expect(presetByKind(r, 'conservative')).toBeUndefined()
  })
})

describe('isDraftable', () => {
  it('is true only when confident with presets', () => {
    expect(isDraftable(result([preset('regular', 15)]))).toBe(true)
    expect(isDraftable(result([], { confident: false, reason: 'thin' }))).toBe(false)
    expect(isDraftable(result([preset('regular', 15)], { confident: false }))).toBe(false)
  })
})

describe('buildStrategySnapshot', () => {
  it('captures the preset, plr, expectations and sweep date', () => {
    const r = result([preset('regular', 15)])
    const snap = buildStrategySnapshot(r, r.presets[0], 1.5, 1)
    expect(snap).toMatchObject({
      preset: 'regular',
      d2: 15,
      d1: 1,
      plr_used: 1.5,
      expected_win_rate: 0.6,
      fill_rate: 0.8,
      breakeven_win_rate: 0.4,
      sweep_last_bar_date: '2026-06-16',
    })
  })
})
