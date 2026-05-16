export interface SmaStructure {
  sma5: number | null
  sma20: number | null
  sma50: number | null
  sma200: number | null
  structure: string | null
}

export interface PriceChanges {
  avgChange50d: number | null
  avgChangePct50d: number | null
  avgChange5d: number | null
  avgChangePct5d: number | null
}

export interface DatedClose {
  date: string
  close: number
}

export interface LinearRegressionResult {
  slope: number | null
  slopePct: number | null
  r2: number | null
}

export interface LinearRegressionStructure {
  lr20: LinearRegressionResult
  lr50: LinearRegressionResult
  lr200: LinearRegressionResult
}

export interface RsiPivot {
  index: number
  date: string
  rsi: number
  price: number
}

export type DivergenceStrength = 'weak' | 'moderate' | 'strong'

export interface DivergenceSignal {
  fromDate: string
  toDate: string
  rsiSlope: number
  priceSlopePct: number
  touchCount: number
  strength: DivergenceStrength
}

export interface RsiIndicator {
  series: (number | null)[]
  latest: number | null
  divergence: {
    bearish: DivergenceSignal | null
    bullish: DivergenceSignal | null
  }
}

export interface TickerIndicators {
  symbol: string
  name: string | null
  currentPrice: number | null
  sma: SmaStructure
  priceChanges: PriceChanges
  linearRegression: LinearRegressionStructure
  rsi: RsiIndicator
  datedCloses: DatedClose[]
  error: string | null
}
