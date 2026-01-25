import { useEffect, useState, useCallback, useMemo } from 'react'
import { TradeTable } from '../components/TradeTable'
import { TradeFilters, StatusFilter } from '../components/TradeFilters'
import { TradeStatistics } from '../components/TradeStatistics'
import { TickerPerformance } from '../components/TickerPerformance'
import { TradeCreationForm } from '../components/TradeCreationForm'
import { MarketDataSync } from '../components/MarketDataSync'
import { fetchTrades } from '../api/trades'
import { Trade } from '../types/trade'

const getFilteredTrades = (trades: Trade[], filter: StatusFilter): Trade[] => {
  switch (filter) {
    case 'all':
      return trades
    case 'winners':
      return trades.filter(t => t.status === 'close' && t.exit_type === 'tp')
    case 'losers':
      return trades.filter(t => t.status === 'close' && t.exit_type === 'sl')
    default:
      return trades.filter(t => t.status === filter)
  }
}

export function TradeDashboard() {
  const [trades, setTrades] = useState<Trade[]>([])
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

  const filteredTrades = useMemo(
    () => getFilteredTrades(trades, statusFilter),
    [trades, statusFilter]
  )

  return (
    <>
      <MarketDataSync />
      <TradeCreationForm onTradeCreated={loadTrades} />
      <section className="trades-section">
        <h2>Trades</h2>
        <TradeStatistics trades={filteredTrades} />
        <TickerPerformance trades={trades} />
        <TradeFilters value={statusFilter} onChange={setStatusFilter} />
        <TradeTable
          trades={filteredTrades}
          loading={loading}
          error={error}
          onTradeUpdated={loadTrades}
        />
      </section>
    </>
  )
}
