import type { Basket, BasketIndexPoint, BasketMember } from './types'

export interface IBasketRepository {
  /** Every Basket the user can see: all Curated ones plus their Personal ones. */
  fetchBaskets(): Promise<Basket[]>
  /** Every visible Basket's index from `startDate`, keyed by Basket id. */
  fetchBasketIndexes(startDate: string): Promise<{
    data: Record<number, BasketIndexPoint[]>
    errors: Record<number, string>
  }>
  /** One visible Basket. */
  fetchBasket(id: number): Promise<Basket>
  /** One visible Basket's index from `startDate`. */
  fetchBasketIndex(id: number, startDate: string): Promise<BasketIndexPoint[]>
  /** A Basket's members, each with the user's Portfolios that hold it. */
  fetchBasketMembers(id: number): Promise<BasketMember[]>
}
