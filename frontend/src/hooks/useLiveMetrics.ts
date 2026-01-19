import { useState, useEffect, useCallback, useMemo } from 'react'
import { Trade, LiveMetrics, PriceData } from '../types/trade'
import { fetchBatchPrices } from '../api/tickers'

interface UseLiveMetricsResult {
  metrics: Record<number, LiveMetrics>
  prices: Record<string, PriceData>
  loading: boolean
  error: string | null
  refresh: () => void
}

export function useLiveMetrics(trades: Trade[]): UseLiveMetricsResult {
  const [prices, setPrices] = useState<Record<string, PriceData>>({})
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Filter open trades and get unique symbols
  const openTrades = useMemo(
    () => trades.filter((trade) => trade.status === 'open'),
    [trades]
  )

  const uniqueSymbols = useMemo(() => {
    const symbols = new Set(openTrades.map((trade) => trade.ticker.toUpperCase()))
    return Array.from(symbols)
  }, [openTrades])

  // Fetch prices for all unique symbols
  const fetchPrices = useCallback(async () => {
    if (uniqueSymbols.length === 0) {
      setPrices({})
      return
    }

    setLoading(true)
    setError(null)

    try {
      const response = await fetchBatchPrices(uniqueSymbols)
      setPrices(response.prices)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch prices')
    } finally {
      setLoading(false)
    }
  }, [uniqueSymbols])

  // Fetch prices on mount and when symbols change
  useEffect(() => {
    fetchPrices()
  }, [fetchPrices])

  // Calculate metrics for each open trade
  const metrics = useMemo(() => {
    const result: Record<number, LiveMetrics> = {}

    for (const trade of openTrades) {
      const priceData = prices[trade.ticker.toUpperCase()]
      const currentPrice = priceData?.valid ? priceData.price : null

      if (currentPrice === null) {
        result[trade.id] = {
          currentPrice: null,
          distanceToSL: null,
          distanceToTP: null,
          unrealizedPnL: null,
          unrealizedPnLPct: null,
        }
        continue
      }

      // Calculate distances as percentages
      // distanceToSL: positive means price is above SL (good for long)
      // distanceToTP: positive means price is below TP (room to grow for long)
      const distanceToSL = (currentPrice - trade.stop_loss) / currentPrice
      const distanceToTP = (trade.take_profit - currentPrice) / currentPrice

      // Calculate unrealized PnL
      const unrealizedPnL = (currentPrice - trade.entry_price) * trade.units
      const unrealizedPnLPct = (currentPrice - trade.entry_price) / trade.entry_price

      result[trade.id] = {
        currentPrice,
        distanceToSL,
        distanceToTP,
        unrealizedPnL,
        unrealizedPnLPct,
      }
    }

    return result
  }, [openTrades, prices])

  return {
    metrics,
    prices,
    loading,
    error,
    refresh: fetchPrices,
  }
}
