import type { TickerSuggestion } from './ticker'

export interface BenchmarkDTO {
  symbol: string
  name: string | null
  currency: string | null
}

export interface BenchmarkListResponse {
  benchmarks: BenchmarkDTO[]
  count: number
}

export interface BenchmarkCreateRequest {
  symbol: string
}

export interface BenchmarkCreateResponse {
  benchmark: BenchmarkDTO
  message: string
}

export interface BenchmarkSearchResponse {
  suggestions: TickerSuggestion[]
  query: string
}

export interface BenchmarkMarketDataRowDTO {
  id: number
  benchmark: string
  date: string
  open: number | null
  high: number | null
  low: number | null
  close: number | null
  volume: number | null
}

export interface BulkBenchmarkDataResponse {
  data: Record<string, BenchmarkMarketDataRowDTO[]>
  errors: Record<string, string>
}
