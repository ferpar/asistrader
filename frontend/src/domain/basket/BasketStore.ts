import { observable } from '@legendapp/state'
import type { IBasketRepository } from './IBasketRepository'
import type { IBenchmarkRepository } from '../benchmark/IBenchmarkRepository'
import type { Basket, RankingRow } from './types'
import { buildIndexIndicators, startDate, SYNC_THROTTLE_MS } from '../radar/indicatorBuild'

/**
 * The Baskets ranking: every visible Basket measured on its Basket Index, plus
 * every benchmark as a reference row, all through the same indicator builder
 * the radar uses for tickers.
 *
 * Benchmarks are price indices with no adjusted close, so their close stands
 * in for it and they get a Momentum Score too (a price return, not a total
 * return — for an index like ^GSPC the two coincide).
 */
export class BasketStore {
  readonly baskets$ = observable<Basket[]>([])
  readonly rows$ = observable<RankingRow[]>([])
  readonly loading$ = observable(false)
  readonly error$ = observable<string | null>(null)
  private lastBenchmarkSync = 0

  constructor(
    private readonly basketRepo: IBasketRepository,
    private readonly benchmarkRepo: IBenchmarkRepository,
  ) {}

  async loadRanking(): Promise<void> {
    this.loading$.set(true)
    this.error$.set(null)
    const start = startDate()
    try {
      const [baskets, indexes, benchmarkRows] = await Promise.all([
        this.basketRepo.fetchBaskets(),
        this.basketRepo.fetchBasketIndexes(start),
        this.loadBenchmarkRows(start),
      ])
      const basketRows: RankingRow[] = baskets.map((b) => ({
        kind: b.kind,
        id: b.id,
        name: b.name,
        memberCount: b.members.length,
        indicators: buildIndexIndicators(`basket:${b.id}`, indexes.data[b.id] ?? [], indexes.errors[b.id] ?? null),
      }))
      this.baskets$.set(baskets)
      this.rows$.set([...basketRows, ...benchmarkRows])
    } catch (err) {
      this.error$.set(err instanceof Error ? err.message : 'Failed to load baskets')
    } finally {
      this.loading$.set(false)
    }
  }

  /** Benchmark reference rows; a benchmark failure never hides the Baskets. */
  private async loadBenchmarkRows(start: string): Promise<RankingRow[]> {
    try {
      const benchmarks = await this.benchmarkRepo.fetchBenchmarks()
      if (benchmarks.length === 0) return []
      const symbols = benchmarks.map((b) => b.symbol)
      if (Date.now() - this.lastBenchmarkSync > SYNC_THROTTLE_MS) {
        await this.benchmarkRepo.syncBenchmarkData(symbols, start).catch(() => undefined)
        this.lastBenchmarkSync = Date.now()
      }
      const result = await this.benchmarkRepo.fetchBulkBenchmarkData(symbols, start)
      return benchmarks.map((b) => ({
        kind: 'benchmark' as const,
        id: b.symbol,
        name: b.name ?? b.symbol,
        memberCount: null,
        indicators: buildIndexIndicators(
          b.symbol,
          (result.data[b.symbol] ?? []).map((r) => ({ date: r.date, value: r.close })),
          result.errors[b.symbol] ?? null,
        ),
      }))
    } catch {
      return []
    }
  }
}
