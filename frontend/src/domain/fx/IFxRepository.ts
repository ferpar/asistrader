import type { FxRate } from './types'

export interface IFxRepository {
  /** Read stored history for the given currencies, optionally filtered by date range. */
  getHistory(
    currencies: string[],
    fromDate?: Date,
    toDate?: Date,
  ): Promise<Record<string, FxRate[]>>
}
