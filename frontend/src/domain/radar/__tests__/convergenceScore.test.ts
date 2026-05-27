import { describe, it, expect } from 'vitest'
import {
  computeConvergenceScore,
  convergenceBand,
  type ConvergenceInputs,
} from '../convergenceScore'
import {
  buildSmaStructure,
  buildPriceChanges,
  buildLinearRegressionResult,
  buildRsiIndicator,
  buildDivergenceSignal,
} from '../testing/fixtures'
import type { TradeEtaCell } from '../tradeEta'

function makePeEta(overrides?: Partial<TradeEtaCell>): TradeEtaCell {
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

function baseInputs(overrides?: Partial<ConvergenceInputs>): ConvergenceInputs {
  return {
    isLong: true,
    positionPct: 0.05,
    peEta: makePeEta(),
    priceChanges: buildPriceChanges({ avgChangePct5d: 0 }),
    sma: buildSmaStructure({ bullishScore: 5 }),
    lr20: buildLinearRegressionResult({ slopePct: 0 }),
    rsi: buildRsiIndicator(),
    ...overrides,
  }
}

describe('computeConvergenceScore', () => {
  it('returns null when every component is missing', () => {
    const out = computeConvergenceScore({
      isLong: true,
      positionPct: null,
      peEta: null,
      priceChanges: null,
      sma: null,
      lr20: null,
      rsi: null,
    })
    expect(out).toBeNull()
  })

  it('scores near zero when every signal is neutral', () => {
    const out = computeConvergenceScore(baseInputs())
    expect(out).not.toBeNull()
    expect(Math.abs(out!.score)).toBeLessThan(5)
    expect(out!.confidence).toBe('high')
  })

  it('drift "ahead" lifts the score positive', () => {
    const out = computeConvergenceScore(
      baseInputs({ peEta: makePeEta({ drift: { lo: -5, hi: -1, state: 'ahead' }, badge: 'ahead' }) }),
    )
    expect(out!.score).toBeGreaterThan(20)
    expect(out!.components.find((c) => c.key === 'drift')!.contribution).toBe(30)
  })

  it('drift "behind" pushes the score negative', () => {
    const out = computeConvergenceScore(
      baseInputs({ peEta: makePeEta({ drift: { lo: 2, hi: 5, state: 'behind' }, badge: 'behind' }) }),
    )
    expect(out!.score).toBeLessThan(-20)
    expect(out!.components.find((c) => c.key === 'drift')!.contribution).toBe(-30)
  })

  it('5d momentum toward PE (price above PE, falling) reads positive', () => {
    const out = computeConvergenceScore(
      baseInputs({ positionPct: 0.05, priceChanges: buildPriceChanges({ avgChangePct5d: -0.01 }) }),
    )
    const m = out!.components.find((c) => c.key === 'momentum')!
    expect(m.raw!).toBeGreaterThan(0)
    expect(m.contribution).toBeGreaterThan(0)
  })

  it('5d momentum away from PE reads negative', () => {
    const out = computeConvergenceScore(
      baseInputs({ positionPct: -0.05, priceChanges: buildPriceChanges({ avgChangePct5d: -0.01 }) }),
    )
    const m = out!.components.find((c) => c.key === 'momentum')!
    expect(m.raw!).toBeLessThan(0)
  })

  it('SMA alignment flips sign by trade direction', () => {
    const longOut = computeConvergenceScore(baseInputs({ isLong: true, sma: buildSmaStructure({ bullishScore: 10 }) }))
    const shortOut = computeConvergenceScore(baseInputs({ isLong: false, sma: buildSmaStructure({ bullishScore: 10 }) }))
    expect(longOut!.components.find((c) => c.key === 'sma')!.raw).toBe(1)
    expect(shortOut!.components.find((c) => c.key === 'sma')!.raw).toBe(-1)
  })

  it('RSI counter-signal is a penalty only', () => {
    // Long trade with a bearish divergence → counter-signal penalty.
    const withBear = computeConvergenceScore(
      baseInputs({
        rsi: buildRsiIndicator({
          divergence: { bearish: buildDivergenceSignal({ strength: 'strong' }), bullish: null },
        }),
      }),
    )
    expect(withBear!.components.find((c) => c.key === 'rsi')!.contribution).toBe(-10)

    // Long trade with bullish divergence is *not* rewarded — RSI stays neutral.
    const withBull = computeConvergenceScore(
      baseInputs({
        rsi: buildRsiIndicator({
          divergence: { bearish: null, bullish: buildDivergenceSignal({ strength: 'strong' }) },
        }),
      }),
    )
    expect(withBull!.components.find((c) => c.key === 'rsi')!.contribution).toBe(0)
  })

  it('reaches the floor when every signal points against the trade', () => {
    const out = computeConvergenceScore(
      baseInputs({
        peEta: makePeEta({ drift: { lo: 2, hi: 5, state: 'behind' }, badge: 'behind' }),
        positionPct: 0.05,
        priceChanges: buildPriceChanges({ avgChangePct5d: 0.05 }), // strong wrong-way move
        sma: buildSmaStructure({ bullishScore: 0 }), // bearish stack on a long
        lr20: buildLinearRegressionResult({ slopePct: -0.02 }),
        rsi: buildRsiIndicator({
          divergence: { bearish: buildDivergenceSignal({ strength: 'strong' }), bullish: null },
        }),
      }),
    )
    // Momentum and LR20 use tanh so they only asymptote to ±1; the floor is reached but not exceeded.
    expect(out!.score).toBeLessThanOrEqual(-99)
    expect(out!.score).toBeGreaterThanOrEqual(-100)
  })

  it('downgrades confidence when only one supporting component has data', () => {
    const out = computeConvergenceScore({
      isLong: true,
      positionPct: null,
      peEta: null,
      priceChanges: null,
      sma: buildSmaStructure(),
      lr20: null,
      rsi: null,
    })
    expect(out).not.toBeNull()
    expect(out!.confidence).toBe('low')
  })
})

describe('convergenceBand', () => {
  it.each([
    [80, 'strong-pos'],
    [20, 'pos'],
    [0, 'neutral'],
    [-30, 'neg'],
    [-70, 'strong-neg'],
  ] as const)('bands %d as %s', (score, expected) => {
    expect(convergenceBand(score)).toBe(expected)
  })
})
