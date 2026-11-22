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
  /** Create an empty Personal Basket. */
  createBasket(name: string): Promise<Basket>
  /** Rename one of the user's Personal Baskets. */
  renameBasket(id: number, name: string): Promise<Basket>
  /** Delete one of the user's Personal Baskets (its tickers stay). */
  deleteBasket(id: number): Promise<void>
  /** Copy a visible Basket into a new Personal one; `name` defaults to "<name> (copy)". */
  copyBasket(id: number, name?: string): Promise<Basket>
  /** Add a member by symbol; an unknown symbol is created and its history loaded. */
  addMember(id: number, symbol: string): Promise<Basket>
  removeMember(id: number, symbol: string): Promise<void>
}
