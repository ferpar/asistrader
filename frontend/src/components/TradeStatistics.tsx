import { Decimal } from '../domain/shared/Decimal'
import type { TradeWithMetrics } from '../domain/trade/types'
import styles from './TradeStatistics.module.css'

interface TradeStatisticsProps {
  trades: TradeWithMetrics[]
}

interface Statistics {
  totalTrades: number
  closedTrades: number
  wins: number
  losses: number
  winRate: number
  totalPnL: number
  avgWin: number
  avgLoss: number
  profitFactor: number
}

function calculateStatistics(trades: TradeWithMetrics[]): Statistics {
  const closedTrades = trades.filter(t => t.status === 'close')
  const winners = closedTrades.filter(t => t.exitType === 'tp')
  const losers = closedTrades.filter(t => t.exitType === 'sl')

  const calculatePnL = (trade: TradeWithMetrics): Decimal =>
    trade.exitPrice
      ? trade.exitPrice.minus(trade.entryPrice).times(Decimal.from(trade.units))
      : Decimal.zero()

  const winPnL = winners.reduce((sum, t) => sum.plus(calculatePnL(t)), Decimal.zero())
  const lossPnL = losers.reduce((sum, t) => sum.plus(calculatePnL(t)), Decimal.zero()).abs()

  return {
    totalTrades: trades.length,
    closedTrades: closedTrades.length,
    wins: winners.length,
    losses: losers.length,
    winRate: closedTrades.length > 0 ? (winners.length / closedTrades.length) * 100 : 0,
    totalPnL: winPnL.minus(lossPnL).toNumber(),
    avgWin: winners.length > 0 ? winPnL.div(Decimal.from(winners.length)).toNumber() : 0,
    avgLoss: losers.length > 0 ? lossPnL.div(Decimal.from(losers.length)).toNumber() : 0,
    profitFactor: lossPnL.isPositive() ? winPnL.div(lossPnL).toNumber() : winPnL.isPositive() ? Infinity : 0,
  }
}

function formatCurrency(value: number): string {
  return value.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}

function formatProfitFactor(value: number): string {
  if (value === Infinity) return '\u221E'
  return value.toFixed(2)
}

export function TradeStatistics({ trades }: TradeStatisticsProps) {
  const stats = calculateStatistics(trades)

  const getPnLClass = (value: number): string => {
    if (value > 0) return `${styles.statValue} positive`
    if (value < 0) return `${styles.statValue} negative`
    return `${styles.statValue} neutral`
  }

  return (
    <div className={styles.tradeStatistics}>
      <div className={styles.statItem}>
        <span className={styles.statLabel}>Total</span>
        <span className={styles.statValue}>{stats.totalTrades}</span>
      </div>
      <div className={styles.statItem}>
        <span className={styles.statLabel}>Closed</span>
        <span className={styles.statValue}>{stats.closedTrades}</span>
      </div>
      <div className={styles.statItem}>
        <span className={styles.statLabel}>Wins</span>
        <span className={`${styles.statValue} positive`}>{stats.wins}</span>
      </div>
      <div className={styles.statItem}>
        <span className={styles.statLabel}>Losses</span>
        <span className={`${styles.statValue} negative`}>{stats.losses}</span>
      </div>
      <div className={styles.statItem}>
        <span className={styles.statLabel}>Win Rate</span>
        <span className={getPnLClass(stats.winRate - 50)}>
          {stats.winRate.toFixed(1)}%
        </span>
      </div>
      <div className={styles.statItem}>
        <span className={styles.statLabel}>Total P&L</span>
        <span className={getPnLClass(stats.totalPnL)}>
          {formatCurrency(stats.totalPnL)}
        </span>
      </div>
      <div className={styles.statItem}>
        <span className={styles.statLabel}>Avg Win</span>
        <span className={`${styles.statValue} positive`}>{formatCurrency(stats.avgWin)}</span>
      </div>
      <div className={styles.statItem}>
        <span className={styles.statLabel}>Avg Loss</span>
        <span className={`${styles.statValue} negative`}>{formatCurrency(stats.avgLoss)}</span>
      </div>
      <div className={styles.statItem}>
        <span className={styles.statLabel}>Profit Factor</span>
        <span className={getPnLClass(stats.profitFactor - 1)}>
          {formatProfitFactor(stats.profitFactor)}
        </span>
      </div>
    </div>
  )
}
