import type { TickerIndicators, PriceChanges, DatedClose } from '../types'
import type { TradeWithMetrics, LiveMetrics } from '../../trade/types'
import { computeTimelineRange, computeDrift } from '../../../utils/timelineExpectations'
import { computePriceChangesAsOf } from '../indicators'
import { calculatePlanAge, calculateOpenAge } from '../../../utils/trade'
import type { SortKey, SortDir, TradeRow } from './types'

function toIsoDay(d: Date): string {
  return d.toISOString().slice(0, 10)
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
