import type { TickerIndicators, PriceChanges, DatedClose } from './types'
import type { TradeWithMetrics, LiveMetrics } from '../trade/types'
import {
  computeTimelineRange,
  computeDrift,
  type DriftState,
} from '../../utils/timelineExpectations'
import { computePriceChangesAsOf } from './indicators'
import { calculatePlanAge, calculateOpenAge } from '../../utils/trade'

export type StructureCategory = 'any' | 'bullish' | 'bearish' | 'mixed'
export type TrendSignFilter = 'any' | 'up' | 'down'
export type ActivityFilter = 'any' | 'hasOpen' | 'hasPlan' | 'hasActive' | 'hasNone'
export type TradeStatusFilter = 'any' | 'plan' | 'ordered' | 'open'
export type PnlSignFilter = 'any' | 'winning' | 'losing'
export type DriftFilter = 'any' | 'ahead' | 'behind' | 'on-pace'
export type ProximityTarget = 'sl' | 'tp' | 'pe'
export type ProximityFilter = null | { target: ProximityTarget; withinPct: number }

export interface TickerScope {
  structure: StructureCategory
  trendSign: TrendSignFilter
  activity: ActivityFilter
  search: string
  hideErrored: boolean
}

export interface TradeScope {
  status: TradeStatusFilter
  pnlSign: PnlSignFilter
  drift: DriftFilter
  proximity: ProximityFilter
}

export type SortKey =
  | 'symbol'
  | 'activeCount'
  | 'lrSlope50'
  | 'closestToSL'
  | 'closestToTP'
  | 'closestToPE'
  | 'biggestWinner'
  | 'biggestLoser'
  | 'worstDriftToTP'
  | 'oldestOpenAge'
  | 'oldestPlanAge'

export type SortDir = 'asc' | 'desc'

export interface RadarViewState {
  ticker: TickerScope
  trade: TradeScope
  sort: { key: SortKey; dir: SortDir }
  flatView: boolean
}

export interface TradeRow {
  trade: TradeWithMetrics
  indicator: TickerIndicators
}

export const DEFAULT_VIEW_STATE: RadarViewState = {
  ticker: {
    structure: 'any',
    trendSign: 'any',
    activity: 'any',
    search: '',
    hideErrored: false,
  },
  trade: {
    status: 'any',
    pnlSign: 'any',
    drift: 'any',
    proximity: null,
  },
  sort: { key: 'symbol', dir: 'asc' },
  flatView: false,
}

export function classifyStructure(
  structure: string | null,
): 'bullish' | 'bearish' | 'mixed' | null {
  if (!structure) return null
  if (structure.startsWith('0')) return 'bullish'
  if (structure.startsWith('4')) return 'bearish'
  return 'mixed'
}

function matchesStructure(indicator: TickerIndicators, filter: StructureCategory): boolean {
  if (filter === 'any') return true
  return classifyStructure(indicator.sma.structure) === filter
}

function matchesTrend(indicator: TickerIndicators, filter: TrendSignFilter): boolean {
  if (filter === 'any') return true
  const slope = indicator.linearRegression.lr50.slope
  if (slope === null) return false
  return filter === 'up' ? slope > 0 : slope < 0
}

function matchesActivity(trades: TradeWithMetrics[], filter: ActivityFilter): boolean {
  if (filter === 'any') return true
  const hasOpen = trades.some((t) => t.status === 'open')
  const hasPlan = trades.some((t) => t.status === 'plan')
  const hasOrdered = trades.some((t) => t.status === 'ordered')
  const hasActive = hasOpen || hasPlan || hasOrdered
  if (filter === 'hasOpen') return hasOpen
  if (filter === 'hasPlan') return hasPlan
  if (filter === 'hasActive') return hasActive
  return !hasActive
}

function matchesSearch(indicator: TickerIndicators, search: string): boolean {
  const q = search.trim().toLowerCase()
  if (!q) return true
  if (indicator.symbol.toLowerCase().includes(q)) return true
  return !!indicator.name && indicator.name.toLowerCase().includes(q)
}

export function filterTicker(
  indicator: TickerIndicators,
  trades: TradeWithMetrics[],
  scope: TickerScope,
): boolean {
  if (scope.hideErrored && indicator.error) return false
  if (!matchesSearch(indicator, scope.search)) return false
  if (!matchesStructure(indicator, scope.structure)) return false
  if (!matchesTrend(indicator, scope.trendSign)) return false
  if (!matchesActivity(trades, scope.activity)) return false
  return true
}

function toIsoDay(d: Date): string {
  return d.toISOString().slice(0, 10)
}

