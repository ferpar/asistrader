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

  it('SMA component flips sign by fill direction, not trade direction', () => {
    // Price above PE → must fall → bullish stack pushes price further away (bad).
    const aboveBullish = computeConvergenceScore(
      baseInputs({ positionPct: 0.05, sma: buildSmaStructure({ bullishScore: 10 }) }),
    )
    expect(aboveBullish!.components.find((c) => c.key === 'sma')!.raw).toBe(-1)

    // Price below PE → must rise → bullish stack pulls price toward PE (good).
    const belowBullish = computeConvergenceScore(
      baseInputs({ positionPct: -0.05, sma: buildSmaStructure({ bullishScore: 10 }) }),
    )
    expect(belowBullish!.components.find((c) => c.key === 'sma')!.raw).toBe(1)
  })

  it('LR20 slope flips sign by fill direction', () => {
    // Above PE with a strong up-slope: trend pushes price further from PE.
    const aboveUp = computeConvergenceScore(
      baseInputs({ positionPct: 0.05, lr20: buildLinearRegressionResult({ slopePct: 0.01 }) }),
    )
    expect(aboveUp!.components.find((c) => c.key === 'lr20')!.raw!).toBeLessThan(0)

    // Below PE with a strong up-slope: trend lifts price back toward PE.
    const belowUp = computeConvergenceScore(
      baseInputs({ positionPct: -0.05, lr20: buildLinearRegressionResult({ slopePct: 0.01 }) }),
    )
    expect(belowUp!.components.find((c) => c.key === 'lr20')!.raw!).toBeGreaterThan(0)
  })

  it('RSI divergence rewards the side that matches the fill direction', () => {
    // Price above PE, must fall. A bearish RSI divergence (top hint) favours
    // the fill; a bullish divergence pushes away.
    const aboveBear = computeConvergenceScore(
      baseInputs({
        positionPct: 0.05,
        rsi: buildRsiIndicator({
          divergence: { bearish: buildDivergenceSignal({ strength: 'strong' }), bullish: null },
        }),
      }),
    )
    expect(aboveBear!.components.find((c) => c.key === 'rsi')!.contribution).toBe(10)

    const aboveBull = computeConvergenceScore(
      baseInputs({
        positionPct: 0.05,
        rsi: buildRsiIndicator({
          divergence: { bearish: null, bullish: buildDivergenceSignal({ strength: 'strong' }) },
        }),
      }),
    )
    expect(aboveBull!.components.find((c) => c.key === 'rsi')!.contribution).toBe(-10)

    // Price below PE → mirror image.
    const belowBull = computeConvergenceScore(
      baseInputs({
        positionPct: -0.05,
        rsi: buildRsiIndicator({
          divergence: { bearish: null, bullish: buildDivergenceSignal({ strength: 'strong' }) },
        }),
      }),
    )
    expect(belowBull!.components.find((c) => c.key === 'rsi')!.contribution).toBe(10)
  })

  it('reaches the floor when every signal points away from the fill', () => {
    // Price above PE → fill needs price to fall. Inputs make everything push UP:
    // drift behind, 5d momentum up, fully bullish SMA stack, positive LR20,
    // and a bullish RSI divergence (potential reversal up).
    const out = computeConvergenceScore(
      baseInputs({
        peEta: makePeEta({ drift: { lo: 2, hi: 5, state: 'behind' }, badge: 'behind' }),
        positionPct: 0.05,
        priceChanges: buildPriceChanges({ avgChangePct5d: 0.05 }),
        sma: buildSmaStructure({ bullishScore: 10 }),
        lr20: buildLinearRegressionResult({ slopePct: 0.02 }),
        rsi: buildRsiIndicator({
          divergence: { bearish: null, bullish: buildDivergenceSignal({ strength: 'strong' }) },
        }),
      }),
    )
    // Momentum and LR20 use tanh so they only asymptote to ±1; the floor is reached but not exceeded.
    expect(out!.score).toBeLessThanOrEqual(-99)
    expect(out!.score).toBeGreaterThanOrEqual(-100)
  })

  it('downgrades confidence when only one supporting component has data', () => {
    // positionPct is present (so SMA can resolve a fill direction), but
    // drift is unavailable and only SMA carries signal among supporters.
    const out = computeConvergenceScore({
      positionPct: 0.05,
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
