import { useEffect, useMemo, useState } from 'react'
import { observer } from '@legendapp/state/react'
import { useRadarStore, useTickerStore, useTradeStore, useLiveMetricsStore } from '../container/ContainerContext'
import { TickerSearchInput } from '../components/TickerSearchInput'
import { RadarTickerCard } from '../components/radar/RadarTickerCard'
import type { Ticker } from '../domain/ticker/types'
import type { TradeWithMetrics } from '../domain/trade/types'
import styles from './RadarDashboard.module.css'

export const RadarDashboard = observer(function RadarDashboard() {
  const radarStore = useRadarStore()
  const tickerStore = useTickerStore()
  const tradeStore = useTradeStore()
  const metricsStore = useLiveMetricsStore()
  const [tickers, setTickers] = useState<Ticker[]>([])
  const [selectedTicker, setSelectedTicker] = useState('')

  const tickerMap = useMemo(() => {
    const map: Record<string, Ticker> = {}
    for (const t of tickers) map[t.symbol.toUpperCase()] = t
    return map
  }, [tickers])

  const indicators = radarStore.indicators$.get()
  const loading = radarStore.loading$.get()
  const error = radarStore.error$.get()
  const watchlist = radarStore.symbols$.get()
  const trades = tradeStore.trades$.get()
  const liveMetrics = metricsStore.metrics$.get()

  useEffect(() => {
    tickerStore.loadTickers().then(() => setTickers(tickerStore.tickers$.get()))
  }, [tickerStore])

  useEffect(() => {
    tradeStore.loadTrades()
  }, [tradeStore])

  useEffect(() => {
    radarStore.loadIndicators()
  }, [radarStore])

  useEffect(() => {
    metricsStore.refreshPrices()
  }, [trades, metricsStore])

  useEffect(() => {
    const tradeSymbols = Array.from(
      new Set(
        trades
          .filter((t) => t.status !== 'canceled')
          .map((t) => t.ticker.toUpperCase())
      )
    )
    radarStore.setDerivedSymbols(tradeSymbols)
  }, [trades, radarStore])

  const tradesBySymbol = useMemo(() => {
    const map: Record<string, TradeWithMetrics[]> = {}
    for (const t of trades) {
      if (t.status === 'canceled') continue
      const key = t.ticker.toUpperCase()
      if (!map[key]) map[key] = []
      map[key].push(t)
    }
    return map
  }, [trades])

  const watchlistSet = useMemo(() => new Set(watchlist), [watchlist])

  const handleTickerSelect = (symbol: string) => {
    setSelectedTicker('')
    radarStore.addSymbol(symbol)
  }

  const handleTickerCreated = (ticker: Ticker) => {
    setTickers((prev) => [...prev, ticker].sort((a, b) => a.symbol.localeCompare(b.symbol)))
    radarStore.addSymbol(ticker.symbol)
  }

  return (
    <section>
      <h2>Radar</h2>

      <div className={styles.controls}>
        <div className={styles.addTicker}>
          <label className={styles.addLabel}>Add Ticker</label>
          <TickerSearchInput
            existingTickers={tickers}
            selectedTicker={selectedTicker}
            onTickerSelect={handleTickerSelect}
            onTickerCreated={handleTickerCreated}
          />
        </div>
        <button
          className={styles.refreshBtn}
          onClick={() => radarStore.loadIndicators(true)}
          disabled={loading}
        >
          {loading ? 'Loading...' : 'Refresh'}
        </button>
      </div>

      {error && <div className={styles.error}>{error}</div>}

      {indicators.length === 0 && !loading && (
        <div className={styles.empty}>No tickers in your radar. Add one above to get started.</div>
      )}

      <div className={styles.cardList}>
        {indicators.map((ind) => (
          <RadarTickerCard
            key={ind.symbol}
            indicators={ind}
            ticker={tickerMap[ind.symbol] ?? null}
            trades={tradesBySymbol[ind.symbol] ?? []}
            liveMetrics={liveMetrics}
            removable={watchlistSet.has(ind.symbol)}
            onRemove={(symbol) => radarStore.removeSymbol(symbol)}
          />
        ))}
      </div>
    </section>
  )
})
