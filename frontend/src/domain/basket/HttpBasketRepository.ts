import type { IBasketRepository } from './IBasketRepository'
import type { Basket, BasketIndexPoint } from './types'
import type { BasketListResponse, BulkBasketIndexResponse } from '../../types/basket'
import { mapBasket, mapBasketIndex } from './mappers'
import { buildHeaders } from '../shared/httpHelpers'
import { fetchWithTimeout, MARKET_DATA_TIMEOUT_MS } from '../../api/http'

export class HttpBasketRepository implements IBasketRepository {
  constructor(
    private readonly baseUrl: string,
    private readonly getToken: () => string | null,
  ) {}

  async fetchBaskets(): Promise<Basket[]> {
    const response = await fetch(`${this.baseUrl}/api/baskets`, {
      headers: buildHeaders(this.getToken),
    })
    if (!response.ok) {
      throw new Error(`Failed to fetch baskets: ${response.statusText}`)
    }
    const result: BasketListResponse = await response.json()
    return result.baskets.map(mapBasket)
  }

  async fetchBasketIndexes(startDate: string): Promise<{
    data: Record<number, BasketIndexPoint[]>
    errors: Record<number, string>
  }> {
    const params = new URLSearchParams({ start_date: startDate })
    const response = await fetchWithTimeout(
      `${this.baseUrl}/api/baskets/index?${params}`,
      { headers: buildHeaders(this.getToken) },
      MARKET_DATA_TIMEOUT_MS,
    )
    if (!response.ok) {
      throw new Error(`Failed to fetch basket indexes: ${response.statusText}`)
    }
    const result: BulkBasketIndexResponse = await response.json()
    const data: Record<number, BasketIndexPoint[]> = {}
    for (const [id, series] of Object.entries(result.data)) {
      data[Number(id)] = mapBasketIndex(series)
    }
    const errors: Record<number, string> = {}
    for (const [id, message] of Object.entries(result.errors)) {
      errors[Number(id)] = message
    }
    return { data, errors }
  }
}