function baselineDate(trade: TradeWithMetrics): Date | null {
  if (trade.status === 'open') return trade.dateActual
  if (trade.status === 'plan' || trade.status === 'ordered') return trade.datePlanned
  return null
}

export function computeTradeDrift(
  trade: TradeWithMetrics,
  liveMetric: LiveMetrics | undefined,
  priceChanges: PriceChanges,
  datedCloses: DatedClose[],
  now: Date = new Date(),
): DriftState | null {
  if (!liveMetric?.currentPrice) return null
  let target
  if (trade.status === 'open') target = trade.takeProfit
  else if (trade.status === 'plan' || trade.status === 'ordered') target = trade.entryPrice
  else return null

  const baseline = baselineDate(trade)
  if (!baseline) return null
  const baselineKey = toIsoDay(baseline)
  const nowKey = toIsoDay(now)
  if (baselineKey >= nowKey) return null

  const dynamic = computeTimelineRange(liveMetric.currentPrice, target, priceChanges)
  const projected = computeTimelineRange(
    liveMetric.currentPrice,
    target,
    computePriceChangesAsOf(datedCloses, baselineKey),
  )
  return computeDrift(dynamic, projected)?.state ?? null
}

function matchesProximity(
  liveMetric: LiveMetrics | undefined,
  filter: ProximityFilter,
): boolean {
  if (!filter) return true
  if (!liveMetric) return false
  const ratio = filter.withinPct / 100
  if (filter.target === 'sl') {
    const d = liveMetric.distanceToSL?.toNumber() ?? null
    if (d === null) return false
    return d >= 1 - ratio
  }
  if (filter.target === 'tp') {
    const d = liveMetric.distanceToTP?.toNumber() ?? null
    if (d === null) return false
    return d >= 1 - ratio
  }
  const d = liveMetric.distanceToPE?.toNumber() ?? null
  if (d === null) return false
  return Math.abs(d) <= ratio
}

export interface TradeFilterContext {
  priceChanges: PriceChanges
  datedCloses: DatedClose[]
}

export function filterTrade(
  trade: TradeWithMetrics,
  liveMetric: LiveMetrics | undefined,
  scope: TradeScope,
  ctx: TradeFilterContext,
  now: Date = new Date(),
): boolean {
  if (scope.status !== 'any' && trade.status !== scope.status) return false

  if (scope.pnlSign !== 'any') {
    if (trade.status !== 'open') return false
    const pct = liveMetric?.unrealizedPnLPct?.toNumber() ?? null
    if (pct === null) return false
    if (scope.pnlSign === 'winning' && pct <= 0) return false
    if (scope.pnlSign === 'losing' && pct >= 0) return false
  }

  if (scope.drift !== 'any') {
    const state = computeTradeDrift(trade, liveMetric, ctx.priceChanges, ctx.datedCloses, now)
    if (state !== scope.drift) return false
  }

  if (!matchesProximity(liveMetric, scope.proximity)) return false

  return true
}

function activeTrades(trades: TradeWithMetrics[]): TradeWithMetrics[] {
  return trades.filter(
    (t) => t.status === 'plan' || t.status === 'ordered' || t.status === 'open',
  )
}

function openTrades(trades: TradeWithMetrics[]): TradeWithMetrics[] {
  return trades.filter((t) => t.status === 'open')
}

function planOrderedTrades(trades: TradeWithMetrics[]): TradeWithMetrics[] {
  return trades.filter((t) => t.status === 'plan' || t.status === 'ordered')
}

function minNonNull(nums: (number | null)[]): number | null {
  let v: number | null = null
  for (const n of nums) {
    if (n === null) continue
    if (v === null || n < v) v = n
  }
  return v
}

function maxNonNull(nums: (number | null)[]): number | null {
  let v: number | null = null
  for (const n of nums) {
    if (n === null) continue
    if (v === null || n > v) v = n
  }
  return v
}

function driftBehindDays(
  trade: TradeWithMetrics,
  metric: LiveMetrics | undefined,
  priceChanges: PriceChanges,
  datedCloses: DatedClose[],
  now: Date,
): number | null {
  if (trade.status !== 'open') return null
  if (!metric?.currentPrice) return null
  const baseline = trade.dateActual
  if (!baseline) return null
  const baselineKey = toIsoDay(baseline)
  const nowKey = toIsoDay(now)
  if (baselineKey >= nowKey) return null
  const dynamic = computeTimelineRange(metric.currentPrice, trade.takeProfit, priceChanges)
  const projected = computeTimelineRange(
    metric.currentPrice,
    trade.takeProfit,
    computePriceChangesAsOf(datedCloses, baselineKey),
  )
  const drift = computeDrift(dynamic, projected)
  if (!drift) return null
  return drift.state === 'behind' ? Math.max(drift.lo, 0) : 0
}

