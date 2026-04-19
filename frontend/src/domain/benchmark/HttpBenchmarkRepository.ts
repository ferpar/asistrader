import type { IBenchmarkRepository } from './IBenchmarkRepository'
import type { Benchmark } from './types'
import type {
  BenchmarkCreateRequest,
  BenchmarkCreateResponse,
  BenchmarkDTO,
  BenchmarkListResponse,
  BenchmarkMarketDataRowDTO,
  BenchmarkSearchResponse,
  BulkBenchmarkDataResponse,
} from '../../types/benchmark'
import type { TickerSuggestion } from '../../types/ticker'
import type { SyncResponseDTO } from '../../types/marketData'
import { buildHeaders } from '../shared/httpHelpers'

function mapBenchmark(dto: BenchmarkDTO): Benchmark {
  return {
    symbol: dto.symbol,
    name: dto.name,
    currency: dto.currency,
  }
}

export class HttpBenchmarkRepository implements IBenchmarkRepository {
  constructor(
    private readonly baseUrl: string,
    private readonly getToken: () => string | null,
  ) {}

  async fetchBenchmarks(): Promise<Benchmark[]> {
    const response = await fetch(`${this.baseUrl}/api/benchmarks`, {
      headers: buildHeaders(this.getToken),
    })
    if (!response.ok) {
      throw new Error(`Failed to fetch benchmarks: ${response.statusText}`)
    }
    const data: BenchmarkListResponse = await response.json()
    return data.benchmarks.map(mapBenchmark)
  }

  async searchBenchmarks(query: string): Promise<TickerSuggestion[]> {
    const response = await fetch(
      `${this.baseUrl}/api/benchmarks/search?q=${encodeURIComponent(query)}`,
      { headers: buildHeaders(this.getToken) },
    )
    if (!response.ok) {
      throw new Error(`Failed to search benchmarks: ${response.statusText}`)
    }
    const data: BenchmarkSearchResponse = await response.json()
    return data.suggestions
  }

  async createBenchmark(request: BenchmarkCreateRequest): Promise<Benchmark> {
    const response = await fetch(`${this.baseUrl}/api/benchmarks`, {
      method: 'POST',
      headers: buildHeaders(this.getToken, true),
      body: JSON.stringify(request),
    })
    if (!response.ok) {
      const error = await response.json().catch(() => ({}))
      throw new Error(error.detail || `Failed to create benchmark: ${response.statusText}`)
    }
    const data: BenchmarkCreateResponse = await response.json()
    return mapBenchmark(data.benchmark)
  }

  async removeBenchmark(symbol: string): Promise<void> {
    const response = await fetch(
      `${this.baseUrl}/api/benchmarks/${encodeURIComponent(symbol)}`,
      { method: 'DELETE', headers: buildHeaders(this.getToken) },
    )
    if (!response.ok && response.status !== 404) {
      throw new Error(`Failed to remove benchmark: ${response.statusText}`)
    }
  }

  async syncBenchmarkData(symbols: string[], startDate: string): Promise<void> {
    const response = await fetch(`${this.baseUrl}/api/benchmarks/sync-all`, {
      method: 'POST',
      headers: buildHeaders(this.getToken, true),
      body: JSON.stringify({ start_date: startDate, symbols }),
    })
    if (!response.ok) {
      throw new Error(`Failed to sync benchmark data: ${response.statusText}`)
    }
    await response.json() as SyncResponseDTO
  }

  async fetchBulkBenchmarkData(
    symbols: string[],
    startDate: string,
  ): Promise<{
    data: Record<string, BenchmarkMarketDataRowDTO[]>
    errors: Record<string, string>
  }> {
    const response = await fetch(`${this.baseUrl}/api/benchmarks/bulk`, {
      method: 'POST',
      headers: buildHeaders(this.getToken, true),
      body: JSON.stringify({ symbols, start_date: startDate }),
    })
    if (!response.ok) {
      throw new Error(`Failed to fetch bulk benchmark data: ${response.statusText}`)
    }
    const result: BulkBenchmarkDataResponse = await response.json()
    return { data: result.data, errors: result.errors }
  }
}
