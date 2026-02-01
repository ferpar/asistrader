import { useState } from 'react'
import { useMarketDataRepo } from '../container/ContainerContext'
import type { SyncResult } from '../domain/marketData/types'

export function MarketDataSync() {
  const marketDataRepo = useMarketDataRepo()
  const [startDate, setStartDate] = useState('2024-01-01')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<SyncResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  const handleSync = async () => {
    setLoading(true)
    setError(null)
    setResult(null)

    try {
      const response = await marketDataRepo.syncMarketData({ start_date: startDate })
      setResult(response)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to sync market data')
    } finally {
      setLoading(false)
    }
  }

  return (
    <section className="market-data-sync">
      <h2>Market Data Sync</h2>
      <div className="sync-controls">
        <input
          type="date"
          value={startDate}
          onChange={(e) => setStartDate(e.target.value)}
          disabled={loading}
        />
        <button onClick={handleSync} disabled={loading}>
          {loading ? 'Syncing...' : 'Sync Market Data'}
        </button>
      </div>
      {result && (
        <div className="sync-result success">
          ✓ Synced {result.totalRows} rows ({Object.keys(result.results).length} tickers, {result.skipped.length} skipped)
        </div>
      )}
      {error && (
        <div className="sync-result error">{error}</div>
      )}
    </section>
  )
}
