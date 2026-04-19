import { TradeStore } from '../domain/trade/TradeStore'
import { LiveMetricsStore } from '../domain/trade/LiveMetricsStore'
import type { IStrategyRepository } from '../domain/strategy/IStrategyRepository'
import type { IMarketDataRepository } from '../domain/marketData/IMarketDataRepository'
import { TickerStore } from '../domain/ticker/TickerStore'
import { FundStore } from '../domain/fund/FundStore'
import { RadarStore } from '../domain/radar/RadarStore'
import { BenchmarkStore } from '../domain/benchmark/BenchmarkStore'

export interface AppContainer {
  tradeStore: TradeStore
  liveMetricsStore: LiveMetricsStore
  strategyRepo: IStrategyRepository
  marketDataRepo: IMarketDataRepository
  tickerStore: TickerStore
  fundStore: FundStore
  radarStore: RadarStore
  benchmarkStore: BenchmarkStore
}
