import { TradeStore } from '../domain/trade/TradeStore'
import { LiveMetricsStore } from '../domain/trade/LiveMetricsStore'

export interface AppContainer {
  tradeStore: TradeStore
  liveMetricsStore: LiveMetricsStore
}
