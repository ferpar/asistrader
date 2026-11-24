/** Money / percentage / IRR formatting shared by IRR/portfolio views. */

import { isPence } from '../../utils/priceFormat'

export function fmtMoney(value: number, ccy: string): string {
  if (isPence(ccy)) return `${value.toFixed(0)} GBp`
  return value.toLocaleString('en-US', {
    style: 'currency',
    currency: ccy || 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  })
}

export function fmtPct(value: number, digits = 2): string {
  return `${(value * 100).toFixed(digits)}%`
}

export const fmtPct1 = (value: number) => fmtPct(value, 1)

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