export interface TickerSortContext {
  indicator: TickerIndicators
  trades: TradeWithMetrics[]
  liveMetrics: Record<number, LiveMetrics>
  now: Date
}

export function tickerSortKeyValue(key: SortKey, ctx: TickerSortContext): number | null {
  const { indicator, trades, liveMetrics, now } = ctx
  if (key === 'symbol') return null
  if (key === 'activeCount') return activeTrades(trades).length
  if (key === 'lrSlope50') return indicator.linearRegression.lr50.slope
  if (key === 'closestToSL') {
    return maxNonNull(openTrades(trades).map((t) => liveMetrics[t.id]?.distanceToSL?.toNumber() ?? null))
  }
  if (key === 'closestToTP') {
    return maxNonNull(openTrades(trades).map((t) => liveMetrics[t.id]?.distanceToTP?.toNumber() ?? null))
  }
  if (key === 'closestToPE') {
    return minNonNull(
      planOrderedTrades(trades).map((t) => {
        const d = liveMetrics[t.id]?.distanceToPE?.toNumber() ?? null
        return d === null ? null : Math.abs(d)
      }),
    )
  }
  if (key === 'biggestWinner') {
    return maxNonNull(openTrades(trades).map((t) => liveMetrics[t.id]?.unrealizedPnLPct?.toNumber() ?? null))
  }
  if (key === 'biggestLoser') {
    return minNonNull(openTrades(trades).map((t) => liveMetrics[t.id]?.unrealizedPnLPct?.toNumber() ?? null))
  }
  if (key === 'oldestOpenAge') {
    return maxNonNull(openTrades(trades).map((t) => calculateOpenAge(t)))
  }
  if (key === 'oldestPlanAge') {
    return maxNonNull(activeTrades(trades).map((t) => calculatePlanAge(t)))
  }
  if (key === 'worstDriftToTP') {
    return maxNonNull(
      openTrades(trades).map((t) =>
        driftBehindDays(t, liveMetrics[t.id], indicator.priceChanges, indicator.datedCloses, now),
      ),
    )
  }
  return null
}

function compareKeys(
  keyA: number | null,
  keyB: number | null,
  symbolA: string,
  symbolB: string,
  dir: SortDir,
): number {
  const factor = dir === 'asc' ? 1 : -1
  if (keyA === null && keyB === null) return symbolA.localeCompare(symbolB)
  if (keyA === null) return 1
  if (keyB === null) return -1
  if (keyA === keyB) return symbolA.localeCompare(symbolB)
  return (keyA - keyB) * factor
}

export function sortTickers(
  indicators: TickerIndicators[],
  tradesBySymbol: Record<string, TradeWithMetrics[]>,
  liveMetrics: Record<number, LiveMetrics>,
  sort: { key: SortKey; dir: SortDir },
  now: Date = new Date(),
): TickerIndicators[] {
  if (sort.key === 'symbol') {
    const copy = [...indicators]
    copy.sort((a, b) => {
      const cmp = a.symbol.localeCompare(b.symbol)
      return sort.dir === 'asc' ? cmp : -cmp
    })
    return copy
  }
  const keyed = indicators.map((ind) => ({
    ind,
    key: tickerSortKeyValue(sort.key, {
      indicator: ind,
      trades: tradesBySymbol[ind.symbol] ?? [],
      liveMetrics,
      now,
    }),
  }))
  keyed.sort((a, b) => compareKeys(a.key, b.key, a.ind.symbol, b.ind.symbol, sort.dir))
  return keyed.map((w) => w.ind)
}

export function tradeSortKeyValue(
  key: SortKey,
  row: TradeRow,
  liveMetrics: Record<number, LiveMetrics>,
  now: Date,
): number | null {
  const { trade, indicator } = row
  const metric = liveMetrics[trade.id]
  if (key === 'symbol' || key === 'activeCount') return null
  if (key === 'lrSlope50') return indicator.linearRegression.lr50.slope
  if (key === 'closestToSL') return metric?.distanceToSL?.toNumber() ?? null
  if (key === 'closestToTP') return metric?.distanceToTP?.toNumber() ?? null
  if (key === 'closestToPE') {
    const d = metric?.distanceToPE?.toNumber() ?? null
    return d === null ? null : Math.abs(d)
  }
  if (key === 'biggestWinner' || key === 'biggestLoser') {
    return metric?.unrealizedPnLPct?.toNumber() ?? null
  }
  if (key === 'oldestOpenAge') return calculateOpenAge(trade)
  if (key === 'oldestPlanAge') return calculatePlanAge(trade)
  if (key === 'worstDriftToTP') {
    return driftBehindDays(trade, metric, indicator.priceChanges, indicator.datedCloses, now)
  }
  return null
}

