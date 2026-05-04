import { observer } from '@legendapp/state/react'
import { Decimal } from '../domain/shared/Decimal'
import type { TradeWithMetrics, LiveMetrics } from '../domain/trade/types'
import type { ExtendedFilter } from '../types/trade'
import { useFxStore, useFundStore } from '../container/ContainerContext'
import type { FxStore } from '../domain/fx/FxStore'
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

/** Convert via FxStore, skipping the trade if its rate isn't loaded yet. */
function convertOrSkip(
  amount: Decimal,
  fromCcy: string | null,
  baseCurrency: string,
  onDate: Date,
  fxStore: FxStore,
): Decimal | null {
  const ccy = fromCcy || baseCurrency
  if (ccy === baseCurrency) return amount
  try {
    return fxStore.convert(amount, ccy, baseCurrency, onDate)
  } catch {
    return null
  }
}

function calculateRealizedStats(
  trades: TradeWithMetrics[],
  baseCurrency: string,
  fxStore: FxStore,
): PnLStats {
  const closed = trades.filter((t) => t.status === 'close')
  if (closed.length === 0) return emptyStats()

  let winPnL = Decimal.zero()
  let lossPnL = Decimal.zero()
  let wins = 0
  let losses = 0

  for (const trade of closed) {
    if (!trade.exitPrice || !trade.exitDate) continue
    const pnlNative = trade.exitPrice
      .minus(trade.entryPrice)
      .times(Decimal.from(trade.units))
    const pnlInBase = convertOrSkip(
      pnlNative,
      trade.tickerCurrency,
      baseCurrency,
      trade.exitDate,
      fxStore,
    )
    if (pnlInBase === null) continue
    if (trade.exitType === 'tp') {
      winPnL = winPnL.plus(pnlInBase)
      wins++
    } else if (trade.exitType === 'sl') {
      lossPnL = lossPnL.plus(pnlInBase)
      losses++
    }
  }

  return buildStats(winPnL, lossPnL, wins, losses, closed.length)
}

function calculateUnrealizedStats(
  trades: TradeWithMetrics[],
  liveMetrics: Record<number, LiveMetrics>,
  baseCurrency: string,
  fxStore: FxStore,
): PnLStats {
  const open = trades.filter((t) => t.status === 'open')
  if (open.length === 0) return emptyStats()

  const today = new Date()
  let winPnL = Decimal.zero()
  let lossPnL = Decimal.zero()
  let wins = 0
  let losses = 0

  for (const trade of open) {
    const pnlNative = liveMetrics[trade.id]?.unrealizedPnL
    if (!pnlNative) continue
    const pnlInBase = convertOrSkip(
      pnlNative,
      trade.tickerCurrency,
      baseCurrency,
      today,
      fxStore,
    )
    if (pnlInBase === null) continue
    if (pnlInBase.isPositive()) {
      winPnL = winPnL.plus(pnlInBase)
      wins++
    } else if (pnlInBase.isNegative()) {
      lossPnL = lossPnL.plus(pnlInBase)
      losses++
    }
  }

  return buildStats(winPnL, lossPnL, wins, losses, open.length)
}

function formatCurrency(value: number, currency: string): string {
  return value.toLocaleString('en-US', {
    style: 'currency',
    currency,
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

const UNREALIZED_ACTIVE: Record<ExtendedFilter, boolean> = {
  all: true,
  open: true,
  winning: true,
  losing: true,
  plan: false,
  ordered: false,
  close: false,
  canceled: false,
  winners: false,
  losers: false,
}

const REALIZED_ACTIVE: Record<ExtendedFilter, boolean> = {
  all: true,
  open: false,
  winning: false,
  losing: false,
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
  active: boolean
  baseCurrency: string
}

function StatSection({ title, stats, active, baseCurrency }: SectionProps) {
  return (
    <div className={`${styles.section} ${active ? '' : styles.dimmed}`}>
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
          <span className={getPnLClass(stats.totalPnL)}>{formatCurrency(stats.totalPnL, baseCurrency)}</span>
        </div>
        <div className={styles.statItem}>
          <span className={styles.statLabel}>Avg Win</span>
          <span className={`${styles.statValue} positive`}>{formatCurrency(stats.avgWin, baseCurrency)}</span>
        </div>
        <div className={styles.statItem}>
          <span className={styles.statLabel}>Avg Loss</span>
          <span className={`${styles.statValue} negative`}>{formatCurrency(stats.avgLoss, baseCurrency)}</span>
        </div>
        <div className={styles.statItem}>
          <span className={styles.statLabel}>Ratio</span>
          <span className={getPnLClass(stats.profitFactor - 1)}>{formatProfitFactor(stats.profitFactor)}</span>
        </div>
      </div>
    </div>
  )
}

export const TradeStatistics = observer(function TradeStatistics({
  allTrades,
  filteredTrades,
  liveMetrics,
  filter,
}: TradeStatisticsProps) {
  const fxStore = useFxStore()
  const fundStore = useFundStore()
  const baseCurrency = fundStore.baseCurrency$.get()
  // Re-render once FX history hydrates so per-trade conversions land.
  fxStore.loaded$.get()

  const totalNonCanceled = allTrades.filter((t) => t.status !== 'canceled').length
  const unrealizedActive = UNREALIZED_ACTIVE[filter]
  const realizedActive = REALIZED_ACTIVE[filter]

  const unrealizedStats = calculateUnrealizedStats(filteredTrades, liveMetrics, baseCurrency, fxStore)
  const realizedStats = calculateRealizedStats(filteredTrades, baseCurrency, fxStore)

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
      <div className={styles.sectionsRow}>
        <StatSection title="Unrealized" stats={unrealizedStats} active={unrealizedActive} baseCurrency={baseCurrency} />
        <StatSection title="Realized" stats={realizedStats} active={realizedActive} baseCurrency={baseCurrency} />
      </div>
    </div>
  )
})
