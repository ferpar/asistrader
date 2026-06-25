import type {
  StrategyDTO,
  StrategyDraftCandidateDTO,
  StrategyDraftPresetDTO,
  StrategyDraftResponseDTO,
  StrategyEngineDTO,
} from '../../types/strategy'
import type {
  DraftCandidate,
  DraftPreset,
  DraftPresetKind,
  DraftResult,
  Strategy,
  StrategyEngine,
} from './types'

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
    scale: (dto.scale ?? null) as DraftPreset['scale'],
    targetCoef: dto.target_coef ?? null,
    entryCoef: dto.entry_coef ?? null,
    blendLabel: dto.blend_label ?? null,
  }
}

export function mapDraftCandidate(dto: StrategyDraftCandidateDTO): DraftCandidate {
  return {
    scale: dto.scale as DraftCandidate['scale'],
    timeBarrier: dto.time_barrier,
    targetCoef: dto.target_coef,
    entryCoef: dto.entry_coef,
    nTrials: dto.n_trials,
    winRate: dto.win_rate,
    winRateCi: dto.win_rate_ci,
    expectancyPerDay: dto.expectancy_per_day,
    efficiency: dto.efficiency,
    efficiencyCi: dto.efficiency_ci,
    fillRate: dto.fill_rate,
    presetKind: dto.preset_kind,
    confident: dto.confident,
    blendLabel: dto.blend_label ?? null,
  }
}

export function mapEngine(dto: StrategyEngineDTO): StrategyEngine {
  return {
    id: dto.id,
    label: dto.label,
    description: dto.description,
    fields: dto.fields.map((f) => ({
      key: f.key,
      label: f.label,
      type: f.type,
      default: f.default,
      options: f.options ?? null,
      min: f.min ?? null,
      max: f.max ?? null,
      step: f.step ?? null,
      help: f.help ?? null,
    })),
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
    referencePrice: dto.reference_price ?? null,
    referencePriceLive: dto.reference_price_live ?? false,
    speed: dto.speed,
    dispersion: dto.dispersion ?? null,
    engineLabel: dto.engine_label,
    engineDescription: dto.engine_description,
    presets: dto.presets.map(mapDraftPreset),
    candidates: (dto.candidates ?? []).map(mapDraftCandidate),
  }
}
