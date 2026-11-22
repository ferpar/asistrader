import type { Decimal } from '../shared/Decimal'

export interface Ticker {
  symbol: string
  name: string | null
  currency: string | null
  priceHint: number | null
  probability: Decimal | null
  trendMeanGrowth: number | null
  trendStdDeviation: number | null
  bias: 'long' | 'short' | 'neutral' | null
  horizon: string | null
  beta: 'low' | 'medium' | 'high' | null
  strategyId: number | null
  /** Detected from Yahoo: 'stock', 'etf' or another lower-cased quote type. */
  instrumentType: string | null
  /** ISO-2 country of the listing venue. */
  listingCountry: string | null
  /** Global Asset Class override; null means detection applies. */
  assetClassOverride: 'domestic_stock' | 'international_stock' | 'etf' | null
}
