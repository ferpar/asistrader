import { useEffect, useState, useCallback } from 'react'
import { TradeTable } from './components/TradeTable'
import { TradeFilters, StatusFilter } from './components/TradeFilters'
import { TradeCreationForm } from './components/TradeCreationForm'
import { MarketDataSync } from './components/MarketDataSync'
import { TickerSearchInput } from './components/TickerSearchInput'
import { fetchTrades } from './api/trades'
import { fetchTickers } from './api/tickers'
import { Trade, Ticker } from './types/trade'
import './App.css'

function App() {
  const [trades, setTrades] = useState<Trade[]>([])
  const [tickers, setTickers] = useState<Ticker[]>([])
  const [selectedTicker, setSelectedTicker] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')

  const loadTrades = useCallback(async () => {
    try {
      setLoading(true)
      const response = await fetchTrades()
      setTrades(response.trades)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load trades')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadTrades()
  }, [loadTrades])

  return (
    <div className="app">
      <header className="header">
        <h1>AsisTrader</h1>
        <p>Trading Operations Management</p>
      </header>
      <main className="main">
        <MarketDataSync />
        <TradeCreationForm onTradeCreated={loadTrades} />
        <section className="trades-section">
          <h2>Trades</h2>
          <TradeFilters value={statusFilter} onChange={setStatusFilter} />
          <TradeTable
            trades={statusFilter === 'all' ? trades : trades.filter(t => t.status === statusFilter)}
            loading={loading}
            error={error}
            onTradeUpdated={loadTrades}
          />
        </section>
      </main>
    </div>
  )
}

export default App
