export interface FxRateDTO {
  currency: string
  date: string
  rate_to_usd: number
}

export interface FxRatesResponseDTO {
  rates: Record<string, FxRateDTO[]>
}

export interface FxSyncRequestDTO {
  start_date: string
  currencies?: string[] | null
}

export interface FxSyncResponseDTO {
  results: Record<string, number>
  total_rows: number
  skipped: string[]
  errors: Record<string, string>
}
