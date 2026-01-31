import { Trade, TradeCreateRequest, TradeUpdateRequest, TradeDetectionResponse, TradeListResponse, TradeResponse, PriceData, BatchPriceResponse } from '../../types/trade'
import { ITradeRepository, IPriceProvider } from './ITradeRepository'

function buildHeaders(getToken: () => string | null, json = false): Record<string, string> {
  const headers: Record<string, string> = {}
  const token = getToken()
  if (token) {
    headers['Authorization'] = `Bearer ${token}`
  }
  if (json) {
    headers['Content-Type'] = 'application/json'
  }
  return headers
}

export class HttpTradeRepository implements ITradeRepository {
  constructor(
    private readonly baseUrl: string,
    private readonly getToken: () => string | null,
  ) {}

  async fetchTrades(): Promise<Trade[]> {
    const response = await fetch(`${this.baseUrl}/api/trades`, {
      headers: buildHeaders(this.getToken),
    })
    if (!response.ok) {
      throw new Error(`Failed to fetch trades: ${response.statusText}`)
    }
    const data: TradeListResponse = await response.json()
    return data.trades
  }

  async createTrade(request: TradeCreateRequest): Promise<Trade> {
    const response = await fetch(`${this.baseUrl}/api/trades`, {
      method: 'POST',
      headers: buildHeaders(this.getToken, true),
      body: JSON.stringify(request),
    })
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}))
      throw new Error(errorData.detail || `Failed to create trade: ${response.statusText}`)
    }
    const data: TradeResponse = await response.json()
    return data.trade
  }

  async updateTrade(id: number, request: TradeUpdateRequest): Promise<Trade> {
    const response = await fetch(`${this.baseUrl}/api/trades/${id}`, {
      method: 'PATCH',
      headers: buildHeaders(this.getToken, true),
      body: JSON.stringify(request),
    })
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}))
      throw new Error(errorData.detail || `Failed to update trade: ${response.statusText}`)
    }
    const data: TradeResponse = await response.json()
    return data.trade
  }

  async detectTradeHits(): Promise<TradeDetectionResponse> {
    const response = await fetch(`${this.baseUrl}/api/trades/detect-hits`, {
      method: 'POST',
      headers: buildHeaders(this.getToken),
    })
    if (!response.ok) {
      throw new Error(`Failed to detect trade hits: ${response.statusText}`)
    }
    return response.json()
  }
}

export class HttpPriceProvider implements IPriceProvider {
  constructor(
    private readonly baseUrl: string,
    private readonly getToken: () => string | null,
  ) {}

  async fetchBatchPrices(symbols: string[]): Promise<Record<string, PriceData>> {
    const response = await fetch(`${this.baseUrl}/api/tickers/prices`, {
      method: 'POST',
      headers: buildHeaders(this.getToken, true),
      body: JSON.stringify({ symbols }),
    })
    if (!response.ok) {
      throw new Error(`Failed to fetch batch prices: ${response.statusText}`)
    }
    const data: BatchPriceResponse = await response.json()
    return data.prices
  }
}
