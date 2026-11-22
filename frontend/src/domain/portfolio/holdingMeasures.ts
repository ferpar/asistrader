import { annualizedTir } from '../radar/indicators'
import type { TickerIndicators } from '../radar/types'

/**
 * The radar measures shown per Holding, read straight from its ticker's
 * indicator set (IndicatorStore) so they match the radar card for that ticker.
 * The linear-regression figures use the 50-day window, the radar's "trend".
 * A measure is null when the ticker's history is too short to compute it.
 */
export interface HoldingMeasures {
  momentum: number | null
  bullishScore: number | null
  lrSlopePct: number | null
  lrR2: number | null
  tir: number | null
  rsi: number | null
}

export const EMPTY_HOLDING_MEASURES: HoldingMeasures = {
  momentum: null,
  bullishScore: null,
  lrSlopePct: null,
  lrR2: null,
  tir: null,
  rsi: null,
}

/** `indicators` is undefined while the ticker hasn't been measured yet. */
export function holdingMeasures(indicators: TickerIndicators | undefined): HoldingMeasures {
  if (!indicators) return EMPTY_HOLDING_MEASURES
  const lr = indicators.linearRegression.lr50
  return {
    momentum: indicators.momentum.score,
    bullishScore: indicators.sma.bullishScore,
    lrSlopePct: lr.slopePct,
    lrR2: lr.r2,
    tir: annualizedTir(lr.slopePct),
    rsi: indicators.rsi.latest,
  }
}
