import type { MarketDataRowDTO } from '../../types/radar'

export interface IRadarRepository {
  syncMarketData(symbols: string[], startDate: string): Promise<void>
  fetchBulkMarketData(symbols: string[], startDate: string): Promise<{
    data: Record<string, MarketDataRowDTO[]>
    errors: Record<string, string>
  }>
}
