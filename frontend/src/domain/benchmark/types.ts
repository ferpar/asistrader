import type {
  DatedClose,
  LinearRegressionStructure,
  MomentumScore,
  PriceChanges,
  RsiIndicator,
  SmaStructure,
} from '../radar/types'

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
  linearRegression: LinearRegressionStructure
  rsi: RsiIndicator
  momentum: MomentumScore
  datedCloses: DatedClose[]
  error: string | null
}
