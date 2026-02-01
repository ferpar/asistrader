import type { SyncResult } from './types'
import type { SyncRequest } from '../../types/marketData'

export interface IMarketDataRepository {
  syncMarketData(request: SyncRequest): Promise<SyncResult>
}
