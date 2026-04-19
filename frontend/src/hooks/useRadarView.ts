import { useEffect, useMemo, useState } from 'react'
import {
  useRadarStore,
  useTickerStore,
  useTradeStore,
  useLiveMetricsStore,
  useBenchmarkStore,
} from '../container/ContainerContext'
import { applyGroupedView, applyFlatView, type RadarViewState } from '../domain/radar/filterSort'
import type { Ticker } from '../domain/ticker/types'
import type { Benchmark } from '../domain/benchmark/types'
import type { TradeWithMetrics } from '../domain/trade/types'

export function useRadarView() {
  const radarStore = useRadarStore()
  const tickerStore = useTickerStore()
  const tradeStore = useTradeStore()
  const metricsStore = useLiveMetricsStore()
  const benchmarkStore = useBenchmarkStore()

  const [tickers, setTickers] = useState<Ticker[]>([])

  const indicators = radarStore.indicators$.get()
  const benchmarkIndicators = radarStore.benchmarkIndicators$.get()
  const benchmarks = benchmarkStore.benchmarks$.get()
  const loading = radarStore.loading$.get()
  const error = radarStore.error$.get()
  const watchlist = radarStore.symbols$.get()
  const trades = tradeStore.trades$.get()
  const liveMetrics = metricsStore.metrics$.get()
  const view = radarStore.view$.get()

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
        trades.filter((t) => t.status !== 'canceled').map((t) => t.ticker.toUpperCase()),
      ),
    )
    radarStore.setDerivedSymbols(tradeSymbols)
  }, [trades, radarStore])

  const tickerMap = useMemo(() => {
    const map: Record<string, Ticker> = {}
    for (const t of tickers) map[t.symbol.toUpperCase()] = t
    return map
  }, [tickers])

  const benchmarkMap = useMemo(() => {
    const map: Record<string, Benchmark> = {}
    for (const b of benchmarks) map[b.symbol.toUpperCase()] = b
    return map
  }, [benchmarks])

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

  const totalActiveTrades = useMemo(() => {
    let n = 0
    for (const list of Object.values(tradesBySymbol)) {
      for (const t of list) {
        if (t.status === 'plan' || t.status === 'ordered' || t.status === 'open') n++
      }
    }
    return n
  }, [tradesBySymbol])

  const grouped = useMemo(
    () => applyGroupedView(indicators, tradesBySymbol, liveMetrics, view),
    [indicators, tradesBySymbol, liveMetrics, view],
  )

  const flat = useMemo(
    () => applyFlatView(indicators, tradesBySymbol, liveMetrics, view),
    [indicators, tradesBySymbol, liveMetrics, view],
  )

  const addTickerSymbol = (symbol: string) => radarStore.addSymbol(symbol)
  const removeTickerSymbol = (symbol: string) => radarStore.removeSymbol(symbol)
  const registerCreatedTicker = (ticker: Ticker) => {
    setTickers((prev) => [...prev, ticker].sort((a, b) => a.symbol.localeCompare(b.symbol)))
    radarStore.addSymbol(ticker.symbol)
  }
  const addBenchmark = (symbol: string) => radarStore.addBenchmark(symbol)
  const removeBenchmark = async (symbol: string) => {
    radarStore.removeBenchmark(symbol)
    try {
      await benchmarkStore.removeBenchmark(symbol)
    } catch {
      // Non-fatal: radar already cleared the symbol locally.
    }
  }
  const refreshIndicators = () => radarStore.loadIndicators(true)
  const setView = (next: RadarViewState) => radarStore.setView(next)
  const resetView = () => radarStore.resetView()

  return {
    indicators,
    benchmarkIndicators,
    tickers,
    tickerMap,
    benchmarks,
    benchmarkMap,
    trades,
    tradesBySymbol,
    liveMetrics,
    watchlistSet,
    totalActiveTrades,
    loading,
    error,
    view,
    grouped,
    flat,
    addTickerSymbol,
    registerCreatedTicker,
    removeTickerSymbol,
    addBenchmark,
    removeBenchmark,
    refreshIndicators,
    setView,
    resetView,
  }
}
