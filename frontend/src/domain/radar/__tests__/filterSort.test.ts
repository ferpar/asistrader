import { describe, it, expect } from 'vitest'
import { Decimal } from '../../shared/Decimal'
import { buildTrade } from '../../trade/testing/fixtures'
import {
  buildTickerIndicators,
  buildLiveMetrics,
  buildSmaStructure,
  buildLinearRegression,
  buildLinearRegressionResult,
  buildViewState,
  buildPriceChanges,
} from '../testing/fixtures'
import {
  classifyStructure,
  filterTicker,
  filterTrade,
  sortTickers,
  sortTrades,
  tickerSortKeyValue,
  tradeSortKeyValue,
  applyGroupedView,
  applyFlatView,
  computeTradeDrift,
  DEFAULT_VIEW_STATE,
  type TradeRow,
} from '../filterSort'
import type { DatedClose } from '../types'
import type { LiveMetrics } from '../../trade/types'

const NOW = new Date('2025-07-30T00:00:00Z')

function makeDatedCloses(values: number[], startDate = '2025-06-01'): DatedClose[] {
  const start = new Date(startDate)
  return values.map((close, i) => {
    const d = new Date(start)
    d.setUTCDate(start.getUTCDate() + i)
    return { date: d.toISOString().slice(0, 10), close }
  })
}

function slowThenFastCloses(): number[] {
  const values: number[] = []
  let price = 100
  for (let i = 0; i < 50; i++) {
    values.push(price)
    price += 0.5
  }
  for (let i = 0; i < 10; i++) {
    price += 2
    values.push(price)
  }
  return values
}

function fastThenSlowCloses(): number[] {
  const values: number[] = []
  let price = 100
  for (let i = 0; i < 10; i++) {
    values.push(price)
    price += 2
  }
  for (let i = 0; i < 50; i++) {
    price += 0.5
    values.push(price)
  }
  return values
}

describe('classifyStructure', () => {
  it('returns bullish when first char is 0', () => {
    expect(classifyStructure('01234')).toBe('bullish')
  })
  it('returns bearish when first char is 4', () => {
    expect(classifyStructure('43210')).toBe('bearish')
  })
  it('returns mixed otherwise', () => {
    expect(classifyStructure('20134')).toBe('mixed')
  })
  it('returns null when structure is null', () => {
    expect(classifyStructure(null)).toBeNull()
  })
})

