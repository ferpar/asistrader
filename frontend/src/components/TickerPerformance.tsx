import { useMemo } from 'react'
import { Decimal } from '../domain/shared/Decimal'
import type { TradeWithMetrics } from '../domain/trade/types'
import { formatPrice } from '../utils/priceFormat'
import styles from './TickerPerformance.module.css'

interface TickerStats {
  symbol: string
  currency: string | null
  priceHint: number | null
  tradeCount: number
  wins: number
  losses: number
  winRate: number
  totalPnL: number
  avgPnL: number
}

function calculateTickerPerformance(trades: TradeWithMetrics[]): TickerStats[] {
  const closedTrades = trades.filter(t => t.status === 'close')

  // Group by ticker
  const byTicker = new Map<string, TradeWithMetrics[]>()
  closedTrades.forEach(trade => {
    const list = byTicker.get(trade.ticker) || []
    list.push(trade)
    byTicker.set(trade.ticker, list)
  })

  // Calculate stats per ticker
  const stats: TickerStats[] = []
  byTicker.forEach((tickerTrades, symbol) => {
    const winners = tickerTrades.filter(t => t.exitType === 'tp')
    const losers = tickerTrades.filter(t => t.exitType === 'sl')

    const calculatePnL = (t: TradeWithMetrics): Decimal =>
      t.exitPrice
        ? t.exitPrice.minus(t.entryPrice).times(Decimal.from(t.units))
        : Decimal.zero()

    const totalPnL = tickerTrades.reduce((sum, t) => sum.plus(calculatePnL(t)), Decimal.zero())

    stats.push({
      symbol,
      currency: tickerTrades[0]?.tickerCurrency ?? null,
      priceHint: tickerTrades[0]?.tickerPriceHint ?? null,
      tradeCount: tickerTrades.length,
      wins: winners.length,
      losses: losers.length,
      winRate: tickerTrades.length > 0
        ? (winners.length / tickerTrades.length) * 100
        : 0,
      totalPnL: totalPnL.toNumber(),
      avgPnL: tickerTrades.length > 0 ? totalPnL.div(Decimal.from(tickerTrades.length)).toNumber() : 0,
    })
  })

  // Sort by totalPnL descending (best performers first)
  return stats.sort((a, b) => b.totalPnL - a.totalPnL)
}

interface TickerPerformanceProps {
  trades: TradeWithMetrics[]
}

export function TickerPerformance({ trades }: TickerPerformanceProps) {
  const tickerStats = useMemo(() => calculateTickerPerformance(trades), [trades])

  if (tickerStats.length === 0) {
    return null  // Don't show if no closed trades
  }

  return (
    <div className={styles.tickerPerformance}>
      <h3>Performance by Ticker</h3>
      <table className={styles.tickerPerformanceTable}>
        <thead>
          <tr>
            <th>Ticker</th>
            <th>Trades</th>
            <th>W/L</th>
            <th>Win Rate</th>
            <th>Total P&L</th>
            <th>Avg P&L</th>
          </tr>
        </thead>
        <tbody>
          {tickerStats.map(stat => (
            <tr key={stat.symbol}>
              <td className={styles.tickerSymbol}>{stat.symbol}</td>
              <td>{stat.tradeCount}</td>
              <td>{stat.wins}/{stat.losses}</td>
              <td>{stat.winRate.toFixed(1)}%</td>
              <td className={stat.totalPnL >= 0 ? 'positive' : 'negative'}>
                {formatPrice(stat.totalPnL, stat.currency, stat.priceHint)}
              </td>
              <td className={stat.avgPnL >= 0 ? 'positive' : 'negative'}>
                {formatPrice(stat.avgPnL, stat.currency, stat.priceHint)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
