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
}
