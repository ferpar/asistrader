import type { TickerIndicators } from '../types'
import type { TradeWithMetrics, LiveMetrics } from '../../trade/types'
import { filterTicker, filterTrade, hasAnyTradeFilter } from './filters'
import { sortTickers, sortTrades } from './sort'
import type { RadarViewState, TradeRow } from './types'

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
