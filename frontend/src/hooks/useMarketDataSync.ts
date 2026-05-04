import { useState } from 'react'
import { useMarketDataRepo } from '../container/ContainerContext'
import type { SyncResult } from '../domain/marketData/types'

export function useMarketDataSync() {
  const marketDataRepo = useMarketDataRepo()
  const [startDate, setStartDate] = useState('2024-01-01')
  const [forceRefresh, setForceRefresh] = useState(false)
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<SyncResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  const handleSync = async () => {
    setLoading(true)
    setError(null)
    setResult(null)

    try {
      const response = await marketDataRepo.syncMarketData({
        start_date: startDate,
        force_refresh: forceRefresh,
      })
      setResult(response)
      // One-shot: don't leave the destructive flag armed across clicks.
      setForceRefresh(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to sync market data')
    } finally {
      setLoading(false)
    }
  }

  return {
    startDate,
    setStartDate,
    forceRefresh,
    setForceRefresh,
    loading,
    result,
    error,
    handleSync,
  }
}
