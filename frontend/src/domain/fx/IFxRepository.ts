import type { FxRate } from './types'
import type { FxSyncResponseDTO } from '../../types/fx'

export interface IFxRepository {
  /** Read stored history for the given currencies, optionally filtered by date range. */
  getHistory(
    currencies: string[],
    fromDate?: Date,
    toDate?: Date,
  ): Promise<Record<string, FxRate[]>>

  /** Ask the backend to fetch + persist history (yfinance) for the given currencies
   *  back to `startDate`. Idempotent — gap-detected on the server. */
  sync(currencies: string[], startDate: Date): Promise<FxSyncResponseDTO>
}
