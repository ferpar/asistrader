import { useEffect, useMemo, useState } from 'react'
import { observer } from '@legendapp/state/react'
import {
  useRadarStore,
  useTickerStore,
  useTradeStore,
  useLiveMetricsStore,
  useBenchmarkStore,
} from '../container/ContainerContext'
import { TickerSearchInput } from '../components/TickerSearchInput'
import { BenchmarkSearchInput } from '../components/BenchmarkSearchInput'
import { TradeCreationForm } from '../components/TradeCreationForm'
import { RadarTickerCard } from '../components/radar/RadarTickerCard'
import { RadarBenchmarkCard } from '../components/radar/RadarBenchmarkCard'
import type { Ticker } from '../domain/ticker/types'
import type { Benchmark } from '../domain/benchmark/types'
import type { TradeWithMetrics } from '../domain/trade/types'
import styles from './RadarDashboard.module.css'

export const RadarDashboard = observer(function RadarDashboard() {
  const radarStore = useRadarStore()
  const tickerStore = useTickerStore()
  const tradeStore = useTradeStore()
  const metricsStore = useLiveMetricsStore()
  const benchmarkStore = useBenchmarkStore()
  const [tickers, setTickers] = useState<Ticker[]>([])
  const [selectedTicker, setSelectedTicker] = useState('')
  const [newTradeTicker, setNewTradeTicker] = useState<string | null>(null)

  const tickerMap = useMemo(() => {
    const map: Record<string, Ticker> = {}
    for (const t of tickers) map[t.symbol.toUpperCase()] = t
    return map
  }, [tickers])

  const indicators = radarStore.indicators$.get()
  const benchmarkIndicators = radarStore.benchmarkIndicators$.get()
  const benchmarks = benchmarkStore.benchmarks$.get()
  const loading = radarStore.loading$.get()
  const error = radarStore.error$.get()
  const watchlist = radarStore.symbols$.get()
  const trades = tradeStore.trades$.get()
  const liveMetrics = metricsStore.metrics$.get()

  const benchmarkMap = useMemo(() => {
    const map: Record<string, Benchmark> = {}
    for (const b of benchmarks) map[b.symbol.toUpperCase()] = b
    return map
  }, [benchmarks])

  useEffect(() => {
    tickerStore.loadTickers().then(() => setTickers(tickerStore.tickers$.get()))
  }, [tickerStore])

  useEffect(() => {
    benchmarkStore.loadBenchmarks()
  }, [benchmarkStore])

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

  const handleBenchmarkSelect = (symbol: string) => {
    radarStore.addBenchmark(symbol)
  }

  const handleBenchmarkRemove = async (symbol: string) => {
    radarStore.removeBenchmark(symbol)
    try {
      await benchmarkStore.removeBenchmark(symbol)
    } catch {
      // Non-fatal: the symbol is gone from the radar; backend row stays.
    }
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
        <div className={styles.addTicker}>
          <label className={styles.addLabel}>Add Benchmark</label>
          <BenchmarkSearchInput
            existingBenchmarks={benchmarks}
            onBenchmarkSelect={handleBenchmarkSelect}
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

      <div className={styles.section}>
        <h3 className={styles.sectionHeading}>Benchmarks</h3>
        {benchmarkIndicators.length === 0 && !loading && (
          <div className={styles.empty}>No benchmarks added. Search for an index above to compare against.</div>
        )}
        <div className={styles.cardList}>
          {benchmarkIndicators.map((ind) => (
            <RadarBenchmarkCard
              key={ind.symbol}
              indicators={ind}
              benchmark={benchmarkMap[ind.symbol] ?? null}
              onRemove={handleBenchmarkRemove}
            />
          ))}
        </div>
      </div>

      <div className={styles.section}>
        <h3 className={styles.sectionHeading}>Tickers</h3>
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
              onNewTrade={(symbol) => setNewTradeTicker(symbol)}
            />
          ))}
        </div>
      </div>

      {newTradeTicker && (
        <TradeCreationForm
          initialTicker={newTradeTicker}
          onClose={() => setNewTradeTicker(null)}
        />
      )}
    </section>
  )
})
