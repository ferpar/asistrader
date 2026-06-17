import type {
  StrategyDTO,
  StrategyDraftPresetDTO,
  StrategyDraftResponseDTO,
} from '../../types/strategy'
import type { DraftPreset, DraftPresetKind, DraftResult, Strategy } from './types'

export function mapStrategy(dto: StrategyDTO): Strategy {
  return {
    id: dto.id,
    name: dto.name,
    peMethod: dto.pe_method,
    slMethod: dto.sl_method,
    tpMethod: dto.tp_method,
    description: dto.description,
    automated: dto.automated ?? false,
    params: dto.params ?? null,
  }
}

export function mapDraftPreset(dto: StrategyDraftPresetDTO): DraftPreset {
  return {
    kind: dto.kind as DraftPresetKind,
    d2: dto.d2,
    winRate: dto.win_rate,
    expectancy: dto.expectancy,
    expectancyPerDay: dto.expectancy_per_day,
    efficiency: dto.efficiency,
    winRateCi: dto.win_rate_ci,
    efficiencyCi: dto.efficiency_ci,
    nTrials: dto.n_trials,
    entry: dto.entry,
    stopLoss: dto.stop_loss,
    takeProfit: dto.take_profit,
  }
}

export function mapDraftResult(dto: StrategyDraftResponseDTO): DraftResult {
  return {
    confident: dto.confident,
    reason: dto.reason,
    breakevenWinRate: dto.breakeven_win_rate,
    fillRate: dto.fill_rate,
    ticker: dto.ticker,
    lastBarDate: dto.last_bar_date,
    speed: dto.speed,
    presets: dto.presets.map(mapDraftPreset),
  }
}
