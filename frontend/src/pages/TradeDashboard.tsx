import { useEffect, useMemo } from 'react'
import { observer } from '@legendapp/state/react'
import { TradeTable } from '../components/TradeTable'
import { TradeFilters } from '../components/TradeFilters'
import { TradeStatistics } from '../components/TradeStatistics'
import { TickerPerformance } from '../components/TickerPerformance'
import { TradeActionBar } from '../components/TradeActionBar'
import { useTradeStore, useLiveMetricsStore } from '../container/ContainerContext'

export const TradeDashboard = observer(function TradeDashboard() {
  const store = useTradeStore()
  const liveMetricsStore = useLiveMetricsStore()

  useEffect(() => {
    store.loadTrades()
  }, [store])

  const allTrades = store.trades$.get()
  const baseFilteredTrades = store.filteredTrades$.get()
  const liveMetrics = liveMetricsStore.metrics$.get()
  const loading = store.loading$.get()
  const error = store.error$.get()
  const filter = store.filter$.get()

  const filteredTrades = useMemo(() => {
    if (filter === 'winning') {
      return baseFilteredTrades.filter((t) => {
        const pnl = liveMetrics[t.id]?.unrealizedPnL
        return pnl?.isPositive() ?? false
      })
    }
    if (filter === 'losing') {
      return baseFilteredTrades.filter((t) => {
        const pnl = liveMetrics[t.id]?.unrealizedPnL
        return pnl?.isNegative() ?? false
      })
    }
    return baseFilteredTrades
  }, [baseFilteredTrades, filter, liveMetrics])

  return (
    <>
      <TradeActionBar />
      <section className="trades-section">
        <h2>Trades</h2>
        <TradeStatistics
          allTrades={allTrades}
          filteredTrades={filteredTrades}
          filter={filter}
        />
        <TickerPerformance />
        <TradeFilters value={filter} onChange={(f) => store.setFilter(f)} />
        <TradeTable
          trades={filteredTrades}
          loading={loading}
          error={error}
        />
      </section>
    </>
  )
})
