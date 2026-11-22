import type { Basket, BasketIndexPoint } from './types'

export interface IBasketRepository {
  /** Every Basket the user can see: all Curated ones plus their Personal ones. */
  fetchBaskets(): Promise<Basket[]>
  /** Every visible Basket's index from `startDate`, keyed by Basket id. */
  fetchBasketIndexes(startDate: string): Promise<{
    data: Record<number, BasketIndexPoint[]>
    errors: Record<number, string>
  }>
}