export function sortTrades(
  rows: TradeRow[],
  liveMetrics: Record<number, LiveMetrics>,
  sort: { key: SortKey; dir: SortDir },
  now: Date = new Date(),
): TradeRow[] {
  if (sort.key === 'symbol') {
    const copy = [...rows]
    copy.sort((a, b) => {
      const cmp = a.indicator.symbol.localeCompare(b.indicator.symbol)
      if (cmp !== 0) return sort.dir === 'asc' ? cmp : -cmp
      return a.trade.id - b.trade.id
    })
    return copy
  }
  const keyed = rows.map((r) => ({ r, key: tradeSortKeyValue(sort.key, r, liveMetrics, now) }))
  keyed.sort((a, b) => {
    const cmp = compareKeys(a.key, b.key, a.r.indicator.symbol, b.r.indicator.symbol, sort.dir)
    if (cmp !== 0) return cmp
    return a.r.trade.id - b.r.trade.id
  })
  return keyed.map((w) => w.r)
}

function hasAnyTradeFilter(scope: TradeScope): boolean {
  return (
    scope.status !== 'any' ||
    scope.pnlSign !== 'any' ||
    scope.drift !== 'any' ||
    scope.proximity !== null
  )
}

export function applyGroupedView(
  indicators: TickerIndicators[],
  tradesBySymbol: Record<string, TradeWithMetrics[]>,
  liveMetrics: Record<number, LiveMetrics>,
  view: RadarViewState,
  now: Date = new Date(),
): { indicators: TickerIndicators[]; tradesBySymbol: Record<string, TradeWithMetrics[]> } {
  const tradeFilterActive = hasAnyTradeFilter(view.trade)
  const filteredTradesBySymbol: Record<string, TradeWithMetrics[]> = {}
  const passingIndicators: TickerIndicators[] = []

  for (const ind of indicators) {
    const trades = tradesBySymbol[ind.symbol] ?? []
    if (!filterTicker(ind, trades, view.ticker)) continue

    const filtered = trades.filter((t) =>
      filterTrade(
        t,
        liveMetrics[t.id],
        view.trade,
        { priceChanges: ind.priceChanges, datedCloses: ind.datedCloses },
        now,
      ),
    )

    if (tradeFilterActive && filtered.length === 0) continue

    passingIndicators.push(ind)
    filteredTradesBySymbol[ind.symbol] = filtered
  }

  const sortedIndicators = sortTickers(
    passingIndicators,
    filteredTradesBySymbol,
    liveMetrics,
    view.sort,
    now,
  )

  return { indicators: sortedIndicators, tradesBySymbol: filteredTradesBySymbol }
}

export function applyFlatView(
  indicators: TickerIndicators[],
  tradesBySymbol: Record<string, TradeWithMetrics[]>,
  liveMetrics: Record<number, LiveMetrics>,
  view: RadarViewState,
  now: Date = new Date(),
): { rows: TradeRow[] } {
  const rows: TradeRow[] = []

  for (const ind of indicators) {
    const trades = tradesBySymbol[ind.symbol] ?? []
    if (!filterTicker(ind, trades, view.ticker)) continue
    for (const trade of trades) {
      if (trade.status !== 'plan' && trade.status !== 'ordered' && trade.status !== 'open') continue
      const passes = filterTrade(
        trade,
        liveMetrics[trade.id],
        view.trade,
        { priceChanges: ind.priceChanges, datedCloses: ind.datedCloses },
        now,
      )
      if (!passes) continue
      rows.push({ trade, indicator: ind })
    }
  }

  return { rows: sortTrades(rows, liveMetrics, view.sort, now) }
}

export const SORT_KEY_LABELS: Record<SortKey, string> = {
  symbol: 'Symbol',
  activeCount: 'Active count',
  lrSlope50: 'Trend (LR 50d)',
  closestToSL: 'Closest to SL',
  closestToTP: 'Closest to TP',
  closestToPE: 'Closest to entry (PE)',
  biggestWinner: 'Biggest winner',
  biggestLoser: 'Biggest loser',
  worstDriftToTP: 'Worst drift to TP',
  oldestOpenAge: 'Oldest open',
  oldestPlanAge: 'Oldest plan',
}

export const SORT_KEY_DEFAULT_DIR: Record<SortKey, SortDir> = {
  symbol: 'asc',
  activeCount: 'desc',
  lrSlope50: 'desc',
  closestToSL: 'desc',
  closestToTP: 'desc',
  closestToPE: 'asc',
  biggestWinner: 'desc',
  biggestLoser: 'asc',
  worstDriftToTP: 'desc',
  oldestOpenAge: 'desc',
  oldestPlanAge: 'desc',
}
