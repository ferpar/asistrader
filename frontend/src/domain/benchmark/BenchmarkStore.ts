import { observable } from '@legendapp/state'
import type { IBenchmarkRepository } from './IBenchmarkRepository'
import type { Benchmark } from './types'
import type { BenchmarkCreateRequest } from '../../types/benchmark'
import type { TickerSuggestion } from '../../types/ticker'

export class BenchmarkStore {
  benchmarks$ = observable<Benchmark[]>([])
  loading$ = observable(false)

  constructor(private readonly repo: IBenchmarkRepository) {}

  async loadBenchmarks(): Promise<void> {
    this.loading$.set(true)
    try {
      const benchmarks = await this.repo.fetchBenchmarks()
      this.benchmarks$.set(benchmarks)
    } finally {
      this.loading$.set(false)
    }
  }

  async searchBenchmarks(query: string): Promise<TickerSuggestion[]> {
    return this.repo.searchBenchmarks(query)
  }

  async createBenchmark(request: BenchmarkCreateRequest): Promise<Benchmark> {
    const benchmark = await this.repo.createBenchmark(request)
    this.benchmarks$.set([...this.benchmarks$.get(), benchmark])
    return benchmark
  }

  async removeBenchmark(symbol: string): Promise<void> {
    await this.repo.removeBenchmark(symbol)
    this.benchmarks$.set(this.benchmarks$.get().filter((b) => b.symbol !== symbol))
  }
}
