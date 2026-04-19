import type { Benchmark } from './types'
import type {
  BenchmarkCreateRequest,
  BenchmarkMarketDataRowDTO,
} from '../../types/benchmark'
import type { TickerSuggestion } from '../../types/ticker'

export interface IBenchmarkRepository {
  fetchBenchmarks(): Promise<Benchmark[]>
  searchBenchmarks(query: string): Promise<TickerSuggestion[]>
  createBenchmark(request: BenchmarkCreateRequest): Promise<Benchmark>
  removeBenchmark(symbol: string): Promise<void>
  syncBenchmarkData(symbols: string[], startDate: string): Promise<void>
  fetchBulkBenchmarkData(
    symbols: string[],
    startDate: string,
  ): Promise<{
    data: Record<string, BenchmarkMarketDataRowDTO[]>
    errors: Record<string, string>
  }>
}
