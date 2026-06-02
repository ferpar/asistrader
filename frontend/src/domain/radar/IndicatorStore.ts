import { observable } from '@legendapp/state'
import type { IRadarRepository } from './IRadarRepository'
import type { TickerIndicators } from './types'
import { buildTickerIndicators, startDate, SYNC_THROTTLE_MS } from './indicatorBuild'

/** The screened/observed universe: watchlist ∪ non-canceled traded tickers. */
export function computeUniverse(
  watchlist: string[],
  trades: { ticker: string; status: string }[],
): string[] {
  const traded = trades.filter((t) => t.status !== 'canceled').map((t) => t.ticker.toUpperCase())
  return Array.from(new Set([...watchlist.map((s) => s.toUpperCase()), ...traded]))
}

/**
 * Single owner of ticker loading + indicator calculation, shared across pages.
 * Both Radar (which filters it for display) and Screening read `indicators$`,
 * so neither page's lifecycle scopes the other's data. The universe is pushed in
 * via `load()` from a common ancestor (see IndicatorBootstrap), keeping this
 * store free of any dependency on the Radar/Trade stores.
 */
export class IndicatorStore {
  readonly indicators$ = observable<TickerIndicators[]>([])
  readonly loading$ = observable(false)
  readonly error$ = observable<string | null>(null)
  private lastSyncTime = 0
  private lastSymbols: string[] = []

  constructor(private readonly repo: IRadarRepository) {}

  /** Load indicators for `symbols` (throttled market-data sync), into `indicators$`. */
  async load(symbols: string[], force = false): Promise<void> {
    this.lastSymbols = symbols
    if (symbols.length === 0) {
      this.indicators$.set([])
      return
    }

    this.loading$.set(true)
    this.error$.set(null)
    try {
      const start = startDate()
      const now = Date.now()
      if (force || now - this.lastSyncTime > SYNC_THROTTLE_MS) {
        await this.repo.syncMarketData(symbols, start)
        this.lastSyncTime = Date.now()
      }
      const result = await this.repo.fetchBulkMarketData(symbols, start)
      this.indicators$.set(
        symbols.map((s) => buildTickerIndicators(s, result.data[s] ?? [], result.errors[s] ?? null)),
      )
    } catch (err) {
      this.error$.set(err instanceof Error ? err.message : 'Failed to load indicators')
    } finally {
      this.loading$.set(false)
    }
  }

  /** Re-run the most recent load (e.g. a manual refresh), forcing a data sync. */
  reload(force = true): Promise<void> {
    return this.load(this.lastSymbols, force)
  }
}
