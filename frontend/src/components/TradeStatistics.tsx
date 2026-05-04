import { observer } from '@legendapp/state/react'
import type { TradeWithMetrics } from '../domain/trade/types'
import type { ExtendedFilter } from '../types/trade'
import { useFundStore, useTradeMetricsStore } from '../container/ContainerContext'
import type { PnLStats } from '../domain/trade/TradeMetricsStore'
import skeletonStyles from '../styles/skeleton.module.css'
import styles from './TradeStatistics.module.css'

interface TradeStatisticsProps {
  allTrades: TradeWithMetrics[]
  filteredTrades: TradeWithMetrics[]
  filter: ExtendedFilter
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
  if (value === Infinity) return '∞'
  return value.toFixed(2)
}

function getPnLClass(value: number): string {
  if (value > 0) return `${styles.statValue} positive`
  if (value < 0) return `${styles.statValue} negative`
  return `${styles.statValue} neutral`
}

const UNREALIZED_ACTIVE: Record<ExtendedFilter, boolean> = {
  all: true, open: true, winning: true, losing: true,
  plan: false, ordered: false, close: false, canceled: false,
  winners: false, losers: false,
}

const REALIZED_ACTIVE: Record<ExtendedFilter, boolean> = {
  all: true, open: false, winning: false, losing: false,
  plan: false, ordered: false, close: true, canceled: false,
  winners: true, losers: true,
}

const Skeleton = ({ minWidth = '4em' }: { minWidth?: string }) => (
  <span className={skeletonStyles.skeleton} style={{ minWidth }}>&nbsp;</span>
)

interface SectionProps {
  title: string
  stats: PnLStats | null
  active: boolean
  baseCurrency: string
  loading: boolean
}

function StatSection({ title, stats, active, baseCurrency, loading }: SectionProps) {
  const showSkeleton = loading || stats === null
  const renderNum = (n: number) => (showSkeleton ? <Skeleton /> : n)
  const renderMoney = (n: number) =>
    showSkeleton ? <Skeleton minWidth="6em" /> : formatCurrency(n, baseCurrency)
  const renderPct = (n: number) =>
    showSkeleton ? <Skeleton /> : `${n.toFixed(1)}%`
  const renderRatio = (n: number) =>
    showSkeleton ? <Skeleton /> : formatProfitFactor(n)

  // Resolve safe values for class colouring even while skeleton is shown.
  const totalPnL = stats?.totalPnL ?? 0
  const winRate = stats?.winRate ?? 0
  const profitFactor = stats?.profitFactor ?? 0

  return (
    <div className={`${styles.section} ${active ? '' : styles.dimmed}`}>
      <div className={styles.sectionTitle}>{title}</div>
      <div className={styles.statGrid}>
        <div className={styles.statItem}>
          <span className={styles.statLabel}>Count</span>
          <span className={styles.statValue}>{renderNum(stats?.count ?? 0)}</span>
        </div>
        <div className={styles.statItem}>
          <span className={styles.statLabel}>Wins</span>
          <span className={`${styles.statValue} positive`}>{renderNum(stats?.wins ?? 0)}</span>
        </div>
        <div className={styles.statItem}>
          <span className={styles.statLabel}>Losses</span>
          <span className={`${styles.statValue} negative`}>{renderNum(stats?.losses ?? 0)}</span>
        </div>
        <div className={styles.statItem}>
          <span className={styles.statLabel}>Win Rate</span>
          <span className={getPnLClass(winRate - 50)}>{renderPct(winRate)}</span>
        </div>
        <div className={styles.statItem}>
          <span className={styles.statLabel}>Total P&L</span>
          <span className={getPnLClass(totalPnL)}>{renderMoney(totalPnL)}</span>
        </div>
        <div className={styles.statItem}>
          <span className={styles.statLabel}>Avg Win</span>
          <span className={`${styles.statValue} positive`}>{renderMoney(stats?.avgWin ?? 0)}</span>
        </div>
        <div className={styles.statItem}>
          <span className={styles.statLabel}>Avg Loss</span>
          <span className={`${styles.statValue} negative`}>{renderMoney(stats?.avgLoss ?? 0)}</span>
        </div>
        <div className={styles.statItem}>
          <span className={styles.statLabel}>Ratio</span>
          <span className={getPnLClass(profitFactor - 1)}>{renderRatio(profitFactor)}</span>
        </div>
      </div>
    </div>
  )
}

export const TradeStatistics = observer(function TradeStatistics({
  allTrades,
  filteredTrades,
  filter,
}: TradeStatisticsProps) {
  const fundStore = useFundStore()
  const tradeMetricsStore = useTradeMetricsStore()
  const baseCurrency = fundStore.baseCurrency$.get()
  const realized = tradeMetricsStore.realized$.get()
  const unrealized = tradeMetricsStore.unrealized$.get()
  const computing = tradeMetricsStore.computing$.get()

  const totalNonCanceled = allTrades.filter((t) => t.status !== 'canceled').length
  const unrealizedActive = UNREALIZED_ACTIVE[filter]
  const realizedActive = REALIZED_ACTIVE[filter]

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
        <StatSection
          title="Unrealized"
          stats={unrealized}
          active={unrealizedActive}
          baseCurrency={baseCurrency}
          loading={computing}
        />
        <StatSection
          title="Realized"
          stats={realized}
          active={realizedActive}
          baseCurrency={baseCurrency}
          loading={computing}
        />
      </div>
    </div>
  )
})
