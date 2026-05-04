import { observable } from '@legendapp/state'
import { Decimal } from '../shared/Decimal'
import type { IFxRepository } from './IFxRepository'
import type { FxRate, FxRateSeries } from './types'

const ONE = Decimal.from(1)
const MAX_FALLBACK_DAYS = 7

// Sub-unit currencies: yfinance returns e.g. 'GBp' for LSE pence-quoted
// stocks. They're a fractional unit of a canonical currency — there's no
// `GBpUSD=X` pair. Look up the parent and divide by the divisor.
const SUBUNIT_CURRENCIES: Record<string, [string, number]> = {
  GBp: ['GBP', 100],
  GBX: ['GBP', 100],
}

function normalizeCurrency(currency: string): [string, number] {
  return SUBUNIT_CURRENCIES[currency] ?? [currency, 1]
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10)
}

function dayBefore(iso: string): string {
  const d = new Date(iso + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() - 1)
  return isoDate(d)
}

/**
 * In-memory FX rate cache + conversion helper.
 *
 * Anchors on USD: stores `rate_to_usd` per (currency, date). Conversion
 * `from → to` triangulates through USD. USD itself is implicit (rate 1.0).
 *
 * `convert` uses the most-recent-on-or-before rate for the requested date —
 * weekend/holiday-friendly. Throws if no rate is available within
 * MAX_FALLBACK_DAYS.
 */
export class FxStore {
  /** currency → (ISO date string → rateToUsd). USD is never stored. */
  private readonly history = new Map<string, FxRateSeries>()

  /** ISO date strings sorted ascending, per currency. Rebuilt on load. */
  private readonly sortedDates = new Map<string, string[]>()

  readonly loaded$ = observable(false)
  readonly loading$ = observable(false)
  readonly error$ = observable<string | null>(null)

  constructor(private readonly repo: IFxRepository) {}

  /**
   * Fetch rate history for the listed currencies and merge into the cache.
   * Sub-unit currencies are mapped to their canonical parent (e.g. 'GBp' →
   * 'GBP') so the backend only stores one series per canonical currency.
   * Idempotent — re-running with the same currencies just updates the cache.
   */
  async loadHistory(currencies: string[], fromDate?: Date): Promise<void> {
    const canonicals = new Set<string>()
    for (const c of currencies) {
      const [canonical] = normalizeCurrency(c)
      if (canonical !== 'USD') canonicals.add(canonical)
    }
    if (canonicals.size === 0) {
      this.loaded$.set(true)
      return
    }
    this.loading$.set(true)
    this.error$.set(null)
    try {
      const data = await this.repo.getHistory([...canonicals], fromDate)
      for (const [currency, rows] of Object.entries(data)) {
        this.ingest(currency, rows)
      }
      this.loaded$.set(true)
    } catch (err) {
      this.error$.set(err instanceof Error ? err.message : 'Failed to load FX rates')
    } finally {
      this.loading$.set(false)
    }
  }

  private ingest(currency: string, rows: FxRate[]): void {
    let series = this.history.get(currency)
    if (!series) {
      series = new Map<string, Decimal>()
      this.history.set(currency, series)
    }
    for (const row of rows) {
      series.set(isoDate(row.date), row.rateToUsd)
    }
    const sorted = [...series.keys()].sort()
    this.sortedDates.set(currency, sorted)
  }

  /** Most-recent rate-to-USD on or before `onDate`. */
  rateToUsd(currency: string, onDate: Date): Decimal {
    const [canonical, divisor] = normalizeCurrency(currency)
    if (canonical === 'USD') return ONE.div(Decimal.from(divisor))
    const series = this.history.get(canonical)
    const sorted = this.sortedDates.get(canonical)
    if (!series || !sorted || sorted.length === 0) {
      throw new Error(`No FX history loaded for ${canonical}`)
    }
    let target = isoDate(onDate)
    for (let i = 0; i < MAX_FALLBACK_DAYS; i++) {
      const direct = series.get(target)
      if (direct !== undefined) {
        return divisor === 1 ? direct : direct.div(Decimal.from(divisor))
      }
      target = dayBefore(target)
    }
    throw new Error(
      `No FX rate for ${canonical} on or before ${isoDate(onDate)} within ${MAX_FALLBACK_DAYS} days`,
    )
  }

  /** Convert `amount` from `fromCcy` to `toCcy` using the rate at `onDate`. */
  convert(amount: Decimal, fromCcy: string, toCcy: string, onDate: Date): Decimal {
    if (fromCcy === toCcy) return amount
    const fromRate = this.rateToUsd(fromCcy, onDate)
    const toRate = this.rateToUsd(toCcy, onDate)
    return amount.times(fromRate).div(toRate)
  }

  /** Latest available rate (newest date in the cache). Used for live unrealized P&L. */
  latestRate(currency: string): Decimal | null {
    const [canonical, divisor] = normalizeCurrency(currency)
    if (canonical === 'USD') return ONE.div(Decimal.from(divisor))
    const sorted = this.sortedDates.get(canonical)
    if (!sorted || sorted.length === 0) return null
    const latest = sorted[sorted.length - 1]
    const raw = this.history.get(canonical)?.get(latest) ?? null
    if (raw === null) return null
    return divisor === 1 ? raw : raw.div(Decimal.from(divisor))
  }

  /** True if the cache has at least one rate for every requested currency (USD excluded). */
  hasRatesFor(currencies: string[]): boolean {
    return currencies.every((c) => {
      const [canonical] = normalizeCurrency(c)
      return canonical === 'USD' || (this.sortedDates.get(canonical)?.length ?? 0) > 0
    })
  }
}
