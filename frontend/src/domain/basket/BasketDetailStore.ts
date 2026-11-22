import { observable } from '@legendapp/state'
import type { IBasketRepository } from './IBasketRepository'
import type { BenchmarkOverlayStore } from '../benchmark/BenchmarkOverlayStore'
import type { LevelPoint } from '../shared/rebase'
import type { Basket, BasketMember } from './types'
import { startDate } from '../shared/marketDataWindow'

/**
 * One Basket's detail page: the Basket, its Basket Index and its members with
 * the user's Portfolios that hold them. Every benchmark's closes over the same
 * window are loaded alongside into the shared BenchmarkOverlayStore, so the
 * page can overlay the ones the user picks.
 *
 * Members' measures are not computed here: they are the members' ticker
 * indicator sets from the IndicatorStore, the same values the radar shows.
 */
export class BasketDetailStore {
  readonly basket$ = observable<Basket | null>(null)
  readonly index$ = observable<LevelPoint[]>([])
  readonly members$ = observable<BasketMember[]>([])
  readonly loading$ = observable(false)
  readonly error$ = observable<string | null>(null)
  private requested: number | null = null

  constructor(
    private readonly basketRepo: IBasketRepository,
    private readonly benchmarks: BenchmarkOverlayStore,
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
        // Never rejects: a benchmark failure never hides the Basket.
        this.benchmarks.load(start),
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
}
