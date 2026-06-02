import { observer } from '@legendapp/state/react'
import { formatPrice } from '../utils/priceFormat'
import { useTradeMetricsStore } from '../container/ContainerContext'
import { useMultiSort, useSortedRows } from '../hooks/useMultiSort'
import { useTopN } from '../hooks/useTopN'
import { CollapsibleSection } from './CollapsibleSection'
import { SortableTh } from './table/SortableTh'
import { ShowMore } from './table/ShowMore'
import skeletonStyles from '../styles/skeleton.module.css'
import styles from './TickerPerformance.module.css'

const SKELETON_ROW_COUNT = 3
const ROW_LIMIT = 12

type PerfKey = 'symbol' | 'trades' | 'wl' | 'winRate' | 'totalPnL' | 'avgPnL'

export const TickerPerformance = observer(function TickerPerformance() {
  const tradeMetricsStore = useTradeMetricsStore()
  const tickerStats = tradeMetricsStore.perTicker$.get()
  const computing = tradeMetricsStore.computing$.get()

  // Skeleton on every recompute (cold + every base-currency switch / data load).
  const showSkeleton = computing || tickerStats === null
  const stats = tickerStats ?? []

  const sort = useMultiSort<PerfKey>([{ key: 'totalPnL', dir: 'desc' }])
  const sorted = useSortedRows(stats, sort.terms, (s, key) => {
    switch (key) {
      case 'symbol':
        return s.symbol
      case 'trades':
        return s.tradeCount
      case 'wl':
        return s.wins
      case 'winRate':
        return s.winRate
      case 'totalPnL':
        return s.totalPnL
      case 'avgPnL':
        return s.avgPnL
    }
  })
  const top = useTopN(sorted, ROW_LIMIT)

  if (!showSkeleton && stats.length === 0) {
    return null // No closed trades — original behavior.
  }

  const body = (
    <>
      <table className={styles.tickerPerformanceTable}>
        <thead>
          <tr>
            <SortableTh label="Ticker" sortKey="symbol" sort={sort} />
            <SortableTh label="Trades" sortKey="trades" sort={sort} />
            <SortableTh label="W/L" sortKey="wl" sort={sort} />
            <SortableTh label="Win Rate" sortKey="winRate" sort={sort} />
            <SortableTh label="Total P&L" sortKey="totalPnL" sort={sort} />
            <SortableTh label="Avg P&L" sortKey="avgPnL" sort={sort} />
          </tr>
        </thead>
        <tbody>
          {showSkeleton
            ? Array.from({ length: SKELETON_ROW_COUNT }).map((_, i) => (
                <tr key={`skel-${i}`}>
                  <td>
                    <span className={skeletonStyles.skeleton} style={{ minWidth: '4em' }}>&nbsp;</span>
                  </td>
                  <td><span className={skeletonStyles.skeleton}>&nbsp;</span></td>
                  <td><span className={skeletonStyles.skeleton}>&nbsp;</span></td>
                  <td><span className={skeletonStyles.skeleton}>&nbsp;</span></td>
                  <td><span className={skeletonStyles.skeleton} style={{ minWidth: '5em' }}>&nbsp;</span></td>
                  <td><span className={skeletonStyles.skeleton} style={{ minWidth: '5em' }}>&nbsp;</span></td>
                </tr>
              ))
            : top.visible.map((stat) => (
                <tr key={stat.symbol}>
                  <td className={styles.tickerSymbol}>{stat.symbol}</td>
                  <td>{stat.tradeCount}</td>
                  <td>
                    {stat.wins}/{stat.losses}
                  </td>
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
      {top.canExpand && <ShowMore expanded={top.expanded} total={top.total} onToggle={top.toggle} />}
    </>
  )

  return (
    <CollapsibleSection
      title="Performance by Ticker"
      persistKey="trades:tickerPerf"
      defaultExpanded={false}
      count={showSkeleton ? undefined : stats.length}
    >
      {body}
    </CollapsibleSection>
  )
})
