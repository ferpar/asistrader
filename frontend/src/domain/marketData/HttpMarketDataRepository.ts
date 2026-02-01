import type { IMarketDataRepository } from './IMarketDataRepository'
import type { SyncResult } from './types'
import type { SyncRequest, SyncResponseDTO } from '../../types/marketData'
import { mapSyncResponse } from './mappers'
import { buildHeaders } from '../shared/httpHelpers'

export class HttpMarketDataRepository implements IMarketDataRepository {
  constructor(
    private readonly baseUrl: string,
    private readonly getToken: () => string | null,
  ) {}

  async syncMarketData(request: SyncRequest): Promise<SyncResult> {
    const response = await fetch(`${this.baseUrl}/api/market-data/sync-all`, {
      method: 'POST',
      headers: buildHeaders(this.getToken, true),
      body: JSON.stringify(request),
    })
    if (!response.ok) {
      throw new Error(`Failed to sync market data: ${response.statusText}`)
    }
    const data: SyncResponseDTO = await response.json()
    return mapSyncResponse(data)
  }
}
