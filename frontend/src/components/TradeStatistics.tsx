import { Decimal } from '../domain/shared/Decimal'
import type { TradeWithMetrics, LiveMetrics } from '../domain/trade/types'
import type { ExtendedFilter } from '../types/trade'
import styles from './TradeStatistics.module.css'

interface TradeStatisticsProps {
  allTrades: TradeWithMetrics[]
  filteredTrades: TradeWithMetrics[]
  liveMetrics: Record<number, LiveMetrics>
  filter: ExtendedFilter
}

interface PnLStats {
  count: number
  wins: number
  losses: number
  winRate: number
  totalPnL: number
  avgWin: number
  avgLoss: number
  profitFactor: number
}

function emptyStats(): PnLStats {
  return { count: 0, wins: 0, losses: 0, winRate: 0, totalPnL: 0, avgWin: 0, avgLoss: 0, profitFactor: 0 }
}

function buildStats(winPnL: Decimal, lossPnL: Decimal, wins: number, losses: number, count: number): PnLStats {
  const lossAbs = lossPnL.abs()
  return {
    count,
    wins,
    losses,
    winRate: wins + losses > 0 ? (wins / (wins + losses)) * 100 : 0,
    totalPnL: winPnL.minus(lossAbs).toNumber(),
    avgWin: wins > 0 ? winPnL.div(Decimal.from(wins)).toNumber() : 0,
    avgLoss: losses > 0 ? lossAbs.div(Decimal.from(losses)).toNumber() : 0,
    profitFactor: lossAbs.isPositive() ? winPnL.div(lossAbs).toNumber() : winPnL.isPositive() ? Infinity : 0,
  }
}

function calculateRealizedStats(trades: TradeWithMetrics[]): PnLStats {
  const closed = trades.filter((t) => t.status === 'close')
  if (closed.length === 0) return emptyStats()

  const winners = closed.filter((t) => t.exitType === 'tp')
  const losers = closed.filter((t) => t.exitType === 'sl')

  const calculatePnL = (trade: TradeWithMetrics): Decimal =>
    trade.exitPrice
      ? trade.exitPrice.minus(trade.entryPrice).times(Decimal.from(trade.units))
      : Decimal.zero()

  const winPnL = winners.reduce((sum, t) => sum.plus(calculatePnL(t)), Decimal.zero())
  const lossPnL = losers.reduce((sum, t) => sum.plus(calculatePnL(t)), Decimal.zero())

  return buildStats(winPnL, lossPnL, winners.length, losers.length, closed.length)
}

function calculateUnrealizedStats(
  trades: TradeWithMetrics[],
  liveMetrics: Record<number, LiveMetrics>,
): PnLStats {
  const open = trades.filter((t) => t.status === 'open')
  if (open.length === 0) return emptyStats()

  let winPnL = Decimal.zero()
  let lossPnL = Decimal.zero()
  let wins = 0
  let losses = 0

  for (const trade of open) {
    const pnl = liveMetrics[trade.id]?.unrealizedPnL
    if (!pnl) continue
    if (pnl.isPositive()) {
      winPnL = winPnL.plus(pnl)
      wins++
    } else if (pnl.isNegative()) {
      lossPnL = lossPnL.plus(pnl)
      losses++
    }
  }

  return buildStats(winPnL, lossPnL, wins, losses, open.length)
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

function getPnLClass(value: number): string {
  if (value > 0) return `${styles.statValue} positive`
  if (value < 0) return `${styles.statValue} negative`
  return `${styles.statValue} neutral`
}

const SHOW_UNREALIZED: Record<ExtendedFilter, boolean> = {
  all: true,
  open: true,
  plan: false,
  ordered: false,
  close: false,
  canceled: false,
  winners: false,
  losers: false,
}

const SHOW_REALIZED: Record<ExtendedFilter, boolean> = {
  all: true,
  open: false,
  plan: false,
  ordered: false,
  close: true,
  canceled: false,
  winners: true,
  losers: true,
}

interface SectionProps {
  title: string
  stats: PnLStats
}

function StatSection({ title, stats }: SectionProps) {
  return (
    <div className={styles.section}>
      <div className={styles.sectionTitle}>{title}</div>
      <div className={styles.statGrid}>
        <div className={styles.statItem}>
          <span className={styles.statLabel}>Count</span>
          <span className={styles.statValue}>{stats.count}</span>
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
          <span className={getPnLClass(stats.winRate - 50)}>{stats.winRate.toFixed(1)}%</span>
        </div>
        <div className={styles.statItem}>
          <span className={styles.statLabel}>Total P&L</span>
          <span className={getPnLClass(stats.totalPnL)}>{formatCurrency(stats.totalPnL)}</span>
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
          <span className={styles.statLabel}>Ratio</span>
          <span className={getPnLClass(stats.profitFactor - 1)}>{formatProfitFactor(stats.profitFactor)}</span>
        </div>
      </div>
    </div>
  )
}

export function TradeStatistics({ allTrades, filteredTrades, liveMetrics, filter }: TradeStatisticsProps) {
  const totalNonCanceled = allTrades.filter((t) => t.status !== 'canceled').length
  const showUnrealized = SHOW_UNREALIZED[filter]
  const showRealized = SHOW_REALIZED[filter]

  const unrealizedStats = showUnrealized ? calculateUnrealizedStats(filteredTrades, liveMetrics) : null
  const realizedStats = showRealized ? calculateRealizedStats(filteredTrades) : null

  return (
    <div className={styles.tradeStatistics}>
      <div className={styles.headerRow}>
        <div className={styles.statItem}>
          <span className={styles.statLabel}>Selected</span>
          <span className={styles.statValue}>{filteredTrades.length}</span>
        </div>
        <div className={styles.statItem}>
          <span className={styles.statLabel}>Total</span>
          <span className={styles.statValue}>{totalNonCanceled}</span>
        </div>
      </div>
      {unrealizedStats && <StatSection title="Unrealized" stats={unrealizedStats} />}
      {realizedStats && <StatSection title="Realized" stats={realizedStats} />}
    </div>
  )
}
