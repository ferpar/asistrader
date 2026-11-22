import { observable } from '@legendapp/state'
import type { IBasketRepository } from './IBasketRepository'
import type { BenchmarkOverlayStore } from '../benchmark/BenchmarkOverlayStore'
import type { Basket, RankingRow } from './types'
import { buildIndexIndicators } from '../radar/indicatorBuild'
import { startDate } from '../shared/marketDataWindow'

/**
 * The Baskets ranking: every visible Basket measured on its Basket Index, plus
 * every benchmark as a reference row, all through the same indicator builder
 * the radar uses for tickers.
 *
 * Benchmarks are price indices with no adjusted close, so their close stands
 * in for it and they get a Momentum Score too. Note the asymmetry: Basket
 * Indexes are built from dividend-adjusted closes (total return), while a
 * benchmark is a price return (Yahoo has no dividend-adjusted series for
 * indices), so a Basket gets a dividend-yield edge over its benchmark.
 *
 * Benchmark closes come from the shared BenchmarkOverlayStore, so the
 * ranking, the Basket detail page and the Portfolio performance chart share
 * one sync throttle.
 */
export class BasketStore {
  readonly baskets$ = observable<Basket[]>([])
  readonly rows$ = observable<RankingRow[]>([])
  readonly loading$ = observable(false)
  readonly error$ = observable<string | null>(null)

  constructor(
    private readonly basketRepo: IBasketRepository,
    private readonly benchmarks: BenchmarkOverlayStore,
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
    await this.benchmarks.load(start)
    const series = this.benchmarks.series$.peek()
    const errors = this.benchmarks.errors$.peek()
    return this.benchmarks.benchmarks$.peek().map((b) => ({
      kind: 'benchmark' as const,
      id: b.symbol,
      name: b.name ?? b.symbol,
      memberCount: null,
      indicators: buildIndexIndicators(b.symbol, series[b.symbol] ?? [], errors[b.symbol] ?? null),
    }))
  }

  // --- Personal Basket writes ---------------------------------------------
  //
  // Each write updates `baskets$` (and drops or renames ranking rows) right
  // away; callers reload the ranking when they're done, since new Baskets
  // and member changes move the indexes.

  async createBasket(name: string): Promise<Basket> {
    const basket = await this.basketRepo.createBasket(name)
    this.baskets$.set([...this.baskets$.peek(), basket])
    return basket
  }

  async renameBasket(id: number, name: string): Promise<Basket> {
    const basket = await this.basketRepo.renameBasket(id, name)
    this.replace(basket)
    this.rows$.set(
      this.rows$.peek().map((r) => (r.kind !== 'benchmark' && r.id === id ? { ...r, name: basket.name } : r)),
    )
    return basket
  }

  async deleteBasket(id: number): Promise<void> {
    await this.basketRepo.deleteBasket(id)
    this.baskets$.set(this.baskets$.peek().filter((b) => b.id !== id))
    this.rows$.set(this.rows$.peek().filter((r) => r.kind === 'benchmark' || r.id !== id))
  }

  async copyBasket(id: number, name?: string): Promise<Basket> {
    const basket = await this.basketRepo.copyBasket(id, name)
    this.baskets$.set([...this.baskets$.peek(), basket])
    return basket
  }

  async addMember(id: number, symbol: string): Promise<Basket> {
    const basket = await this.basketRepo.addMember(id, symbol)
    this.replace(basket)
    return basket
  }

  async removeMember(id: number, symbol: string): Promise<void> {
    await this.basketRepo.removeMember(id, symbol)
    const basket = this.baskets$.peek().find((b) => b.id === id)
    if (basket) this.replace({ ...basket, members: basket.members.filter((m) => m !== symbol) })
  }

  /**
   * Make sure `basket` is in `baskets$`, e.g. one opened straight from its
   * detail page before the ranking ever loaded, so member edits can track it.
   */
  remember(basket: Basket): void {
    if (this.baskets$.peek().some((b) => b.id === basket.id)) return
    this.baskets$.set([...this.baskets$.peek(), basket])
  }

  private replace(basket: Basket): void {
    this.baskets$.set(this.baskets$.peek().map((b) => (b.id === basket.id ? basket : b)))
  }
}
