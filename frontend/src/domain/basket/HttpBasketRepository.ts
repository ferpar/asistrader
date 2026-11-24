import type { IBasketRepository } from './IBasketRepository'
import type { Basket, BasketMember } from './types'
import type { LevelPoint } from '../shared/rebase'
import type {
  BasketCopyRequest,
  BasketCreateRequest,
  BasketDTO,
  BasketListResponse,
  BasketMemberAddRequest,
  BasketMembersResponse,
  BasketUpdateRequest,
  BulkBasketIndexResponse,
} from '../../types/basket'
import type { CloseSeriesDTO } from '../../types/radar'
import { mapBasket, mapBasketIndex, mapBasketMember } from './mappers'
import { buildHeaders, failure } from '../shared/httpHelpers'
import { fetchWithTimeout, MARKET_DATA_TIMEOUT_MS } from '../../api/http'

/** An Error carrying the API's `detail` (e.g. why Yahoo rejected a symbol). */
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
    data: Record<number, LevelPoint[]>
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
    const data: Record<number, LevelPoint[]> = {}
    for (const [id, series] of Object.entries(result.data)) {
      data[Number(id)] = mapBasketIndex(series)
    }
    const errors: Record<number, string> = {}
    for (const [id, message] of Object.entries(result.errors)) {
      errors[Number(id)] = message
    }
    return { data, errors }
  }

  async fetchBasket(id: number): Promise<Basket> {
    const response = await fetch(`${this.baseUrl}/api/baskets/${id}`, {
      headers: buildHeaders(this.getToken),
    })
    if (!response.ok) {
      throw new Error(response.status === 404 ? 'Basket not found' : `Failed to fetch basket: ${response.statusText}`)
    }
    const result: BasketDTO = await response.json()
    return mapBasket(result)
  }

  async fetchBasketIndex(id: number, startDate: string): Promise<LevelPoint[]> {
    const params = new URLSearchParams({ start_date: startDate })
    const response = await fetchWithTimeout(
      `${this.baseUrl}/api/baskets/${id}/index?${params}`,
      { headers: buildHeaders(this.getToken) },
      MARKET_DATA_TIMEOUT_MS,
    )
    if (!response.ok) {
      throw new Error(`Failed to fetch basket index: ${response.statusText}`)
    }
    const result: CloseSeriesDTO = await response.json()
    return mapBasketIndex(result)
  }

  async fetchBasketMembers(id: number): Promise<BasketMember[]> {
    const response = await fetch(`${this.baseUrl}/api/baskets/${id}/members`, {
      headers: buildHeaders(this.getToken),
    })
    if (!response.ok) {
      throw new Error(`Failed to fetch basket members: ${response.statusText}`)
    }
    const result: BasketMembersResponse = await response.json()
    return result.members.map(mapBasketMember)
  }

  private async send(path: string, method: string, body: unknown, fallback: string): Promise<Basket> {
    const response = await fetch(`${this.baseUrl}/api/baskets${path}`, {
      method,
      headers: buildHeaders(this.getToken, true),
      body: JSON.stringify(body),
    })
    if (!response.ok) throw await failure(response, fallback)
    const dto: BasketDTO = await response.json()
    return mapBasket(dto)
  }

  private async remove(path: string, fallback: string): Promise<void> {
    const response = await fetch(`${this.baseUrl}/api/baskets${path}`, {
      method: 'DELETE',
      headers: buildHeaders(this.getToken),
    })
    if (!response.ok) throw await failure(response, fallback)
  }

  createBasket(name: string): Promise<Basket> {
    const body: BasketCreateRequest = { name }
    return this.send('', 'POST', body, 'Failed to create Basket')
  }

  renameBasket(id: number, name: string): Promise<Basket> {
    const body: BasketUpdateRequest = { name }
    return this.send(`/${id}`, 'PATCH', body, 'Failed to rename Basket')
  }

  deleteBasket(id: number): Promise<void> {
    return this.remove(`/${id}`, 'Failed to delete Basket')
  }

  copyBasket(id: number, name?: string): Promise<Basket> {
    const body: BasketCopyRequest = name ? { name } : {}
    return this.send(`/${id}/copy`, 'POST', body, 'Failed to copy Basket')
  }

  addMember(id: number, symbol: string): Promise<Basket> {
    const body: BasketMemberAddRequest = { symbol }
    return this.send(`/${id}/members`, 'POST', body, `Failed to add ${symbol}`)
  }

  removeMember(id: number, symbol: string): Promise<void> {
    return this.remove(`/${id}/members/${encodeURIComponent(symbol)}`, `Failed to remove ${symbol}`)
  }
}
