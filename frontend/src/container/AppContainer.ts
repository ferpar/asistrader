import { getAccessToken } from '../utils/tokenStorage'
import { HttpTradeRepository, HttpPriceProvider } from '../domain/trade/HttpTradeRepository'
import { TradeStore } from '../domain/trade/TradeStore'
import { LiveMetricsStore } from '../domain/trade/LiveMetricsStore'
import { TradeMetricsStore } from '../domain/trade/TradeMetricsStore'
import { HttpStrategyRepository } from '../domain/strategy/HttpStrategyRepository'
import { HttpMarketDataRepository } from '../domain/marketData/HttpMarketDataRepository'
import { HttpTickerRepository } from '../domain/ticker/HttpTickerRepository'
import { TickerStore } from '../domain/ticker/TickerStore'
import { HttpFundRepository } from '../domain/fund/HttpFundRepository'
import { FundStore } from '../domain/fund/FundStore'
import { HttpFxRepository } from '../domain/fx/HttpFxRepository'
import { FxStore } from '../domain/fx/FxStore'
import { HttpRadarRepository } from '../domain/radar/HttpRadarRepository'
import { RadarStore } from '../domain/radar/RadarStore'
import { HttpBenchmarkRepository } from '../domain/benchmark/HttpBenchmarkRepository'
import { BenchmarkStore } from '../domain/benchmark/BenchmarkStore'
import { AppContainer } from './types'

export function createAppContainer(): AppContainer {
  const baseUrl = import.meta.env.VITE_API_URL || ''
  const tradeRepo = new HttpTradeRepository(baseUrl, getAccessToken)
  const priceProvider = new HttpPriceProvider(baseUrl, getAccessToken)
  const tradeStore = new TradeStore(tradeRepo)
  const liveMetricsStore = new LiveMetricsStore(tradeStore, priceProvider)
  const strategyRepo = new HttpStrategyRepository(baseUrl, getAccessToken)
  const marketDataRepo = new HttpMarketDataRepository(baseUrl, getAccessToken)
  const tickerRepo = new HttpTickerRepository(baseUrl, getAccessToken)
  const tickerStore = new TickerStore(tickerRepo)
  const fxRepo = new HttpFxRepository(baseUrl, getAccessToken)
  const fxStore = new FxStore(fxRepo)
  const fundRepo = new HttpFundRepository(baseUrl, getAccessToken)
  const fundStore = new FundStore(fundRepo, fxStore)
  const tradeMetricsStore = new TradeMetricsStore(
    tradeStore,
    liveMetricsStore,
    fundStore,
    fxStore,
  )
  const benchmarkRepo = new HttpBenchmarkRepository(baseUrl, getAccessToken)
  const benchmarkStore = new BenchmarkStore(benchmarkRepo)
  const radarRepo = new HttpRadarRepository(baseUrl, getAccessToken)
  const radarStore = new RadarStore(radarRepo, benchmarkRepo)
  return {
    tradeStore,
    liveMetricsStore,
    tradeMetricsStore,
    strategyRepo,
    marketDataRepo,
    tickerStore,
    fundStore,
    fxStore,
    radarStore,
    benchmarkStore,
  }
}
