import type { Ticker } from './types'
import type { TickerCreateRequest, TickerSuggestion, TickerPriceResponse } from '../../types/ticker'

export interface ITickerRepository {
  fetchTickers(): Promise<Ticker[]>
  searchTickers(query: string): Promise<TickerSuggestion[]>
  createTicker(request: TickerCreateRequest): Promise<Ticker>
  fetchTickerPrice(symbol: string): Promise<TickerPriceResponse>
}
