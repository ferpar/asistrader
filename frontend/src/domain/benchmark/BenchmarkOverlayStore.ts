import { observable } from '@legendapp/state'
import type { IBenchmarkRepository } from './IBenchmarkRepository'
import type { Benchmark } from './types'
import type { LevelPoint } from '../shared/rebase'
import { SYNC_THROTTLE_MS } from '../shared/marketDataWindow'

/**
 * The one place benchmark closes are loaded from: every benchmark's closes
 * from a start date, synced at most once per throttle window (or when an
 * earlier start needs a backfill). Used by the pages that overlay the
 * benchmarks the user picks on a rebased chart (Portfolio performance, Basket
 * detail) and by the Baskets ranking for its reference rows. Benchmarks are
 * optional everywhere: a failure leaves the list empty and never breaks the
 * page.
 */
export class BenchmarkOverlayStore {
  readonly benchmarks$ = observable<Benchmark[]>([])
  /** Closes per benchmark symbol, from the last requested start. */
  readonly series$ = observable<Record<string, LevelPoint[]>>({})
  /** Fetch error per benchmark symbol, if any, from the last requested start. */
  readonly errors$ = observable<Record<string, string>>({})
  private lastSync = 0
  private syncedFrom: string | null = null
  private requested: string | null = null

  constructor(private readonly repo: IBenchmarkRepository) {}

  async load(start: string): Promise<void> {
    this.requested = start
    try {
      const benchmarks = await this.repo.fetchBenchmarks()
      if (this.requested !== start) return
      this.benchmarks$.set(benchmarks)
      if (benchmarks.length === 0) return
      const symbols = benchmarks.map((b) => b.symbol)
      // A start earlier than any synced so far needs a backfill, throttle or not.
      const needsBackfill = this.syncedFrom === null || start < this.syncedFrom
      if (needsBackfill || Date.now() - this.lastSync > SYNC_THROTTLE_MS) {
        await this.repo.syncBenchmarkData(symbols, start).catch(() => undefined)
        this.lastSync = Date.now()
        if (needsBackfill) this.syncedFrom = start
      }
      const result = await this.repo.fetchBulkBenchmarkData(symbols, start)
      if (this.requested !== start) return
      const series: Record<string, LevelPoint[]> = {}
      for (const symbol of symbols) {
        series[symbol] = (result.data[symbol] ?? [])
          .filter((r) => r.close !== null)
          .map((r) => ({ date: r.date, value: r.close as number }))
      }
      this.series$.set(series)
      this.errors$.set({ ...result.errors })
    } catch {
      // Overlays are optional; the chart just offers none.
    }
  }
}
