import { Trade, TradeCreateRequest, TradeUpdateRequest, TradeDetectionResponse, PriceData } from '../../types/trade'

export interface ITradeRepository {
  fetchTrades(): Promise<Trade[]>
  createTrade(request: TradeCreateRequest): Promise<Trade>
  updateTrade(id: number, request: TradeUpdateRequest): Promise<Trade>
  detectTradeHits(): Promise<TradeDetectionResponse>
}

export interface IPriceProvider {
  fetchBatchPrices(symbols: string[]): Promise<Record<string, PriceData>>
}
