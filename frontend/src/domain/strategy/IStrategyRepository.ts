import type { DraftResult, Strategy, StrategyEngine } from './types'
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
  /** The code-defined catalog of automated-strategy engines + param schemas. */
  fetchEngines(): Promise<StrategyEngine[]>
}
