import { describe, it, expect } from 'vitest'
import { computeOpenHealthScore, type OpenHealthInputs } from '../openHealthScore'
import {
  buildSmaStructure,
  buildPriceChanges,
  buildLinearRegressionResult,
  buildRsiIndicator,
} from '../testing/fixtures'
import type { TradeEtaCell } from '../tradeEta'

function makeEta(overrides?: Partial<TradeEtaCell>): TradeEtaCell {
  return {
    dynamic: { a: null, b: null, lo: null, hi: null, text: '' },
    projected: { a: null, b: null, lo: null, hi: null, text: '' },
    drift: { lo: 0, hi: 0, state: 'on-pace' },
    projectedState: 'ok',
    badge: 'on pace',
    tooltip: '',
    ...overrides,
  }
}

function baseInputs(overrides?: Partial<OpenHealthInputs>): OpenHealthInputs {
  return {
    segment: 'profit',
    isLong: true,
    tpEta: makeEta(),
    slEta: makeEta(),
    priceChanges: buildPriceChanges({ avgChangePct5d: 0 }),
    sma: buildSmaStructure({ bullishScore: 5 }),
    lr20: buildLinearRegressionResult({ slopePct: 0 }),
    rsi: buildRsiIndicator(),
    ...overrides,
  }
}

const ahead = makeEta({ drift: { lo: -5, hi: -1, state: 'ahead' }, badge: 'ahead' })

describe('computeOpenHealthScore', () => {
  it('returns null when every component is missing', () => {
    const out = computeOpenHealthScore({
      segment: 'flat',
      isLong: true,
      tpEta: null,
      slEta: null,
      priceChanges: null,
      sma: null,
      lr20: null,
      rsi: null,
    })
    expect(out).toBeNull()
  })

  it('scores near zero when every signal is neutral', () => {
    const out = computeOpenHealthScore(baseInputs())
    expect(out).not.toBeNull()
    expect(Math.abs(out!.score)).toBeLessThan(5)
    expect(out!.confidence).toBe('high')
  })

  it('in profit, drift ahead toward TP lifts the score positive', () => {
    const out = computeOpenHealthScore(baseInputs({ segment: 'profit', tpEta: ahead }))
    expect(out!.score).toBeGreaterThan(20)
    expect(out!.components.find((c) => c.key === 'drift')!.contribution).toBe(30)
  })

  it('in loss, drift ahead toward SL pushes the score negative', () => {
    const out = computeOpenHealthScore(baseInputs({ segment: 'loss', slEta: ahead }))
    expect(out!.score).toBeLessThan(-20)
    expect(out!.components.find((c) => c.key === 'drift')!.contribution).toBe(-30)
  })

  it('SMA stack is read relative to trade direction (toward TP)', () => {
    const long = computeOpenHealthScore(baseInputs({ isLong: true, sma: buildSmaStructure({ bullishScore: 10 }) }))
    expect(long!.components.find((c) => c.key === 'sma')!.raw).toBe(1)

    const short = computeOpenHealthScore(baseInputs({ isLong: false, sma: buildSmaStructure({ bullishScore: 10 }) }))
    expect(short!.components.find((c) => c.key === 'sma')!.raw).toBe(-1)
  })

  it('momentum favours the trade direction', () => {
    // A long rising 1%/day is heading toward TP → positive.
    const long = computeOpenHealthScore(
      baseInputs({ isLong: true, priceChanges: buildPriceChanges({ avgChangePct5d: 0.01 }) }),
    )
    expect(long!.components.find((c) => c.key === 'momentum')!.raw!).toBeGreaterThan(0)

    // A short rising 1%/day is heading toward SL → negative.
    const short = computeOpenHealthScore(
      baseInputs({ isLong: false, priceChanges: buildPriceChanges({ avgChangePct5d: 0.01 }) }),
    )
    expect(short!.components.find((c) => c.key === 'momentum')!.raw!).toBeLessThan(0)
  })

  it('downgrades confidence when only one supporting component has data', () => {
    const out = computeOpenHealthScore({
      segment: 'profit',
      isLong: true,
      tpEta: null,
      slEta: null,
      priceChanges: null,
      sma: buildSmaStructure(),
      lr20: null,
      rsi: null,
    })
    expect(out).not.toBeNull()
    expect(out!.confidence).toBe('low')
  })
})
