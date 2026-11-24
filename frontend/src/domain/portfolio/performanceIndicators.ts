import { buildIndexIndicators } from '../radar/indicatorBuild'
import type { TickerIndicators } from '../radar/types'
import type { PortfolioHistory } from './types'

/**
 * A Portfolio's indicator set — Momentum Score and radar measures — measured
 * on its Performance Index through the same builder as tickers, Basket Indexes
 * and benchmarks. The index is both the close and the adjusted close: it is
 * already free of Buys, Sells and splits, which is what measurement wants.
 */
export function buildPerformanceIndicators(key: string, history: PortfolioHistory): TickerIndicators {
  return buildIndexIndicators(
    key,
    history.rows.map((r) => ({ date: r.date, value: r.performanceIndex })),
    null,
  )
}
