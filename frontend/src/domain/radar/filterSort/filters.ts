import type { TickerIndicators, PriceChanges, DatedClose } from '../types'
import type { TradeWithMetrics, LiveMetrics } from '../../trade/types'
import {
  computeTimelineRange,
  computeDrift,
  type DriftState,
} from '../../../utils/timelineExpectations'
import { computePriceChangesAsOf } from '../indicators'
import type {
  StructureCategory,
  TrendSignFilter,
  ActivityFilter,
  ProximityFilter,
  TickerScope,
  TradeScope,
} from './types'

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

export function hasAnyTradeFilter(scope: TradeScope): boolean {
  return (
    scope.status !== 'any' ||
    scope.pnlSign !== 'any' ||
    scope.drift !== 'any' ||
    scope.proximity !== null
  )
}
