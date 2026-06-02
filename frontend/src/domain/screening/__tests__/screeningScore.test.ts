import { describe, it, expect } from 'vitest'
import { computeScreening, DEFAULT_WEIGHTS, TIER_A_MIN, historyConfidence } from '../screeningScore'
import type { TickerIndicators, LinearRegressionResult } from '../../radar/types'
import type { ScopeBlock, TradeIrr } from '../../irr/types'

const lr = (slopePct: number | null): LinearRegressionResult => ({ slope: slopePct, slopePct, r2: 0.5 })

function indicator(over: Partial<TickerIndicators> & { symbol: string }): TickerIndicators {
  return {
    symbol: over.symbol,
    name: over.name ?? over.symbol,
    currentPrice: 100,
    sma: { sma5: 1, sma20: 1, sma50: 1, sma200: 1, structure: '01234', bullishScore: 5, ...over.sma },
    priceChanges: {
      avgChange5d: 1, avgChangePct5d: 0.01, avgChange50d: 1, avgChangePct50d: 0.01, ...over.priceChanges,
    },
    linearRegression: over.linearRegression ?? { lr20: lr(0.001), lr50: lr(0.001), lr200: lr(0.001) },
    rsi: over.rsi ?? { series: [], latest: 50, pivots: { highs: [], lows: [] }, divergence: { bearish: null, bullish: null } },
    datedCloses: [],
    error: null,
  }
}

function txn(over: Partial<TradeIrr> & { ticker: string }): TradeIrr {
  return {
    tradeId: Math.round(Math.abs(over.returnPct ?? 0) * 1000) + over.ticker.length,
    ticker: over.ticker,
    tickerName: over.ticker,
    currency: 'USD',
    status: 'close',
    dateOrdered: '2026-01-01',
    exitDate: '2026-01-10',
    holdingDays: over.holdingDays ?? 10,
    investmentNative: 100,
    profitNative: over.profitNative ?? 10,
    investmentBase: 100,
    profitBase: over.profitBase ?? 10,
    returnPct: over.returnPct ?? 0.1,
    tir: 1,
    xirr: null,
    isWinner: over.isWinner ?? (over.profitNative ?? 10) > 0,
    fxDriftBase: 0,
  }
}

function scope(transactions: TradeIrr[]): ScopeBlock {
  return {
    transactions,
    byTicker: [], byTickerWinners: [], byTickerLosers: [],
    portfolio: null, portfolioWinners: null, portfolioLosers: null,
  }
}

