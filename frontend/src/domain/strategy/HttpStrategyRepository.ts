import type { IStrategyRepository } from './IStrategyRepository'
import type { Strategy } from './types'
import type { StrategyCreateRequest, StrategyUpdateRequest, StrategyListResponse, StrategyResponse } from '../../types/strategy'
import { mapStrategy } from './mappers'
import { buildHeaders } from '../shared/httpHelpers'

export class HttpStrategyRepository implements IStrategyRepository {
  constructor(
    private readonly baseUrl: string,
    private readonly getToken: () => string | null,
  ) {}

  async fetchStrategies(): Promise<Strategy[]> {
    const response = await fetch(`${this.baseUrl}/api/strategies`, {
      headers: buildHeaders(this.getToken),
    })
    if (!response.ok) {
      throw new Error(`Failed to fetch strategies: ${response.statusText}`)
    }
    const data: StrategyListResponse = await response.json()
    return data.strategies.map(mapStrategy)
  }

  async createStrategy(request: StrategyCreateRequest): Promise<Strategy> {
    const response = await fetch(`${this.baseUrl}/api/strategies`, {
      method: 'POST',
      headers: buildHeaders(this.getToken, true),
      body: JSON.stringify(request),
    })
    if (!response.ok) {
      const error = await response.json().catch(() => ({}))
      throw new Error(error.detail || `Failed to create strategy: ${response.statusText}`)
    }
    const data: StrategyResponse = await response.json()
    return mapStrategy(data.strategy)
  }

  async updateStrategy(id: number, request: StrategyUpdateRequest): Promise<Strategy> {
    const response = await fetch(`${this.baseUrl}/api/strategies/${id}`, {
      method: 'PUT',
      headers: buildHeaders(this.getToken, true),
      body: JSON.stringify(request),
    })
    if (!response.ok) {
      const error = await response.json().catch(() => ({}))
      throw new Error(error.detail || `Failed to update strategy: ${response.statusText}`)
    }
    const data: StrategyResponse = await response.json()
    return mapStrategy(data.strategy)
  }

  async deleteStrategy(id: number): Promise<void> {
    const response = await fetch(`${this.baseUrl}/api/strategies/${id}`, {
      method: 'DELETE',
      headers: buildHeaders(this.getToken),
    })
    if (!response.ok) {
      const error = await response.json().catch(() => ({}))
      throw new Error(error.detail || `Failed to delete strategy: ${response.statusText}`)
    }
  }
}
