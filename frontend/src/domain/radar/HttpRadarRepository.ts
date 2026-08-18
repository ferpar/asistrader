import type { IRadarRepository } from './IRadarRepository'
import type { MarketDataRowDTO, BulkMarketDataResponse } from '../../types/radar'
import type { SyncResponseDTO } from '../../types/marketData'
import { buildHeaders } from '../shared/httpHelpers'
import { fetchWithTimeout, MARKET_DATA_TIMEOUT_MS, SYNC_TIMEOUT_MS } from '../../api/http'

export class HttpRadarRepository implements IRadarRepository {
  constructor(
    private readonly baseUrl: string,
    private readonly getToken: () => string | null,
  ) {}

  async syncMarketData(symbols: string[], startDate: string): Promise<void> {
    const response = await fetchWithTimeout(
      `${this.baseUrl}/api/market-data/sync-all`,
      {
        method: 'POST',
        headers: buildHeaders(this.getToken, true),
        body: JSON.stringify({ start_date: startDate, symbols }),
      },
      // Sequential per-symbol yfinance fetches server-side — slow by design,
      // but not unbounded.
      SYNC_TIMEOUT_MS,
    )
    if (!response.ok) {
      throw new Error(`Failed to sync market data: ${response.statusText}`)
    }
    await response.json() as SyncResponseDTO
  }

  async fetchBulkMarketData(symbols: string[], startDate: string): Promise<{
    data: Record<string, MarketDataRowDTO[]>
    errors: Record<string, string>
  }> {
    const response = await fetchWithTimeout(
      `${this.baseUrl}/api/market-data/bulk`,
      {
        method: 'POST',
        headers: buildHeaders(this.getToken, true),
        body: JSON.stringify({ symbols, start_date: startDate }),
      },
      MARKET_DATA_TIMEOUT_MS,
    )
    if (!response.ok) {
      throw new Error(`Failed to fetch bulk market data: ${response.statusText}`)
    }
    const result: BulkMarketDataResponse = await response.json()
    return { data: result.data, errors: result.errors }
  }
}
