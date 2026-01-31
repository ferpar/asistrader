import { getAccessToken } from '../utils/tokenStorage'
import { HttpTradeRepository, HttpPriceProvider } from '../domain/trade/HttpTradeRepository'
import { TradeStore } from '../domain/trade/TradeStore'
import { LiveMetricsStore } from '../domain/trade/LiveMetricsStore'
import { AppContainer } from './types'

export function createAppContainer(): AppContainer {
  const baseUrl = import.meta.env.VITE_API_URL || ''
  const tradeRepo = new HttpTradeRepository(baseUrl, getAccessToken)
  const priceProvider = new HttpPriceProvider(baseUrl, getAccessToken)
  const tradeStore = new TradeStore(tradeRepo)
  const liveMetricsStore = new LiveMetricsStore(tradeStore, priceProvider)
  return { tradeStore, liveMetricsStore }
}
