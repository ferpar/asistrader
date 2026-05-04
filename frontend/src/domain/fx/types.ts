import { Decimal } from '../shared/Decimal'

export interface FxRate {
  currency: string
  date: Date
  rateToUsd: Decimal
}

/** ISO date string (YYYY-MM-DD) → rateToUsd. Per currency. */
export type FxRateSeries = Map<string, Decimal>

export interface FxRateHistory {
  /** currency → series. USD is implicit (rate 1.0); never stored here. */
  perCurrency: Map<string, FxRateSeries>
}
