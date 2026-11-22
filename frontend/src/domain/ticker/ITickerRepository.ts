import type { Ticker } from './types'
import type { TickerCreateRequest, TickerSuggestion, TickerPriceResponse } from '../../types/ticker'

export interface ITickerRepository {
  fetchTickers(): Promise<Ticker[]>
  searchTickers(query: string): Promise<TickerSuggestion[]>
  createTicker(request: TickerCreateRequest): Promise<Ticker>
  fetchTickerPrice(symbol: string): Promise<TickerPriceResponse>
  /** Set (or clear, with null) the ticker's global Asset Class override. */
  setAssetClassOverride(
    symbol: string,
    assetClass: 'domestic_stock' | 'international_stock' | 'etf' | null,
  ): Promise<Ticker>
}
