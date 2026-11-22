export interface BulkMarketDataRequest {
  symbols: string[]
  start_date: string
}

/** A ticker's closes as parallel arrays: close[i] is the close on dates[i]. */
export interface CloseSeriesDTO {
  dates: string[]
  close: number[]
}

export interface BulkMarketDataResponse {
  data: Record<string, CloseSeriesDTO>
  errors: Record<string, string>
}
