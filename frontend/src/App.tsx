import { useEffect, useState } from 'react'
import { TradeTable } from './components/TradeTable'
import { TradeFilters, StatusFilter } from './components/TradeFilters'
import { MarketDataSync } from './components/MarketDataSync'
import { fetchTrades } from './api/trades'
import { Trade } from './types/trade'
import './App.css'

function App() {
  const [trades, setTrades] = useState<Trade[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')

  useEffect(() => {
    const loadTrades = async () => {
      try {
        const response = await fetchTrades()
        setTrades(response.trades)
        setError(null)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load trades')
      } finally {
        setLoading(false)
      }
    }

    loadTrades()
  }, [])

  return (
    <div className="app">
      <header className="header">
        <h1>AsisTrader</h1>
        <p>Trading Operations Management</p>
      </header>
      <main className="main">
        <MarketDataSync />
        <section className="trades-section">
          <h2>Trades</h2>
          <TradeFilters value={statusFilter} onChange={setStatusFilter} />
          <TradeTable
            trades={statusFilter === 'all' ? trades : trades.filter(t => t.status === statusFilter)}
            loading={loading}
            error={error}
          />
        </section>
      </main>
    </div>
  )
}

export default App
