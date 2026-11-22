export interface BulkMarketDataRequest {
  symbols: string[]
  start_date: string
}

/**
 * A ticker's closes as parallel arrays: close[i] is the raw close on dates[i],
 * adj_close[i] the adjusted close (null until backfilled).
 */
export interface CloseSeriesDTO {
  dates: string[]
  close: number[]
  adj_close: (number | null)[]
}

export interface BulkMarketDataResponse {
  data: Record<string, CloseSeriesDTO>
  errors: Record<string, string>
}
