import { fmtPct } from '../../components/portfolio/format'
import type { Decimal } from '../../domain/shared/Decimal'

/** Formatters shared by the Portfolio detail page's tables. */

export const fmtUnits = (units: Decimal | null) =>
  units === null ? '—' : units.toNumber().toLocaleString('en-US', { maximumFractionDigits: 6 })

export const fmtPrice = (price: Decimal | null) =>
  price === null ? '—' : price.toNumber().toLocaleString('en-US', { maximumFractionDigits: 4 })

export const fmtDate = (d: Date) => d.toLocaleDateString('en-CA')

export const fmtOptionalPct = (value: number | null) => (value === null ? '—' : fmtPct(value))
