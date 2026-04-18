import type { Decimal } from '../domain/shared/Decimal'

export interface DaysRange {
  min: number
  max: number
}

export function computeDaysToTarget(
  current: Decimal,
  target: Decimal,
  dailyChange: number | null,
): number | null {
  if (dailyChange === null) return null
  const speed = Math.abs(dailyChange)
  if (speed === 0) return null
  const distance = Math.abs(current.minus(target).toNumber())
  return distance / speed
}

export function computeDaysRange(
  current: Decimal,
  target: Decimal,
  speedA: number | null,
  speedB: number | null,
): DaysRange | null {
  const a = computeDaysToTarget(current, target, speedA)
  const b = computeDaysToTarget(current, target, speedB)
  if (a === null && b === null) return null
  if (a === null) return { min: b!, max: b! }
  if (b === null) return { min: a, max: a }
  return { min: Math.min(a, b), max: Math.max(a, b) }
}

function formatDayValue(days: number): string {
  const rounded = Math.round(days)
  return rounded === 0 ? '<1' : String(rounded)
}

export function formatDaysRange(range: DaysRange | null): string {
  if (!range) return '-'
  const lo = formatDayValue(range.min)
  const hi = formatDayValue(range.max)
  if (lo === hi) return `${lo}d`
  return `${lo}–${hi}d`
}
