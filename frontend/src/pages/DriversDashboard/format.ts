/** Money / percentage / IRR formatting for the Drivers dashboard. */

export function fmtMoney(value: number, ccy: string): string {
  if (ccy === 'GBp' || ccy === 'GBX') return `${value.toFixed(0)} GBp`
  return value.toLocaleString('en-US', {
    style: 'currency',
    currency: ccy || 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  })
}

export function fmtPct(value: number): string {
  return `${(value * 100).toFixed(2)}%`
}

/** XIRR on sub-month trades genuinely explodes — clamp the display. */
export function fmtXirr(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return '—'
  if (value > 100) return '>10,000%'
  if (value < -1) return '<-100%'
  return fmtPct(value)
}

/** Compact tick formatters for charts. */
export const fmtPctTick = (v: number) => `${(v * 100).toFixed(0)}%`
export const fmtDaysTick = (v: number) => `${v.toFixed(0)}d`
