import { observer } from '@legendapp/state/react'
import { formatPrice } from '../utils/priceFormat'
import { useTradeMetricsStore } from '../container/ContainerContext'
import skeletonStyles from '../styles/skeleton.module.css'
import styles from './TickerPerformance.module.css'

const SKELETON_ROW_COUNT = 3

export const TickerPerformance = observer(function TickerPerformance() {
  const tradeMetricsStore = useTradeMetricsStore()
  const tickerStats = tradeMetricsStore.perTicker$.get()
  const computing = tradeMetricsStore.computing$.get()

  // Skeleton on every recompute (cold + every base-currency switch / data load).
  const showSkeleton = computing || tickerStats === null

  if (!showSkeleton && tickerStats!.length === 0) {
    return null  // No closed trades — original behavior.
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
            : tickerStats!.map((stat) => (
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
    </div>
  )
})
