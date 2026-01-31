import { TradeCreateRequest, TradeUpdateRequest, TradeListResponse, TradeResponse, BatchPriceResponse } from '../../types/trade'
import { ITradeRepository, IPriceProvider, DetectionResponse } from './ITradeRepository'
import type { TradeWithMetrics, PriceData } from './types'
import { mapTrade, mapPriceData, mapDetectionResponse } from './mappers'
import type { TradeDetectionResponseDTO } from '../../types/trade'

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

  async fetchTrades(): Promise<TradeWithMetrics[]> {
    const response = await fetch(`${this.baseUrl}/api/trades`, {
      headers: buildHeaders(this.getToken),
    })
    if (!response.ok) {
      throw new Error(`Failed to fetch trades: ${response.statusText}`)
    }
    const data: TradeListResponse = await response.json()
    return data.trades.map(mapTrade)
  }

  async createTrade(request: TradeCreateRequest): Promise<TradeWithMetrics> {
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
    return mapTrade(data.trade)
  }

  async updateTrade(id: number, request: TradeUpdateRequest): Promise<TradeWithMetrics> {
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
    return mapTrade(data.trade)
  }

  async detectTradeHits(): Promise<DetectionResponse> {
    const response = await fetch(`${this.baseUrl}/api/trades/detect-hits`, {
      method: 'POST',
      headers: buildHeaders(this.getToken),
    })
    if (!response.ok) {
      throw new Error(`Failed to detect trade hits: ${response.statusText}`)
    }
    const data: TradeDetectionResponseDTO = await response.json()
    return mapDetectionResponse(data)
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
    const result: Record<string, PriceData> = {}
    for (const [key, value] of Object.entries(data.prices)) {
      result[key] = mapPriceData(value)
    }
    return result
  }
}
