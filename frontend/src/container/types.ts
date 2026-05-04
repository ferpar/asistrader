import { TradeStore } from '../domain/trade/TradeStore'
import { LiveMetricsStore } from '../domain/trade/LiveMetricsStore'
import { TradeMetricsStore } from '../domain/trade/TradeMetricsStore'
import type { IStrategyRepository } from '../domain/strategy/IStrategyRepository'
import type { IMarketDataRepository } from '../domain/marketData/IMarketDataRepository'
import { TickerStore } from '../domain/ticker/TickerStore'
import { FundStore } from '../domain/fund/FundStore'
import { FxStore } from '../domain/fx/FxStore'
import { RadarStore } from '../domain/radar/RadarStore'
import { BenchmarkStore } from '../domain/benchmark/BenchmarkStore'

export interface AppContainer {
  tradeStore: TradeStore
  liveMetricsStore: LiveMetricsStore
  tradeMetricsStore: TradeMetricsStore
  strategyRepo: IStrategyRepository
  marketDataRepo: IMarketDataRepository
  tickerStore: TickerStore
  fundStore: FundStore
  fxStore: FxStore
  radarStore: RadarStore
  benchmarkStore: BenchmarkStore
}
