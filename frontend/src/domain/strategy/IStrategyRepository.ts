import type { DraftResult, Strategy } from './types'
import type {
  StrategyCreateRequest,
  StrategyDraftRequestDTO,
  StrategyUpdateRequest,
} from '../../types/strategy'

export interface IStrategyRepository {
  fetchStrategies(): Promise<Strategy[]>
  createStrategy(request: StrategyCreateRequest): Promise<Strategy>
  updateStrategy(id: number, request: StrategyUpdateRequest): Promise<Strategy>
  deleteStrategy(id: number): Promise<void>
  /** Draft a trade for a ticker using an automated strategy. */
  draftTrade(id: number, request: StrategyDraftRequestDTO): Promise<DraftResult>
}
