/**
 * Pure helpers for the automated-strategy draft flow: selecting/ordering presets
 * and building the draft-time snapshot persisted on the trade. No React, no I/O —
 * unit-tested in isolation.
 */
import type { DraftPreset, DraftPresetKind, DraftResult } from './types'

/** Display order: fastest (aggressive) → safest (conservative). */
export const PRESET_ORDER: DraftPresetKind[] = ['aggressive', 'regular', 'conservative']

export function presetByKind(result: DraftResult, kind: DraftPresetKind): DraftPreset | undefined {
  return result.presets.find((p) => p.kind === kind)
}

/** Presets sorted into the canonical display order. */
export function orderedPresets(result: DraftResult): DraftPreset[] {
  return [...result.presets].sort(
    (a, b) => PRESET_ORDER.indexOf(a.kind) - PRESET_ORDER.indexOf(b.kind),
  )
}

/** The preset to pre-select: "regular" when present, else the first available. */
export function defaultPreset(result: DraftResult): DraftPreset | null {
  if (result.presets.length === 0) return null
  return presetByKind(result, 'regular') ?? orderedPresets(result)[0]
}

/** Whether the draft is usable for pre-filling a trade. */
export function isDraftable(result: DraftResult): boolean {
  return result.confident && result.presets.length > 0
}

/**
 * Snapshot of the draft-time recommendation to persist on the trade
 * (`strategy_snapshot`) for later realized-vs-expected analysis. Captured at
 * confirm time because the sweep moves as new data accrues.
 */
export function buildStrategySnapshot(
  result: DraftResult,
  preset: DraftPreset,
  plrUsed: number,
  d1: number,
): Record<string, unknown> {
  return {
    preset: preset.kind,
    d2: preset.d2,
    d1,
    plr_used: plrUsed,
    expected_win_rate: preset.winRate,
    expected_efficiency: preset.efficiency,
    expected_expectancy: preset.expectancy,
    win_rate_ci: preset.winRateCi,
    efficiency_ci: preset.efficiencyCi,
    fill_rate: result.fillRate,
    n_trials: preset.nTrials,
    breakeven_win_rate: result.breakevenWinRate,
    sweep_last_bar_date: result.lastBarDate,
  }
}
