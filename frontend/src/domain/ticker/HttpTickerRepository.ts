import type { ITickerRepository } from './ITickerRepository'
import type { Ticker } from './types'
import type {
  TickerCreateRequest,
  TickerSuggestion,
  TickerPriceResponse,
  TickerListResponse,
  TickerSearchResponse,
  TickerCreateResponse,
  TickerResponse,
} from '../../types/ticker'
import { mapTicker } from './mappers'
import { buildHeaders } from '../shared/httpHelpers'

export class HttpTickerRepository implements ITickerRepository {
  constructor(
    private readonly baseUrl: string,
    private readonly getToken: () => string | null,
  ) {}

  async fetchTickers(): Promise<Ticker[]> {
    const response = await fetch(`${this.baseUrl}/api/tickers`, {
      headers: buildHeaders(this.getToken),
    })
    if (!response.ok) {
      throw new Error(`Failed to fetch tickers: ${response.statusText}`)
    }
    const data: TickerListResponse = await response.json()
    return data.tickers.map(mapTicker)
  }

  async searchTickers(query: string): Promise<TickerSuggestion[]> {
    const response = await fetch(
      `${this.baseUrl}/api/tickers/search?q=${encodeURIComponent(query)}`,
      { headers: buildHeaders(this.getToken) },
    )
    if (!response.ok) {
      throw new Error(`Failed to search tickers: ${response.statusText}`)
    }
    const data: TickerSearchResponse = await response.json()
    return data.suggestions
  }

  async createTicker(request: TickerCreateRequest): Promise<Ticker> {
    const response = await fetch(`${this.baseUrl}/api/tickers`, {
      method: 'POST',
      headers: buildHeaders(this.getToken, true),
      body: JSON.stringify(request),
    })
    if (!response.ok) {
      const error = await response.json().catch(() => ({}))
      throw new Error(error.detail || `Failed to create ticker: ${response.statusText}`)
    }
    const data: TickerCreateResponse = await response.json()
    return mapTicker(data.ticker)
  }

  async setAssetClassOverride(
    symbol: string,
    assetClass: 'domestic_stock' | 'international_stock' | 'etf' | null,
  ): Promise<Ticker> {
    const url = `${this.baseUrl}/api/tickers/${encodeURIComponent(symbol)}/asset-class`
    const response = await fetch(
      url,
      assetClass === null
        ? { method: 'DELETE', headers: buildHeaders(this.getToken) }
        : {
            method: 'PUT',
            headers: buildHeaders(this.getToken, true),
            body: JSON.stringify({ asset_class: assetClass }),
          },
    )
    if (!response.ok) {
      const error = await response.json().catch(() => ({}))
      throw new Error(error.detail || `Failed to set Asset Class: ${response.statusText}`)
    }
    const data: TickerResponse = await response.json()
    return mapTicker(data.ticker)
  }

  async fetchTickerPrice(symbol: string): Promise<TickerPriceResponse> {
    const response = await fetch(
      `${this.baseUrl}/api/tickers/${encodeURIComponent(symbol)}/price`,
      { headers: buildHeaders(this.getToken) },
    )
    if (!response.ok) {
      throw new Error(`Failed to fetch price: ${response.statusText}`)
    }
    return response.json()
  }
}
