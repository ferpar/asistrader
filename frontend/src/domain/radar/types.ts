export interface EmaStructure {
  ema5: number | null
  ema20: number | null
  ema50: number | null
  ema200: number | null
  structure: string | null
}

export interface PriceChanges {
  avgChange50d: number | null
  avgChangePct50d: number | null
  avgChange5d: number | null
  avgChangePct5d: number | null
}

export interface TickerIndicators {
  symbol: string
  name: string | null
  currentPrice: number | null
  ema: EmaStructure
  priceChanges: PriceChanges
  error: string | null
}
