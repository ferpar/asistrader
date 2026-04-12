import { getAccessToken } from '../utils/tokenStorage'
import { HttpTradeRepository, HttpPriceProvider } from '../domain/trade/HttpTradeRepository'
import { TradeStore } from '../domain/trade/TradeStore'
import { LiveMetricsStore } from '../domain/trade/LiveMetricsStore'
import { HttpStrategyRepository } from '../domain/strategy/HttpStrategyRepository'
import { HttpMarketDataRepository } from '../domain/marketData/HttpMarketDataRepository'
import { HttpTickerRepository } from '../domain/ticker/HttpTickerRepository'
import { TickerStore } from '../domain/ticker/TickerStore'
import { HttpFundRepository } from '../domain/fund/HttpFundRepository'
import { FundStore } from '../domain/fund/FundStore'
import { HttpRadarRepository } from '../domain/radar/HttpRadarRepository'
import { RadarStore } from '../domain/radar/RadarStore'
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
  const fundRepo = new HttpFundRepository(baseUrl, getAccessToken)
  const fundStore = new FundStore(fundRepo)
  const radarRepo = new HttpRadarRepository(baseUrl, getAccessToken)
  const radarStore = new RadarStore(radarRepo)
  return { tradeStore, liveMetricsStore, strategyRepo, marketDataRepo, tickerStore, fundStore, radarStore }
}
