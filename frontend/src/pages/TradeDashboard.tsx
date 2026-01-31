import { useEffect } from 'react'
import { observer } from '@legendapp/state/react'
import { TradeTable } from '../components/TradeTable'
import { TradeFilters } from '../components/TradeFilters'
import { TradeStatistics } from '../components/TradeStatistics'
import { TickerPerformance } from '../components/TickerPerformance'
import { TradeCreationForm } from '../components/TradeCreationForm'
import { MarketDataSync } from '../components/MarketDataSync'
import { TradeAlertBanner } from '../components/TradeAlertBanner'
import { useTradeStore } from '../container/ContainerContext'

export const TradeDashboard = observer(function TradeDashboard() {
  const store = useTradeStore()

  useEffect(() => {
    store.loadTrades()
  }, [store])

  const filteredTrades = store.filteredTrades$.get()
  const loading = store.loading$.get()
  const error = store.error$.get()
  const filter = store.filter$.get()

  return (
    <>
      <MarketDataSync />
      <TradeCreationForm />
      <TradeAlertBanner />
      <section className="trades-section">
        <h2>Trades</h2>
        <TradeStatistics trades={filteredTrades} />
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
