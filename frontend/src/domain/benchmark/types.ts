import type { SmaStructure, PriceChanges } from '../radar/types'

export interface Benchmark {
  symbol: string
  name: string | null
  currency: string | null
}

export interface BenchmarkIndicators {
  symbol: string
  name: string | null
  currentPrice: number | null
  sma: SmaStructure
  priceChanges: PriceChanges
  error: string | null
}
