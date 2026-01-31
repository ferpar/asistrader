import { TradeCreateRequest, TradeUpdateRequest } from '../../types/trade'
import type { TradeWithMetrics, PriceData, EntryAlert, SLTPAlert, LayeredAlert, DetectionResult } from './types'

export interface DetectionResponse {
  entryAlerts: EntryAlert[]
  sltpAlerts: SLTPAlert[]
  layeredAlerts: LayeredAlert[]
  result: DetectionResult
}

export interface ITradeRepository {
  fetchTrades(): Promise<TradeWithMetrics[]>
  createTrade(request: TradeCreateRequest): Promise<TradeWithMetrics>
  updateTrade(id: number, request: TradeUpdateRequest): Promise<TradeWithMetrics>
  detectTradeHits(): Promise<DetectionResponse>
}

export interface IPriceProvider {
  fetchBatchPrices(symbols: string[]): Promise<Record<string, PriceData>>
}
