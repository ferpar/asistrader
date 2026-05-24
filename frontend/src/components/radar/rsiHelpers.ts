import { RSI_OVERBOUGHT, RSI_OVERSOLD } from '../../domain/radar/indicators'
import type { DivergenceSignal } from '../../domain/radar/types'
import styles from './RadarTickerCard.module.css'

/** Sign-coloring class for an RSI value: bearish in overbought, bullish in
 *  oversold, neutral otherwise. Both radar cards reuse the ticker card's
 *  stylesheet, so the same color tokens apply. */
export function getRsiTone(value: number | null): string {
  if (value === null) return ''
  if (value >= RSI_OVERBOUGHT) return styles.bearish
  if (value <= RSI_OVERSOLD) return styles.bullish
  return ''
}

export function divergenceRange(d: DivergenceSignal): string {
  return `${d.pivots[0].date} → ${d.pivots[d.pivots.length - 1].date}`
}

export function divergenceTitle(d: DivergenceSignal): string {
  return `${d.touchCount} touches · ${d.strength}\nPivots: ${d.pivots
    .map((p) => p.date)
    .join(', ')}`
}
