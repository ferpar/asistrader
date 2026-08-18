import { observable, computed } from '@legendapp/state'
import { IPriceProvider } from './ITradeRepository'
import { TradeStore } from './TradeStore'
import { computeMetrics } from './computeMetrics'
import type { PriceData, LiveMetrics } from './types'

export class LiveMetricsStore {
  readonly prices$ = observable<Record<string, PriceData>>({})
  readonly loading$ = observable(false)
  readonly error$ = observable<string | null>(null)

  /**
   * The request currently in flight, keyed by the symbol set it covers.
   *
   * Several components mount at once and each calls `refreshPrices()` from its
   * own effect (the trades table, the radar view, the drivers sections). Every
   * one of those is a POST that the backend answers by calling yfinance, and
   * each occupies a worker thread and a DB connection for the whole round-trip.
   * Firing four identical ones on a single page load is how a slow upstream
   * turns into a starved server, so concurrent callers share one request.
   */
  private inFlight: { key: string; promise: Promise<void> } | null = null

  readonly metrics$ = computed<Record<number, LiveMetrics>>(() => {
    const activeTrades = this.tradeStore.activeTrades$.get()
    const prices = this.prices$.get()
    return computeMetrics(activeTrades, prices)
  })

  constructor(
    private readonly tradeStore: TradeStore,
    private readonly priceProvider: IPriceProvider,
  ) {}

  async refreshPrices(): Promise<void> {
    const activeTrades = this.tradeStore.activeTrades$.get()
    const symbols = [...new Set(activeTrades.map(t => t.ticker.toUpperCase()))].sort()

    if (symbols.length === 0) {
      this.prices$.set({})
      return
    }

    const key = symbols.join(',')
    if (this.inFlight?.key === key) return this.inFlight.promise

    const promise = this.fetch(symbols).finally(() => {
      if (this.inFlight?.key === key) this.inFlight = null
    })
    this.inFlight = { key, promise }
    return promise
  }

  private async fetch(symbols: string[]): Promise<void> {
    this.loading$.set(true)
    this.error$.set(null)
    try {
      const prices = await this.priceProvider.fetchBatchPrices(symbols)
      this.prices$.set(prices)
    } catch (err) {
      this.error$.set(err instanceof Error ? err.message : 'Failed to fetch prices')
    } finally {
      this.loading$.set(false)
    }
  }
}
