import type { TradeWithMetrics, LiveMetrics } from '../../domain/trade/types'
import type { TickerIndicators } from '../../domain/radar/types'
import { computeTradeEta } from '../../domain/radar/tradeEta'
import {
  computeConvergenceScore,
  type ConvergenceScore,
} from '../../domain/radar/convergenceScore'

export type DriftBadge = 'new' | 'ahead' | 'behind' | 'on pace' | '↘ proj'

export interface OrderedRow {
  tradeId: number
  tradeNumber: number | null
  ticker: string
  tickerName: string | null
  strategyName: string | null
  entryPrice: number
  currentPrice: number | null
  /** Signed `(currentPrice - entryPrice) / entryPrice`. Null when no live price. */
  positionPct: number | null
  /** Days since the order was placed (date_ordered). Null if missing. */
  orderAgeDays: number | null
  planAgeDays: number
  /** Days from plan to order. Null if the order date is missing. */
  planToOrderDays: number | null
  dateOrdered: Date | null
  datePlanned: Date
  amount: number
  isLong: boolean
  driftBadge: DriftBadge | null
  bullishScore: number | null
  avgChangePct5d: number | null
  /** Composite "is the price converging on PE in our favor" score; null when no inputs. */
  convergence: ConvergenceScore | null
}

const MS_PER_DAY = 86_400_000

/** Threshold above which an outstanding order is flagged "stale" in the summary. */
export const STALE_ORDER_DAYS = 30

function daysSince(from: Date, now: Date): number {
  return Math.max(0, Math.round((now.getTime() - from.getTime()) / MS_PER_DAY))
}

function daysBetween(from: Date, to: Date): number {
  return Math.round((to.getTime() - from.getTime()) / MS_PER_DAY)
}

export function buildOrderedRows(
  trades: TradeWithMetrics[],
  metrics: Record<number, LiveMetrics>,
  indicators: TickerIndicators[],
  now: Date = new Date(),
): OrderedRow[] {
  const indicatorByTicker = new Map(
    indicators.map((ind) => [ind.symbol.toUpperCase(), ind] as const),
  )

  return trades
    .filter((t) => t.status === 'ordered')
    .map((t) => {
      const m = metrics[t.id]
      const indicator = indicatorByTicker.get(t.ticker.toUpperCase())

      const eta =
        indicator && indicator.datedCloses.length > 0
          ? computeTradeEta(t, m, indicator.priceChanges, indicator.datedCloses, now)
          : null
      const driftBadge = (eta?.pe?.badge ?? null) as DriftBadge | null
      const positionPct = m?.distanceToPE?.toNumber() ?? null
      const isLong = t.stopLoss.lt(t.entryPrice)

      const convergence = computeConvergenceScore({
        isLong,
        positionPct,
        peEta: eta?.pe ?? null,
        priceChanges: indicator?.priceChanges ?? null,
        sma: indicator?.sma ?? null,
        lr20: indicator?.linearRegression.lr20 ?? null,
        rsi: indicator?.rsi ?? null,
      })

      return {
        tradeId: t.id,
        tradeNumber: t.number,
        ticker: t.ticker,
        tickerName: t.tickerName,
        strategyName: t.strategyName,
        entryPrice: t.entryPrice.toNumber(),
        currentPrice: m?.currentPrice?.toNumber() ?? null,
        positionPct,
        orderAgeDays: t.dateOrdered ? daysSince(t.dateOrdered, now) : null,
        planAgeDays: daysSince(t.datePlanned, now),
        planToOrderDays: t.dateOrdered ? daysBetween(t.datePlanned, t.dateOrdered) : null,
        dateOrdered: t.dateOrdered,
        datePlanned: t.datePlanned,
        amount: t.amount.toNumber(),
        isLong,
        driftBadge,
        bullishScore: indicator?.sma.bullishScore ?? null,
        avgChangePct5d: indicator?.priceChanges.avgChangePct5d ?? null,
        convergence,
      }
    })
}

/**
 * Matches a row against the section's free-text search.
 *
 *  - Empty query → every row matches.
 *  - Pure-digit query → exact match on the human trade number.
 *  - Anything else → case-insensitive substring match on the ticker.
 */
export function matchesQuery(row: OrderedRow, query: string): boolean {
  const q = query.trim()
  if (!q) return true
  if (/^\d+$/.test(q)) {
    // Match either the human-facing trade number or the DB id, since the
    // table's "#" column falls back to the id when number is null.
    return String(row.tradeNumber ?? row.tradeId) === q
  }
  return row.ticker.toLowerCase().includes(q.toLowerCase())
}

function mean(values: number[]): number | null {
  if (values.length === 0) return null
  return values.reduce((a, b) => a + b, 0) / values.length
}

export interface OrderedSummary {
  count: number
  totalCommitted: number
  avgPositionPct: number | null
  avgOrderAgeDays: number | null
  closestToFill: { ticker: string; positionPct: number } | null
  furthestFromFill: { ticker: string; positionPct: number } | null
  staleCount: number
  driftingAwayCount: number
  /** Count whose SMA structure agrees with trade direction (bullish for longs / bearish for shorts). */
  trendAlignedCount: number
  /** Whether any row had radar-derived drift data — drives whether radar KPIs are shown. */
  hasDriftData: boolean
}

export function summarizeOrderedRows(rows: OrderedRow[]): OrderedSummary {
  const totalCommitted = rows.reduce((sum, r) => sum + r.amount, 0)
  const positionPcts = rows
    .map((r) => r.positionPct)
    .filter((v): v is number => v !== null)
  const orderAges = rows
    .map((r) => r.orderAgeDays)
    .filter((v): v is number => v !== null)

  const rowsWithPos = rows.filter(
    (r): r is OrderedRow & { positionPct: number } => r.positionPct !== null,
  )
  const closest =
    rowsWithPos.length === 0
      ? null
      : rowsWithPos.reduce((best, r) =>
          Math.abs(r.positionPct) < Math.abs(best.positionPct) ? r : best,
        )
  const furthest =
    rowsWithPos.length === 0
      ? null
      : rowsWithPos.reduce((worst, r) =>
          Math.abs(r.positionPct) > Math.abs(worst.positionPct) ? r : worst,
        )

  const staleCount = rows.filter(
    (r) => r.orderAgeDays !== null && r.orderAgeDays > STALE_ORDER_DAYS,
  ).length
  const driftingAwayCount = rows.filter((r) => r.driftBadge === 'behind').length
  // SMA "alignment": a bullishScore of 7+/10 reads as a clear bullish stack,
  // 3 or below as a clear bearish stack. Mid range is ambiguous and ignored.
  const trendAlignedCount = rows.filter((r) => {
    if (r.bullishScore === null) return false
    return r.isLong ? r.bullishScore >= 7 : r.bullishScore <= 3
  }).length
  const hasDriftData = rows.some(
    (r) => r.driftBadge !== null || r.bullishScore !== null,
  )

  return {
    count: rows.length,
    totalCommitted,
    avgPositionPct: mean(positionPcts),
    avgOrderAgeDays: mean(orderAges),
    closestToFill: closest
      ? { ticker: closest.ticker, positionPct: closest.positionPct }
      : null,
    furthestFromFill: furthest
      ? { ticker: furthest.ticker, positionPct: furthest.positionPct }
      : null,
    staleCount,
    driftingAwayCount,
    trendAlignedCount,
    hasDriftData,
  }
}
