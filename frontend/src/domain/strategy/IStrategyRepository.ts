import type { Strategy } from './types'
import type { StrategyCreateRequest, StrategyUpdateRequest } from '../../types/strategy'

export interface IStrategyRepository {
  fetchStrategies(): Promise<Strategy[]>
  createStrategy(request: StrategyCreateRequest): Promise<Strategy>
  updateStrategy(id: number, request: StrategyUpdateRequest): Promise<Strategy>
  deleteStrategy(id: number): Promise<void>
}
