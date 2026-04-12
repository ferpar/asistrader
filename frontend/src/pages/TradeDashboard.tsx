import { useEffect } from 'react'
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
  const filteredTrades = store.filteredTrades$.get()
  const liveMetrics = liveMetricsStore.metrics$.get()
  const loading = store.loading$.get()
  const error = store.error$.get()
  const filter = store.filter$.get()

  return (
    <>
      <TradeActionBar />
      <section className="trades-section">
        <h2>Trades</h2>
        <TradeStatistics
          allTrades={allTrades}
          filteredTrades={filteredTrades}
          liveMetrics={liveMetrics}
          filter={filter}
        />
        <TickerPerformance trades={store.trades$.get()} />
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
