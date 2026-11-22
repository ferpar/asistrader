import type { DatedClose } from './types'

export interface IRadarRepository {
  syncMarketData(symbols: string[], startDate: string): Promise<void>
  fetchBulkMarketData(symbols: string[], startDate: string): Promise<{
    data: Record<string, DatedClose[]>
    errors: Record<string, string>
  }>
}