describe('filterTicker', () => {
  describe('structure', () => {
    it('any passes all', () => {
      const ind = buildTickerIndicators({ sma: buildSmaStructure({ structure: null }) })
      expect(filterTicker(ind, [], { ...DEFAULT_VIEW_STATE.ticker, structure: 'any' })).toBe(true)
    })
    it('bullish passes structures starting with 0', () => {
      const ind = buildTickerIndicators({ sma: buildSmaStructure({ structure: '01234' }) })
      expect(filterTicker(ind, [], { ...DEFAULT_VIEW_STATE.ticker, structure: 'bullish' })).toBe(true)
    })
    it('bullish rejects bearish structures', () => {
      const ind = buildTickerIndicators({ sma: buildSmaStructure({ structure: '43210' }) })
      expect(filterTicker(ind, [], { ...DEFAULT_VIEW_STATE.ticker, structure: 'bullish' })).toBe(false)
    })
    it('bearish passes structures starting with 4', () => {
      const ind = buildTickerIndicators({ sma: buildSmaStructure({ structure: '43210' }) })
      expect(filterTicker(ind, [], { ...DEFAULT_VIEW_STATE.ticker, structure: 'bearish' })).toBe(true)
    })
    it('mixed passes non-0/4 first-char structures', () => {
      const ind = buildTickerIndicators({ sma: buildSmaStructure({ structure: '20134' }) })
      expect(filterTicker(ind, [], { ...DEFAULT_VIEW_STATE.ticker, structure: 'mixed' })).toBe(true)
    })
    it('rejects null structure for any non-any filter', () => {
      const ind = buildTickerIndicators({ sma: buildSmaStructure({ structure: null }) })
      expect(filterTicker(ind, [], { ...DEFAULT_VIEW_STATE.ticker, structure: 'bullish' })).toBe(false)
    })
  })

  describe('trendSign', () => {
    it('up passes positive lr50 slope', () => {
      const ind = buildTickerIndicators({
        linearRegression: buildLinearRegression({ lr50: buildLinearRegressionResult({ slope: 0.5 }) }),
      })
      expect(filterTicker(ind, [], { ...DEFAULT_VIEW_STATE.ticker, trendSign: 'up' })).toBe(true)
    })
    it('down passes negative lr50 slope', () => {
      const ind = buildTickerIndicators({
        linearRegression: buildLinearRegression({ lr50: buildLinearRegressionResult({ slope: -0.5 }) }),
      })
      expect(filterTicker(ind, [], { ...DEFAULT_VIEW_STATE.ticker, trendSign: 'down' })).toBe(true)
    })
    it('rejects null lr50 slope unless any', () => {
      const ind = buildTickerIndicators({
        linearRegression: buildLinearRegression({ lr50: buildLinearRegressionResult({ slope: null }) }),
      })
      expect(filterTicker(ind, [], { ...DEFAULT_VIEW_STATE.ticker, trendSign: 'up' })).toBe(false)
      expect(filterTicker(ind, [], { ...DEFAULT_VIEW_STATE.ticker, trendSign: 'any' })).toBe(true)
    })
  })

  describe('activity', () => {
    const ind = buildTickerIndicators()
    const planTrade = buildTrade({ id: 1, status: 'plan' })
    const openTrade = buildTrade({ id: 2, status: 'open' })
    it('hasOpen requires at least one open trade', () => {
      expect(filterTicker(ind, [openTrade], { ...DEFAULT_VIEW_STATE.ticker, activity: 'hasOpen' })).toBe(true)
      expect(filterTicker(ind, [planTrade], { ...DEFAULT_VIEW_STATE.ticker, activity: 'hasOpen' })).toBe(false)
    })
    it('hasPlan requires at least one plan trade', () => {
      expect(filterTicker(ind, [planTrade], { ...DEFAULT_VIEW_STATE.ticker, activity: 'hasPlan' })).toBe(true)
      expect(filterTicker(ind, [openTrade], { ...DEFAULT_VIEW_STATE.ticker, activity: 'hasPlan' })).toBe(false)
    })
    it('hasActive matches any active trade', () => {
      expect(filterTicker(ind, [planTrade], { ...DEFAULT_VIEW_STATE.ticker, activity: 'hasActive' })).toBe(true)
      expect(filterTicker(ind, [], { ...DEFAULT_VIEW_STATE.ticker, activity: 'hasActive' })).toBe(false)
    })
    it('hasNone requires zero active trades', () => {
      expect(filterTicker(ind, [], { ...DEFAULT_VIEW_STATE.ticker, activity: 'hasNone' })).toBe(true)
      expect(filterTicker(ind, [openTrade], { ...DEFAULT_VIEW_STATE.ticker, activity: 'hasNone' })).toBe(false)
    })
  })

  describe('search', () => {
    const ind = buildTickerIndicators({ symbol: 'AAPL', name: 'Apple Inc.' })
    it('empty search passes all', () => {
      expect(filterTicker(ind, [], { ...DEFAULT_VIEW_STATE.ticker, search: '' })).toBe(true)
      expect(filterTicker(ind, [], { ...DEFAULT_VIEW_STATE.ticker, search: '   ' })).toBe(true)
    })
    it('matches symbol case-insensitively', () => {
      expect(filterTicker(ind, [], { ...DEFAULT_VIEW_STATE.ticker, search: 'aap' })).toBe(true)
    })
    it('matches name case-insensitively', () => {
      expect(filterTicker(ind, [], { ...DEFAULT_VIEW_STATE.ticker, search: 'apple' })).toBe(true)
    })
    it('rejects non-matches', () => {
      expect(filterTicker(ind, [], { ...DEFAULT_VIEW_STATE.ticker, search: 'msft' })).toBe(false)
    })
  })

  describe('hideErrored', () => {
    it('drops cards with an error', () => {
      const ind = buildTickerIndicators({ error: 'No data' })
      expect(filterTicker(ind, [], { ...DEFAULT_VIEW_STATE.ticker, hideErrored: true })).toBe(false)
    })
    it('keeps errored cards when toggle is off', () => {
      const ind = buildTickerIndicators({ error: 'No data' })
      expect(filterTicker(ind, [], { ...DEFAULT_VIEW_STATE.ticker, hideErrored: false })).toBe(true)
    })
  })
})