describe('computeScreening', () => {
  it('puts tickers with no closed trades into unrated, not into tiers', () => {
    const inds = [indicator({ symbol: 'AAA' }), indicator({ symbol: 'BBB' })]
    const realized = scope([txn({ ticker: 'AAA', returnPct: 0.2, profitNative: 20, isWinner: true })])
    const { tiers, unrated } = computeScreening(inds, realized)
    expect(unrated.map((r) => r.symbol)).toEqual(['BBB'])
    const allTiered = [...tiers.A, ...tiers.B, ...tiers.C].map((r) => r.symbol)
    expect(allTiered).toContain('AAA')
    expect(allTiered).not.toContain('BBB')
  })

  it('ranks a strong ticker above a weak one and gives the best a top score', () => {
    const strong = indicator({
      symbol: 'STRONG',
      sma: { sma5: 1, sma20: 1, sma50: 1, sma200: 1, structure: '01234', bullishScore: 10 },
      linearRegression: { lr20: lr(0.002), lr50: lr(0.002), lr200: lr(0.002) },
      rsi: { series: [], latest: 25, pivots: { highs: [], lows: [] }, divergence: { bearish: null, bullish: null } },
    })
    const weak = indicator({
      symbol: 'WEAK',
      sma: { sma5: 1, sma20: 1, sma50: 1, sma200: 1, structure: '43210', bullishScore: 0 },
      linearRegression: { lr20: lr(-0.002), lr50: lr(-0.002), lr200: lr(-0.002) },
      rsi: { series: [], latest: 80, pivots: { highs: [], lows: [] }, divergence: { bearish: null, bullish: null } },
    })
    const realized = scope([
      // STRONG: short holds, high returns, all winners
      txn({ ticker: 'STRONG', returnPct: 0.4, profitNative: 40, holdingDays: 5, isWinner: true }),
      txn({ ticker: 'STRONG', returnPct: 0.3, profitNative: 30, holdingDays: 6, isWinner: true }),
      // WEAK: long holds, negative returns, all losers
      txn({ ticker: 'WEAK', returnPct: -0.2, profitNative: -20, holdingDays: 60, isWinner: false }),
      txn({ ticker: 'WEAK', returnPct: -0.1, profitNative: -10, holdingDays: 50, isWinner: false }),
    ])
    const rows = [...computeScreening([strong, weak], realized).tiers.A,
                  ...computeScreening([strong, weak], realized).tiers.B,
                  ...computeScreening([strong, weak], realized).tiers.C]
    const s = rows.find((r) => r.symbol === 'STRONG')!
    const w = rows.find((r) => r.symbol === 'WEAK')!
    expect(s.score!).toBeGreaterThan(w.score!)
    // STRONG is best-in-set on every metric → normalized to the top → tier A.
    expect(s.score!).toBeGreaterThanOrEqual(TIER_A_MIN)
    expect(s.tier).toBe('A')
  })

  it('rewards oversold over overbought (RSI direction)', () => {
    // Two otherwise-identical tickers differing only in RSI.
    const base = {
      sma: { sma5: 1, sma20: 1, sma50: 1, sma200: 1, structure: '01234', bullishScore: 5 },
      linearRegression: { lr20: lr(0.001), lr50: lr(0.001), lr200: lr(0.001) },
    }
    const oversold = indicator({ symbol: 'OS', ...base, rsi: { series: [], latest: 20, pivots: { highs: [], lows: [] }, divergence: { bearish: null, bullish: null } } })
    const overbought = indicator({ symbol: 'OB', ...base, rsi: { series: [], latest: 85, pivots: { highs: [], lows: [] }, divergence: { bearish: null, bullish: null } } })
    const realized = scope([
      txn({ ticker: 'OS', returnPct: 0.1, profitNative: 10, isWinner: true }),
      txn({ ticker: 'OB', returnPct: 0.1, profitNative: 10, isWinner: true }),
    ])
    const rows = (() => { const r = computeScreening([oversold, overbought], realized); return [...r.tiers.A, ...r.tiers.B, ...r.tiers.C] })()
    const os = rows.find((r) => r.symbol === 'OS')!
    const ob = rows.find((r) => r.symbol === 'OB')!
    expect(os.familyScores.technical!).toBeGreaterThan(ob.familyScores.technical!)
  })

  it('normalizes equal-valued metrics to neutral (0.5) without dividing by zero', () => {
    const a = indicator({ symbol: 'A1' })
    const b = indicator({ symbol: 'B1' })
    // identical metrics on both
    const realized = scope([
      txn({ ticker: 'A1', returnPct: 0.1, profitNative: 10, holdingDays: 10, isWinner: true }),
      txn({ ticker: 'B1', returnPct: 0.1, profitNative: 10, holdingDays: 10, isWinner: true }),
    ])
    const r = computeScreening([a, b], realized)
    const rows = [...r.tiers.A, ...r.tiers.B, ...r.tiers.C]
    // All metrics equal → every family score 50 → composite 50.
    for (const row of rows) {
      expect(row.score!).toBeCloseTo(50, 5)
      expect(row.tier).toBe('B') // 45 <= 50 < 70
    }
  })

  it('renormalizes a family over present metrics when one is null', () => {
    // Single rated ticker with bullishScore null → technical family must still score
    // (off the remaining technical metrics) and not crash.
    const ind = indicator({
      symbol: 'X',
      sma: { sma5: null, sma20: 1, sma50: 1, sma200: 1, structure: null, bullishScore: null },
    })
    const realized = scope([txn({ ticker: 'X', returnPct: 0.1, profitNative: 10, isWinner: true })])
    const r = computeScreening([ind], realized)
    const row = [...r.tiers.A, ...r.tiers.B, ...r.tiers.C].find((x) => x.symbol === 'X')!
    expect(row.metrics.bullishScore).toBeNull()
    expect(row.familyScores.technical).not.toBeNull()
    expect(Number.isFinite(row.score!)).toBe(true)
  })

  it('default weights favor the historical family', () => {
    expect(DEFAULT_WEIGHTS.family.historical).toBeGreaterThan(DEFAULT_WEIGHTS.family.technical)
  })

  it('historyConfidence ramps from low to ~1 as trades accumulate', () => {
    expect(historyConfidence(0)).toBe(0)
    expect(historyConfidence(1)).toBeCloseTo(0.4, 5) // 1 / (1 + 1.5)
    expect(historyConfidence(5)).toBeCloseTo(0.769, 3)
    expect(historyConfidence(10)).toBeCloseTo(0.87, 2)
    // Monotonic increasing, never reaching 1.
    expect(historyConfidence(100)).toBeGreaterThan(historyConfidence(10))
    expect(historyConfidence(1000)).toBeLessThan(1)
  })

  it('discounts a thin lucky winner so its single great trade does not mint an A tier', () => {
    // All three tickers share identical (default) technicals → technical family is
    // a flat 50 for everyone, so the HISTORICAL shrinkage alone drives the tiers.
    // THIN is best-in-set on every historical metric but has only one trade;
    // PROVEN is a hair behind on avg return yet backed by a dozen trades; LOW is a
    // loser that anchors the bottom of the normalization extents.
    const thin = indicator({ symbol: 'THIN' })
    const proven = indicator({ symbol: 'PROVEN' })
    const low = indicator({ symbol: 'LOW' })
    const realized = scope([
      txn({ ticker: 'THIN', returnPct: 0.5, profitNative: 50, holdingDays: 5, isWinner: true }),
      ...Array.from({ length: 12 }, () =>
        txn({ ticker: 'PROVEN', returnPct: 0.35, profitNative: 35, holdingDays: 5, isWinner: true }),
      ),
      txn({ ticker: 'LOW', returnPct: -0.2, profitNative: -20, holdingDays: 60, isWinner: false }),
      txn({ ticker: 'LOW', returnPct: -0.1, profitNative: -10, holdingDays: 50, isWinner: false }),
    ])
    const r = computeScreening([thin, proven, low], realized)
    const rows = [...r.tiers.A, ...r.tiers.B, ...r.tiers.C]
    const t = rows.find((x) => x.symbol === 'THIN')!
    const p = rows.find((x) => x.symbol === 'PROVEN')!
    // THIN is best-in-set on raw history yet its lone trade is shrunk toward neutral,
    // so the proven (many-trade) ticker out-tiers it despite a slightly lower raw record.
    expect(t.familyScores.historical!).toBeLessThan(p.familyScores.historical!)
    expect(p.tier).toBe('A')
    expect(t.tier).not.toBe('A')
  })
})
