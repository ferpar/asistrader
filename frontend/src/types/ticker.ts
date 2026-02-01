export interface TickerDTO {
  symbol: string
  name: string | null
  probability: number | null
  trend_mean_growth: number | null
  trend_std_deviation: number | null
  bias: 'long' | 'short' | 'neutral' | null
  horizon: string | null
  beta: 'low' | 'medium' | 'high' | null
  strategy_id: number | null
}

export interface TickerListResponse {
  tickers: TickerDTO[]
  count: number
}

export interface TickerSuggestion {
  symbol: string
  name: string | null
  exchange: string | null
  type: string | null
}

export interface TickerSearchResponse {
  suggestions: TickerSuggestion[]
  query: string
}

export interface TickerCreateRequest {
  symbol: string
}

export interface TickerCreateResponse {
  ticker: TickerDTO
  message: string
}

export interface TickerPriceResponse {
  symbol: string
  price: number | null
  currency: string | null
  valid: boolean
}