describe('filterTrade', () => {
  const ind = buildTickerIndicators()
  const ctx = { priceChanges: ind.priceChanges, datedCloses: ind.datedCloses }

  describe('status', () => {
    it('any passes every status', () => {
      const plan = buildTrade({ status: 'plan' })
      expect(filterTrade(plan, undefined, { ...DEFAULT_VIEW_STATE.trade, status: 'any' }, ctx, NOW)).toBe(true)
    })
    it('filters mismatched statuses', () => {
      const plan = buildTrade({ status: 'plan' })
      const open = buildTrade({ status: 'open' })
      expect(filterTrade(plan, undefined, { ...DEFAULT_VIEW_STATE.trade, status: 'open' }, ctx, NOW)).toBe(false)
      expect(filterTrade(open, undefined, { ...DEFAULT_VIEW_STATE.trade, status: 'open' }, ctx, NOW)).toBe(true)
    })
  })

  describe('pnlSign', () => {
    it('winning passes open trades with positive PnL', () => {
      const trade = buildTrade({ status: 'open' })
      const metric = buildLiveMetrics({ unrealizedPnLPct: Decimal.from(0.05) })
      expect(filterTrade(trade, metric, { ...DEFAULT_VIEW_STATE.trade, pnlSign: 'winning' }, ctx, NOW)).toBe(true)
    })
    it('losing passes open trades with negative PnL', () => {
      const trade = buildTrade({ status: 'open' })
      const metric = buildLiveMetrics({ unrealizedPnLPct: Decimal.from(-0.05) })
      expect(filterTrade(trade, metric, { ...DEFAULT_VIEW_STATE.trade, pnlSign: 'losing' }, ctx, NOW)).toBe(true)
    })
    it('winning rejects losing trades', () => {
      const trade = buildTrade({ status: 'open' })
      const metric = buildLiveMetrics({ unrealizedPnLPct: Decimal.from(-0.01) })
      expect(filterTrade(trade, metric, { ...DEFAULT_VIEW_STATE.trade, pnlSign: 'winning' }, ctx, NOW)).toBe(false)
    })
    it('rejects non-open trades when pnl filter is active', () => {
      const plan = buildTrade({ status: 'plan' })
      expect(filterTrade(plan, undefined, { ...DEFAULT_VIEW_STATE.trade, pnlSign: 'winning' }, ctx, NOW)).toBe(false)
    })
    it('rejects when PnL is null', () => {
      const trade = buildTrade({ status: 'open' })
      const metric = buildLiveMetrics({ unrealizedPnLPct: null })
      expect(filterTrade(trade, metric, { ...DEFAULT_VIEW_STATE.trade, pnlSign: 'winning' }, ctx, NOW)).toBe(false)
    })
  })

  describe('proximity', () => {
    const trade = buildTrade({ status: 'open' })
    it('SL passes when distanceToSL is within the last X%', () => {
      const near = buildLiveMetrics({ distanceToSL: Decimal.from(0.85) })
      expect(
        filterTrade(trade, near, {
          ...DEFAULT_VIEW_STATE.trade,
          proximity: { target: 'sl', withinPct: 20 },
        }, ctx, NOW),
      ).toBe(true)
    })
    it('SL rejects when distanceToSL is beyond threshold', () => {
      const far = buildLiveMetrics({ distanceToSL: Decimal.from(0.3) })
      expect(
        filterTrade(trade, far, {
          ...DEFAULT_VIEW_STATE.trade,
          proximity: { target: 'sl', withinPct: 20 },
        }, ctx, NOW),
      ).toBe(false)
    })
    it('TP passes when distanceToTP is within the last X%', () => {
      const near = buildLiveMetrics({ distanceToTP: Decimal.from(0.9) })
      expect(
        filterTrade(trade, near, {
          ...DEFAULT_VIEW_STATE.trade,
          proximity: { target: 'tp', withinPct: 15 },
        }, ctx, NOW),
      ).toBe(true)
    })
    it('PE passes when |distanceToPE| is within X%', () => {
      const plan = buildTrade({ status: 'plan' })
      const near = buildLiveMetrics({ distanceToPE: Decimal.from(-0.01) })
      expect(
        filterTrade(plan, near, {
          ...DEFAULT_VIEW_STATE.trade,
          proximity: { target: 'pe', withinPct: 2 },
        }, ctx, NOW),
      ).toBe(true)
    })
    it('PE rejects when |distanceToPE| exceeds X%', () => {
      const plan = buildTrade({ status: 'plan' })
      const far = buildLiveMetrics({ distanceToPE: Decimal.from(0.05) })
      expect(
        filterTrade(plan, far, {
          ...DEFAULT_VIEW_STATE.trade,
          proximity: { target: 'pe', withinPct: 2 },
        }, ctx, NOW),
      ).toBe(false)
    })
    it('rejects when liveMetric is missing', () => {
      expect(
        filterTrade(trade, undefined, {
          ...DEFAULT_VIEW_STATE.trade,
          proximity: { target: 'sl', withinPct: 20 },
        }, ctx, NOW),
      ).toBe(false)
    })
  })

  describe('drift (open, ETA→TP)', () => {
    it('filters out trades that do not match the target drift state', () => {
      const aheadIndicator = buildTickerIndicators({
        datedCloses: makeDatedCloses(slowThenFastCloses()),
        priceChanges: buildPriceChanges({ avgChange50d: 0.8, avgChange5d: 2 }),
      })
      const trade = buildTrade({
        status: 'open',
        dateActual: new Date('2025-07-20'),
        entryPrice: Decimal.from(124.5),
        takeProfit: Decimal.from(164.5),
        stopLoss: Decimal.from(100),
      })
      const metric = buildLiveMetrics({ currentPrice: Decimal.from(144.5) })
      const aheadCtx = { priceChanges: aheadIndicator.priceChanges, datedCloses: aheadIndicator.datedCloses }
      expect(
        filterTrade(trade, metric, { ...DEFAULT_VIEW_STATE.trade, drift: 'ahead' }, aheadCtx, NOW),
      ).toBe(true)
      expect(
        filterTrade(trade, metric, { ...DEFAULT_VIEW_STATE.trade, drift: 'behind' }, aheadCtx, NOW),
      ).toBe(false)
    })

    it('rejects when baseline is today (fresh) and filter is active', () => {
      const trade = buildTrade({
        status: 'open',
        dateActual: new Date('2025-07-30'),
        takeProfit: Decimal.from(200),
      })
      const metric = buildLiveMetrics({ currentPrice: Decimal.from(144.5) })
      expect(
        filterTrade(trade, metric, { ...DEFAULT_VIEW_STATE.trade, drift: 'on-pace' }, ctx, NOW),
      ).toBe(false)
    })

    it('any always passes', () => {
      const trade = buildTrade({ status: 'open' })
      expect(
        filterTrade(trade, undefined, { ...DEFAULT_VIEW_STATE.trade, drift: 'any' }, ctx, NOW),
      ).toBe(true)
    })
  })
})

