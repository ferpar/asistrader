export interface BulkMarketDataRequest {
  symbols: string[]
  start_date: string
}

export interface MarketDataRowDTO {
  id: number
  ticker: string
  date: string
  open: number | null
  high: number | null
  low: number | null
  close: number | null
  volume: number | null
}

export interface BulkMarketDataResponse {
  data: Record<string, MarketDataRowDTO[]>
  errors: Record<string, string>
}
