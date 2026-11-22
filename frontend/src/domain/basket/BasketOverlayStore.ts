import { observable } from '@legendapp/state'
import type { IBasketRepository } from './IBasketRepository'
import type { Basket } from './types'
import type { LevelPoint } from '../shared/rebase'

/**
 * The visible Baskets and their Basket Indexes from a start date, for pages
 * that overlay the Baskets the user picks on a rebased chart (the Portfolio
 * performance chart), next to the benchmarks of BenchmarkOverlayStore.
 *
 * The list is cheap and loads up front; the indexes come from the bulk
 * endpoint, which computes every visible Basket, so they load only once the
 * user picks a first Basket. Overlays are optional: a failure leaves the
 * list or series empty and never breaks the page.
 */
export class BasketOverlayStore {
  readonly baskets$ = observable<Basket[]>([])
  /** Basket Index per Basket id, from the last start the indexes were loaded for. */
  readonly series$ = observable<Record<number, LevelPoint[]>>({})
  private requested: string | null = null
  private indexesFrom: string | null = null

  constructor(private readonly repo: IBasketRepository) {}

  async load(start: string): Promise<void> {
    if (this.requested !== start) {
      this.requested = start
      this.indexesFrom = null
      this.series$.set({})
    }
    try {
      const baskets = await this.repo.fetchBaskets()
      if (this.requested === start) this.baskets$.set(baskets)
    } catch {
      // Overlays are optional; the chart just offers no Baskets.
    }
  }

  /** Load every visible Basket Index from the current start, once per start. */
  async loadIndexes(): Promise<void> {
    const start = this.requested
    if (start === null || this.indexesFrom === start) return
    this.indexesFrom = start
    try {
      const result = await this.repo.fetchBasketIndexes(start)
      if (this.requested === start) this.series$.set(result.data)
    } catch {
      // Let a later pick retry.
      if (this.indexesFrom === start) this.indexesFrom = null
    }
  }
}