describe('computeTradeDrift', () => {
  it('returns ahead when current pace exceeds baseline pace', () => {
    const datedCloses = makeDatedCloses(slowThenFastCloses())
    const priceChanges = buildPriceChanges({ avgChange50d: 0.8, avgChange5d: 2 })
    const trade = buildTrade({
      status: 'open',
      dateActual: new Date('2025-07-20'),
      takeProfit: Decimal.from(164.5),
    })
    const metric = buildLiveMetrics({ currentPrice: Decimal.from(144.5) })
    expect(computeTradeDrift(trade, metric, priceChanges, datedCloses, NOW)).toBe('ahead')
  })

  it('returns behind when current pace lags baseline pace', () => {
    const datedCloses = makeDatedCloses(fastThenSlowCloses())
    const priceChanges = buildPriceChanges({ avgChange50d: 0.5, avgChange5d: 0.5 })
    const trade = buildTrade({
      status: 'open',
      dateActual: new Date('2025-06-10'),
      takeProfit: Decimal.from(163),
    })
    const metric = buildLiveMetrics({ currentPrice: Decimal.from(143) })
    expect(computeTradeDrift(trade, metric, priceChanges, datedCloses, NOW)).toBe('behind')
  })

  it('returns null when current price is missing', () => {
    const trade = buildTrade({ status: 'open' })
    const metric = buildLiveMetrics({ currentPrice: null })
    expect(computeTradeDrift(trade, metric, buildPriceChanges(), makeDatedCloses([100, 101, 102]), NOW)).toBeNull()
  })

  it('returns null for closed trades', () => {
    const trade = buildTrade({ status: 'close' })
    const metric = buildLiveMetrics()
    expect(computeTradeDrift(trade, metric, buildPriceChanges(), makeDatedCloses([100, 101, 102]), NOW)).toBeNull()
  })
})

