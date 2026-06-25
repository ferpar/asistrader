import { observable } from '@legendapp/state'
import type { IRadarRepository } from './IRadarRepository'
import type { IPriceProvider } from '../trade/ITradeRepository'
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
  // Live quotes (symbol → price), overlaid on each card's headline price so it
  // matches the trade dialog. The indicators themselves stay on daily closes.
  readonly livePrices$ = observable<Record<string, number>>({})
  readonly loading$ = observable(false)
  readonly error$ = observable<string | null>(null)
  private lastSyncTime = 0
  private lastSymbols: string[] = []

  constructor(
    private readonly repo: IRadarRepository,
    private readonly priceProvider: IPriceProvider,
  ) {}

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
      // Fire-and-forget: the grid renders on closes immediately and the live
      // overlay fills in when the (cached) batch quote returns.
      void this.refreshLivePrices(symbols)
    } catch (err) {
      this.error$.set(err instanceof Error ? err.message : 'Failed to load indicators')
    } finally {
      this.loading$.set(false)
    }
  }

  /** Fetch live quotes for `symbols` and overlay them onto the cards. Non-fatal:
   * on any failure the cards keep showing the last daily close. */
  async refreshLivePrices(symbols: string[]): Promise<void> {
    if (symbols.length === 0) {
      this.livePrices$.set({})
      return
    }
    try {
      const prices = await this.priceProvider.fetchBatchPrices(symbols)
      const map: Record<string, number> = {}
      for (const [sym, data] of Object.entries(prices)) {
        if (data.valid && data.price != null) map[sym.toUpperCase()] = data.price.toNumber()
      }
      this.livePrices$.set(map)
    } catch {
      // Keep the last overlay (or none); cards fall back to the daily close.
    }
  }

  /** Re-run the most recent load (e.g. a manual refresh), forcing a data sync. */
  reload(force = true): Promise<void> {
    return this.load(this.lastSymbols, force)
  }
}
