import type { Decimal } from '../domain/shared/Decimal'
import type { PriceChanges } from '../domain/radar/types'

export type DayEstimate = number | 'receding'

export const RECEDING_MARK = '↘'

export interface TimelineRange {
  a: DayEstimate | null
  b: DayEstimate | null
  lo: number | null
  hi: number | null
  text: string
}

export function computeDaysToTarget(
  current: Decimal,
  target: Decimal,
  signedSpeed: number | null,
): DayEstimate | null {
  if (signedSpeed === null || signedSpeed === 0) return null
  const diff = target.minus(current).toNumber()
  if (diff === 0) return 0
  if (Math.sign(diff) === Math.sign(signedSpeed)) {
    return Math.abs(diff) / Math.abs(signedSpeed)
  }
  return 'receding'
}

export function computeTimelineRange(
  current: Decimal,
  target: Decimal,
  changes: PriceChanges,
): TimelineRange {
  const a = computeDaysToTarget(current, target, changes.avgChange50d)
  const b = computeDaysToTarget(current, target, changes.avgChange5d)
  const nums = [a, b].filter((v): v is number => typeof v === 'number')
  const lo = nums.length ? Math.min(...nums) : null
  const hi = nums.length ? Math.max(...nums) : null
  return { a, b, lo, hi, text: formatTimelineCell(a, b) }
}

function formatDayNumber(days: number): string {
  const rounded = Math.round(days)
  return rounded === 0 ? '<1' : String(rounded)
}

export function formatTimelineCell(
  a: DayEstimate | null,
  b: DayEstimate | null,
): string {
  const estimates = [a, b].filter((v): v is DayEstimate => v !== null)
  if (estimates.length === 0) return '-'

  const numeric = estimates.filter((v): v is number => typeof v === 'number')
  const hasReceding = estimates.some((v) => v === 'receding')

  if (numeric.length === 0) return RECEDING_MARK

  if (numeric.length === 1) {
    const text = `${formatDayNumber(numeric[0])}d`
    return hasReceding ? `${text} ${RECEDING_MARK}` : text
  }

  const lo = formatDayNumber(Math.min(numeric[0], numeric[1]))
  const hi = formatDayNumber(Math.max(numeric[0], numeric[1]))
  return lo === hi ? `${lo}d` : `${lo}–${hi}d`
}
