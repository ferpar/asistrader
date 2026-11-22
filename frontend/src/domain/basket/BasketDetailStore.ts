import { observable } from '@legendapp/state'
import type { IBasketRepository } from './IBasketRepository'
import type { IBenchmarkRepository } from '../benchmark/IBenchmarkRepository'
import type { Benchmark } from '../benchmark/types'
import type { Basket, BasketIndexPoint, BasketMember } from './types'
import { startDate, SYNC_THROTTLE_MS } from '../radar/indicatorBuild'

/**
 * One Basket's detail page: the Basket, its Basket Index, its members with
 * the user's Portfolios that hold them, and every benchmark's closes over the
 * same window so the page can overlay the ones the user picks.
 *
 * Members' measures are not computed here: they are the members' ticker
 * indicator sets from the IndicatorStore, the same values the radar shows.
 */
export class BasketDetailStore {
  readonly basket$ = observable<Basket | null>(null)
  readonly index$ = observable<BasketIndexPoint[]>([])
  readonly members$ = observable<BasketMember[]>([])
  readonly benchmarks$ = observable<Benchmark[]>([])
  /** Closes per benchmark symbol, over the indicator window. */
  readonly benchmarkSeries$ = observable<Record<string, BasketIndexPoint[]>>({})
  readonly loading$ = observable(false)
  readonly error$ = observable<string | null>(null)
  private lastBenchmarkSync = 0
  private requested: number | null = null

  constructor(
    private readonly basketRepo: IBasketRepository,
    private readonly benchmarkRepo: IBenchmarkRepository,
  ) {}

  async load(basketId: number): Promise<void> {
    this.requested = basketId
    if (this.basket$.peek()?.id !== basketId) {
      this.basket$.set(null)
      this.index$.set([])
      this.members$.set([])
    }
    this.loading$.set(true)
    this.error$.set(null)
    const start = startDate()
    try {
      const [basket, index, members] = await Promise.all([
        this.basketRepo.fetchBasket(basketId),
        this.basketRepo.fetchBasketIndex(basketId, start),
        this.basketRepo.fetchBasketMembers(basketId),
        this.loadBenchmarks(start),
      ])
      if (this.requested !== basketId) return
      this.basket$.set(basket)
      this.index$.set(index)
      this.members$.set(members)
    } catch (err) {
      if (this.requested !== basketId) return
      this.error$.set(err instanceof Error ? err.message : 'Failed to load basket')
    } finally {
      if (this.requested === basketId) this.loading$.set(false)
    }
  }

  /** Benchmark closes for the overlays; a benchmark failure never hides the Basket. */
  private async loadBenchmarks(start: string): Promise<void> {
    try {
      const benchmarks = await this.benchmarkRepo.fetchBenchmarks()
      this.benchmarks$.set(benchmarks)
      if (benchmarks.length === 0) return
      const symbols = benchmarks.map((b) => b.symbol)
      if (Date.now() - this.lastBenchmarkSync > SYNC_THROTTLE_MS) {
        await this.benchmarkRepo.syncBenchmarkData(symbols, start).catch(() => undefined)
        this.lastBenchmarkSync = Date.now()
      }
      const result = await this.benchmarkRepo.fetchBulkBenchmarkData(symbols, start)
      const series: Record<string, BasketIndexPoint[]> = {}
      for (const symbol of symbols) {
        series[symbol] = (result.data[symbol] ?? [])
          .filter((r) => r.close !== null)
          .map((r) => ({ date: r.date, value: r.close as number }))
      }
      this.benchmarkSeries$.set(series)
    } catch {
      // Overlays are optional; the chart just offers none.
    }
  }
}
