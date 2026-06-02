import { TradeStore } from '../domain/trade/TradeStore'
import { LiveMetricsStore } from '../domain/trade/LiveMetricsStore'
import { TradeMetricsStore } from '../domain/trade/TradeMetricsStore'
import type { ITradeRepository } from '../domain/trade/ITradeRepository'
import type { IStrategyRepository } from '../domain/strategy/IStrategyRepository'
import type { IMarketDataRepository } from '../domain/marketData/IMarketDataRepository'
import { TickerStore } from '../domain/ticker/TickerStore'
import { FundStore } from '../domain/fund/FundStore'
import { FxStore } from '../domain/fx/FxStore'
import { RadarStore } from '../domain/radar/RadarStore'
import { IndicatorStore } from '../domain/radar/IndicatorStore'
import { BenchmarkStore } from '../domain/benchmark/BenchmarkStore'
import { IrrStore } from '../domain/irr/IrrStore'
import { AuthStore } from '../domain/auth/AuthStore'
import { RouterStore } from '../domain/router/RouterStore'

export interface AppContainer {
  authStore: AuthStore
  routerStore: RouterStore
  tradeStore: TradeStore
  tradeRepo: ITradeRepository
  liveMetricsStore: LiveMetricsStore
  tradeMetricsStore: TradeMetricsStore
  strategyRepo: IStrategyRepository
  marketDataRepo: IMarketDataRepository
  tickerStore: TickerStore
  fundStore: FundStore
  fxStore: FxStore
  radarStore: RadarStore
  indicatorStore: IndicatorStore
  benchmarkStore: BenchmarkStore
  irrStore: IrrStore
}