describe('sortTickers', () => {
  const openA = buildTrade({ id: 1, status: 'open', ticker: 'AAA' })
  const openB = buildTrade({ id: 2, status: 'open', ticker: 'BBB' })
  const openC = buildTrade({ id: 3, status: 'open', ticker: 'CCC' })
  const indA = buildTickerIndicators({
    symbol: 'AAA',
    linearRegression: buildLinearRegression({ lr50: buildLinearRegressionResult({ slope: 0.1 }) }),
  })
  const indB = buildTickerIndicators({
    symbol: 'BBB',
    linearRegression: buildLinearRegression({ lr50: buildLinearRegressionResult({ slope: 0.5 }) }),
  })
  const indC = buildTickerIndicators({
    symbol: 'CCC',
    linearRegression: buildLinearRegression({ lr50: buildLinearRegressionResult({ slope: -0.2 }) }),
  })
  const trades = { AAA: [openA], BBB: [openB], CCC: [openC] }
  const metrics: Record<number, LiveMetrics> = {
    1: buildLiveMetrics({ distanceToSL: Decimal.from(0.2), unrealizedPnLPct: Decimal.from(0.1) }),
    2: buildLiveMetrics({ distanceToSL: Decimal.from(0.9), unrealizedPnLPct: Decimal.from(-0.2) }),
    3: buildLiveMetrics({ distanceToSL: Decimal.from(0.5), unrealizedPnLPct: Decimal.from(0.05) }),
  }

  it('sorts by symbol ascending', () => {
    const sorted = sortTickers([indC, indA, indB], trades, metrics, { key: 'symbol', dir: 'asc' }, NOW)
    expect(sorted.map((i) => i.symbol)).toEqual(['AAA', 'BBB', 'CCC'])
  })
  it('sorts by symbol descending', () => {
    const sorted = sortTickers([indA, indB, indC], trades, metrics, { key: 'symbol', dir: 'desc' }, NOW)
    expect(sorted.map((i) => i.symbol)).toEqual(['CCC', 'BBB', 'AAA'])
  })
  it('sorts by lrSlope50 descending (highest slope first)', () => {
    const sorted = sortTickers([indA, indB, indC], trades, metrics, { key: 'lrSlope50', dir: 'desc' }, NOW)
    expect(sorted.map((i) => i.symbol)).toEqual(['BBB', 'AAA', 'CCC'])
  })
  it('sorts by closestToSL descending (highest distanceToSL first)', () => {
    const sorted = sortTickers([indA, indB, indC], trades, metrics, { key: 'closestToSL', dir: 'desc' }, NOW)
    expect(sorted.map((i) => i.symbol)).toEqual(['BBB', 'CCC', 'AAA'])
  })
  it('sorts by biggestWinner descending', () => {
    const sorted = sortTickers([indA, indB, indC], trades, metrics, { key: 'biggestWinner', dir: 'desc' }, NOW)
    expect(sorted.map((i) => i.symbol)).toEqual(['AAA', 'CCC', 'BBB'])
  })
  it('sorts by biggestLoser ascending (most negative first)', () => {
    const sorted = sortTickers([indA, indB, indC], trades, metrics, { key: 'biggestLoser', dir: 'asc' }, NOW)
    expect(sorted.map((i) => i.symbol)).toEqual(['BBB', 'CCC', 'AAA'])
  })
  it('nulls sort to the end', () => {
    const indNull = buildTickerIndicators({
      symbol: 'ZZZ',
      linearRegression: buildLinearRegression({ lr50: buildLinearRegressionResult({ slope: null }) }),
    })
    const sorted = sortTickers(
      [indA, indNull, indB],
      { ...trades, ZZZ: [] },
      metrics,
      { key: 'lrSlope50', dir: 'desc' },
      NOW,
    )
    expect(sorted.map((i) => i.symbol)).toEqual(['BBB', 'AAA', 'ZZZ'])
  })
  it('ties break by symbol ascending', () => {
    const indX = buildTickerIndicators({
      symbol: 'XXX',
      linearRegression: buildLinearRegression({ lr50: buildLinearRegressionResult({ slope: 0.5 }) }),
    })
    const indY = buildTickerIndicators({
      symbol: 'YYY',
      linearRegression: buildLinearRegression({ lr50: buildLinearRegressionResult({ slope: 0.5 }) }),
    })
    const sorted = sortTickers(
      [indY, indX],
      { XXX: [], YYY: [] },
      {},
      { key: 'lrSlope50', dir: 'desc' },
      NOW,
    )
    expect(sorted.map((i) => i.symbol)).toEqual(['XXX', 'YYY'])
  })
})

