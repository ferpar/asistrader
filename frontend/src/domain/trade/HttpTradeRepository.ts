import { TradeCreateRequest, TradeUpdateRequest, TradeListResponse, TradeResponse, BatchPriceResponse, MarkLevelHitRequest } from '../../types/trade'
import { ITradeRepository, IPriceProvider, DetectionResponse } from './ITradeRepository'
import type { TradeWithMetrics, PriceData, AlertSignature, DetectionTraceOverrides, DetectionTraceResult } from './types'
import { mapTrade, mapPriceData, mapDetectionResponse, mapDetectionTraceResponse } from './mappers'
import type { TradeDetectionResponseDTO, DetectionTraceResponseDTO } from '../../types/trade'
import { buildHeaders } from '../shared/httpHelpers'

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

  async reopenTrade(id: number): Promise<TradeWithMetrics> {
    const response = await fetch(`${this.baseUrl}/api/trades/${id}/reopen`, {
      method: 'POST',
      headers: buildHeaders(this.getToken),
    })
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}))
      throw new Error(errorData.detail || `Failed to reopen trade: ${response.statusText}`)
    }
    const data: TradeResponse = await response.json()
    return mapTrade(data.trade)
  }

  async revertOpenToOrdered(id: number): Promise<TradeWithMetrics> {
    const response = await fetch(`${this.baseUrl}/api/trades/${id}/revert-to-ordered`, {
      method: 'POST',
      headers: buildHeaders(this.getToken),
    })
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}))
      throw new Error(errorData.detail || `Failed to revert trade: ${response.statusText}`)
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

  async fetchDetectionTrace(
    tradeId: number, overrides?: DetectionTraceOverrides,
  ): Promise<DetectionTraceResult> {
    // Build the query string only from provided overrides so the backend
    // distinguishes "default margin" from "margin=0" etc.
    const params = new URLSearchParams()
    if (overrides) {
      for (const [k, v] of Object.entries(overrides)) {
        if (v !== undefined && v !== null && v !== '') params.set(k, String(v))
      }
    }
    const qs = params.toString()
    const url = `${this.baseUrl}/api/trades/${tradeId}/detection-trace${qs ? `?${qs}` : ''}`
    const response = await fetch(url, { headers: buildHeaders(this.getToken) })
    if (!response.ok) {
      const err = await response.json().catch(() => ({}))
      throw new Error(err.detail || `Failed to fetch detection trace: ${response.statusText}`)
    }
    const data: DetectionTraceResponseDTO = await response.json()
    return mapDetectionTraceResponse(data)
  }

  async markExitLevelHit(tradeId: number, levelId: number, request: MarkLevelHitRequest): Promise<TradeWithMetrics> {
    const response = await fetch(
      `${this.baseUrl}/api/trades/${tradeId}/exit-levels/${levelId}/hit`,
      { method: 'PATCH', headers: buildHeaders(this.getToken, true), body: JSON.stringify(request) }
    )
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}))
      throw new Error(errorData.detail || `Failed to mark exit level hit: ${response.statusText}`)
    }
    const data: TradeResponse = await response.json()
    return mapTrade(data.trade)
  }

  async revertExitLevelHit(tradeId: number, levelId: number): Promise<TradeWithMetrics> {
    const response = await fetch(
      `${this.baseUrl}/api/trades/${tradeId}/exit-levels/${levelId}/hit`,
      { method: 'DELETE', headers: buildHeaders(this.getToken) }
    )
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}))
      throw new Error(errorData.detail || `Failed to revert exit level hit: ${response.statusText}`)
    }
    const data: TradeResponse = await response.json()
    return mapTrade(data.trade)
  }

  async dismissAlert(signature: AlertSignature): Promise<void> {
    await this.sendAlertDismissal('POST', signature, 'dismiss alert')
  }

  async restoreAlert(signature: AlertSignature): Promise<void> {
    await this.sendAlertDismissal('DELETE', signature, 'restore alert')
  }

  private async sendAlertDismissal(
    method: 'POST' | 'DELETE',
    signature: AlertSignature,
    action: string,
  ): Promise<void> {
    const response = await fetch(`${this.baseUrl}/api/trades/alerts/dismiss`, {
      method,
      headers: buildHeaders(this.getToken, true),
      body: JSON.stringify({
        trade_id: signature.tradeId,
        hit_date: signature.hitDate,
        alert_kind: signature.alertKind,
        level_key: signature.levelKey,
      }),
    })
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}))
      throw new Error(errorData.detail || `Failed to ${action}: ${response.statusText}`)
    }
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
