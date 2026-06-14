import type { TradeWithMetrics, LiveMetrics } from '../../domain/trade/types'
import type { TickerIndicators } from '../../domain/radar/types'
import { computeTradeEta, type TradeEtaCell } from '../../domain/radar/tradeEta'
import { computeOpenHealthScore, type OpenHealthScore } from '../../domain/radar/openHealthScore'
import { getPositionNum } from '../../utils/tradeLive'

/** Which side of PE the current price sits on, for an open position. */
export type Segment = 'profit' | 'loss' | 'flat'

export interface OpenRow {
  tradeId: number
  tradeNumber: number | null
  ticker: string
  tickerName: string | null
  strategyName: string | null
  entryPrice: number
  currentPrice: number | null
  stopLoss: number
  takeProfit: number
  /**
   * Signed progress along the active rail: `+` = fraction of the way from PE to
   * TP (in profit), `−` = fraction from PE to SL (in loss). 0 = at PE. Null when
   * there's no live price. From `getPositionNum`.
   */
  positionToTarget: number | null
  /** `(current − PE) / (TP − PE)` — 1 = at TP. Null when no live price. */
  distanceToTP: number | null
  /** `(current − PE) / (SL − PE)` — 1 = at SL. Null when no live price. */
  distanceToSL: number | null
  unrealizedPnLPct: number | null
  amount: number
  /** Days since the position was opened (dateActual). Null if missing. */
  holdingDays: number | null
  segment: Segment
  isLong: boolean
  bullishScore: number | null
  avgChangePct5d: number | null
  /** ETA cells for the two targets — open trades get tp/sl (not pe). */
  tpEta: TradeEtaCell | null
  slEta: TradeEtaCell | null
  /** Segment-aware health: + trending toward TP, − toward SL. */
  health: OpenHealthScore | null
}

const MS_PER_DAY = 86_400_000

/** Threshold above which an open position is flagged "stale" in the summary. */
export const STALE_HOLDING_DAYS = 90

function daysSince(from: Date, now: Date): number {
  return Math.max(0, Math.round((now.getTime() - from.getTime()) / MS_PER_DAY))
}

function segmentOf(positionToTarget: number | null): Segment {
  if (positionToTarget === null || positionToTarget === 0) return 'flat'
  return positionToTarget > 0 ? 'profit' : 'loss'
}

export function buildOpenRows(
  trades: TradeWithMetrics[],
  metrics: Record<number, LiveMetrics>,
  indicators: TickerIndicators[],
  now: Date = new Date(),
): OpenRow[] {
  const indicatorByTicker = new Map(
    indicators.map((ind) => [ind.symbol.toUpperCase(), ind] as const),
  )

  return trades
    .filter((t) => t.status === 'open')
    .map((t) => {
      const m = metrics[t.id]
      const indicator = indicatorByTicker.get(t.ticker.toUpperCase())

      const eta =
        indicator && indicator.datedCloses.length > 0
          ? computeTradeEta(t, m, indicator.priceChanges, indicator.datedCloses, now)
          : null

      const positionToTarget = getPositionNum(m)
      const segment = segmentOf(positionToTarget)

      const health = computeOpenHealthScore({
        segment,
        isLong: t.stopLoss.lt(t.entryPrice),
        tpEta: eta?.tp ?? null,
        slEta: eta?.sl ?? null,
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
        stopLoss: t.stopLoss.toNumber(),
        takeProfit: t.takeProfit.toNumber(),
        positionToTarget,
        distanceToTP: m?.distanceToTP?.toNumber() ?? null,
        distanceToSL: m?.distanceToSL?.toNumber() ?? null,
        unrealizedPnLPct: m?.unrealizedPnLPct?.toNumber() ?? null,
        amount: t.amount.toNumber(),
        holdingDays: t.dateActual ? daysSince(t.dateActual, now) : null,
        segment,
        isLong: t.stopLoss.lt(t.entryPrice),
        bullishScore: indicator?.sma.bullishScore ?? null,
        avgChangePct5d: indicator?.priceChanges.avgChangePct5d ?? null,
        tpEta: eta?.tp ?? null,
        slEta: eta?.sl ?? null,
        health,
      }
    })
}

function mean(values: number[]): number | null {
  if (values.length === 0) return null
  return values.reduce((a, b) => a + b, 0) / values.length
}

export interface OpenSummary {
  count: number
  totalCommitted: number
  avgPnLPct: number | null
  avgHoldingDays: number | null
  /** The open trade with the smallest remaining distance to its take-profit. */
  closestToTP: { ticker: string; distanceToTP: number } | null
  /** The open trade with the smallest remaining distance to its stop-loss. */
  closestToSL: { ticker: string; distanceToSL: number } | null
  inProfitCount: number
  inLossCount: number
  staleCount: number
}

export function summarizeOpenRows(rows: OpenRow[]): OpenSummary {
  const pnls = rows
    .map((r) => r.unrealizedPnLPct)
    .filter((v): v is number => v !== null)
  const holdings = rows
    .map((r) => r.holdingDays)
    .filter((v): v is number => v !== null)

  // Closest to TP: the in-profit row with the highest distanceToTP (nearest 1).
  const profitRows = rows.filter(
    (r): r is OpenRow & { distanceToTP: number } =>
      r.distanceToTP !== null && r.segment === 'profit',
  )
  const closestToTP =
    profitRows.length === 0
      ? null
      : profitRows.reduce((best, r) => (r.distanceToTP > best.distanceToTP ? r : best))

  // Closest to SL: the in-loss row with the highest distanceToSL (nearest 1).
  const lossRows = rows.filter(
    (r): r is OpenRow & { distanceToSL: number } =>
      r.distanceToSL !== null && r.segment === 'loss',
  )
  const closestToSL =
    lossRows.length === 0
      ? null
      : lossRows.reduce((best, r) => (r.distanceToSL > best.distanceToSL ? r : best))

  return {
    count: rows.length,
    totalCommitted: rows.reduce((sum, r) => sum + r.amount, 0),
    avgPnLPct: mean(pnls),
    avgHoldingDays: mean(holdings),
    closestToTP: closestToTP
      ? { ticker: closestToTP.ticker, distanceToTP: closestToTP.distanceToTP }
      : null,
    closestToSL: closestToSL
      ? { ticker: closestToSL.ticker, distanceToSL: closestToSL.distanceToSL }
      : null,
    inProfitCount: rows.filter((r) => r.segment === 'profit').length,
    inLossCount: rows.filter((r) => r.segment === 'loss').length,
    staleCount: rows.filter((r) => r.holdingDays !== null && r.holdingDays > STALE_HOLDING_DAYS)
      .length,
  }
}