describe('tickerSortKeyValue aggregation', () => {
  const ind = buildTickerIndicators({ symbol: 'AAPL' })
  const t1 = buildTrade({ id: 1, status: 'open', ticker: 'AAPL' })
  const t2 = buildTrade({ id: 2, status: 'open', ticker: 'AAPL' })
  const t3 = buildTrade({ id: 3, status: 'plan', ticker: 'AAPL' })
  const metrics: Record<number, LiveMetrics> = {
    1: buildLiveMetrics({ distanceToSL: Decimal.from(0.3), unrealizedPnLPct: Decimal.from(0.1), distanceToPE: Decimal.from(0.05) }),
    2: buildLiveMetrics({ distanceToSL: Decimal.from(0.7), unrealizedPnLPct: Decimal.from(-0.1), distanceToPE: Decimal.from(-0.02) }),
    3: buildLiveMetrics({ distanceToPE: Decimal.from(0.005) }),
  }
  const ctx = { indicator: ind, trades: [t1, t2, t3], liveMetrics: metrics, now: NOW }

  it('closestToSL returns max over open trades', () => {
    expect(tickerSortKeyValue('closestToSL', ctx)).toBeCloseTo(0.7)
  })
  it('biggestWinner returns max PnL over open trades', () => {
    expect(tickerSortKeyValue('biggestWinner', ctx)).toBeCloseTo(0.1)
  })
  it('biggestLoser returns min PnL over open trades', () => {
    expect(tickerSortKeyValue('biggestLoser', ctx)).toBeCloseTo(-0.1)
  })
  it('closestToPE returns min |distanceToPE| over plan/ordered trades', () => {
    expect(tickerSortKeyValue('closestToPE', ctx)).toBeCloseTo(0.005)
  })
  it('activeCount counts plan+ordered+open', () => {
    expect(tickerSortKeyValue('activeCount', ctx)).toBe(3)
  })
})

describe('sortTrades (flat view)', () => {
  const indA = buildTickerIndicators({ symbol: 'AAA' })
  const indB = buildTickerIndicators({ symbol: 'BBB' })
  const t1 = buildTrade({ id: 1, status: 'open', ticker: 'AAA' })
  const t2 = buildTrade({ id: 2, status: 'open', ticker: 'BBB' })
  const t3 = buildTrade({ id: 3, status: 'open', ticker: 'BBB' })
  const rows: TradeRow[] = [
    { trade: t1, indicator: indA },
    { trade: t2, indicator: indB },
    { trade: t3, indicator: indB },
  ]
  const metrics: Record<number, LiveMetrics> = {
    1: buildLiveMetrics({ unrealizedPnLPct: Decimal.from(0.05) }),
    2: buildLiveMetrics({ unrealizedPnLPct: Decimal.from(-0.1) }),
    3: buildLiveMetrics({ unrealizedPnLPct: Decimal.from(0.2) }),
  }

  it('sorts by biggestWinner descending', () => {
    const sorted = sortTrades(rows, metrics, { key: 'biggestWinner', dir: 'desc' }, NOW)
    expect(sorted.map((r) => r.trade.id)).toEqual([3, 1, 2])
  })
  it('sorts by symbol asc, ties by trade id', () => {
    const sorted = sortTrades(rows, metrics, { key: 'symbol', dir: 'asc' }, NOW)
    expect(sorted.map((r) => r.trade.id)).toEqual([1, 2, 3])
  })
  it('tradeSortKeyValue returns null for activeCount', () => {
    expect(tradeSortKeyValue('activeCount', rows[0], metrics, NOW)).toBeNull()
  })
})

