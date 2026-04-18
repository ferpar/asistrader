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

export interface TickerIndicators {
  symbol: string
  name: string | null
  currentPrice: number | null
  sma: SmaStructure
  priceChanges: PriceChanges
  datedCloses: DatedClose[]
  error: string | null
}