describe('applyGroupedView', () => {
  const openA = buildTrade({ id: 1, status: 'open', ticker: 'AAA' })
  const planA = buildTrade({ id: 2, status: 'plan', ticker: 'AAA' })
  const openB = buildTrade({ id: 3, status: 'open', ticker: 'BBB' })
  const indA = buildTickerIndicators({
    symbol: 'AAA',
    sma: buildSmaStructure({ structure: '01234' }),
  })
  const indB = buildTickerIndicators({
    symbol: 'BBB',
    sma: buildSmaStructure({ structure: '43210' }),
  })
  const trades = { AAA: [openA, planA], BBB: [openB] }
  const metrics: Record<number, LiveMetrics> = {
    1: buildLiveMetrics({ unrealizedPnLPct: Decimal.from(0.05) }),
    2: buildLiveMetrics(),
    3: buildLiveMetrics({ unrealizedPnLPct: Decimal.from(-0.05) }),
  }

  it('applies ticker and trade filters together', () => {
    const view = buildViewState({
      ticker: { ...DEFAULT_VIEW_STATE.ticker, structure: 'bullish' },
      trade: { ...DEFAULT_VIEW_STATE.trade, status: 'open' },
    })
    const out = applyGroupedView([indA, indB], trades, metrics, view, NOW)
    expect(out.indicators.map((i) => i.symbol)).toEqual(['AAA'])
    expect(out.tradesBySymbol.AAA.map((t) => t.id)).toEqual([1])
  })

  it('hides cards with zero surviving trades when a trade filter is active', () => {
    const view = buildViewState({
      trade: { ...DEFAULT_VIEW_STATE.trade, pnlSign: 'winning' },
    })
    const out = applyGroupedView([indA, indB], trades, metrics, view, NOW)
    expect(out.indicators.map((i) => i.symbol)).toEqual(['AAA'])
  })

  it('keeps cards with zero active trades when no trade filter is active', () => {
    const indNoTrades = buildTickerIndicators({ symbol: 'ZZZ' })
    const out = applyGroupedView(
      [indA, indNoTrades],
      { AAA: trades.AAA },
      metrics,
      buildViewState(),
      NOW,
    )
    expect(out.indicators.map((i) => i.symbol).sort()).toEqual(['AAA', 'ZZZ'])
  })

  it('respects the sort order', () => {
    const out = applyGroupedView(
      [indA, indB],
      trades,
      metrics,
      buildViewState({ sort: { key: 'symbol', dir: 'desc' } }),
      NOW,
    )
    expect(out.indicators.map((i) => i.symbol)).toEqual(['BBB', 'AAA'])
  })
})

describe('applyFlatView', () => {
  const openA = buildTrade({ id: 1, status: 'open', ticker: 'AAA' })
  const planA = buildTrade({ id: 2, status: 'plan', ticker: 'AAA' })
  const openB = buildTrade({ id: 3, status: 'open', ticker: 'BBB' })
  const canceled = buildTrade({ id: 4, status: 'canceled', ticker: 'AAA' })
  const indA = buildTickerIndicators({ symbol: 'AAA', sma: buildSmaStructure({ structure: '01234' }) })
  const indB = buildTickerIndicators({ symbol: 'BBB', sma: buildSmaStructure({ structure: '43210' }) })
  const trades = { AAA: [openA, planA, canceled], BBB: [openB] }
  const metrics: Record<number, LiveMetrics> = {
    1: buildLiveMetrics({ unrealizedPnLPct: Decimal.from(0.2) }),
    2: buildLiveMetrics(),
    3: buildLiveMetrics({ unrealizedPnLPct: Decimal.from(-0.1) }),
  }

  it('emits one row per active trade', () => {
    const out = applyFlatView([indA, indB], trades, metrics, buildViewState(), NOW)
    expect(out.rows.map((r) => r.trade.id).sort()).toEqual([1, 2, 3])
  })

  it('honours ticker-scope as a tag filter', () => {
    const out = applyFlatView(
      [indA, indB],
      trades,
      metrics,
      buildViewState({ ticker: { ...DEFAULT_VIEW_STATE.ticker, structure: 'bullish' } }),
      NOW,
    )
    expect(out.rows.map((r) => r.indicator.symbol)).toEqual(expect.arrayContaining(['AAA']))
    expect(out.rows.every((r) => r.indicator.symbol === 'AAA')).toBe(true)
  })

  it('sorts rows by trade criterion', () => {
    const out = applyFlatView(
      [indA, indB],
      trades,
      metrics,
      buildViewState({
        trade: { ...DEFAULT_VIEW_STATE.trade, status: 'open' },
        sort: { key: 'biggestWinner', dir: 'desc' },
      }),
      NOW,
    )
    expect(out.rows.map((r) => r.trade.id)).toEqual([1, 3])
  })

  it('excludes canceled and closed trades', () => {
    const out = applyFlatView([indA, indB], trades, metrics, buildViewState(), NOW)
    expect(out.rows.find((r) => r.trade.id === 4)).toBeUndefined()
  })
})
