import { observable, computed } from '@legendapp/state'
import { PriceData, LiveMetrics } from '../../types/trade'
import { IPriceProvider } from './ITradeRepository'
import { TradeStore } from './TradeStore'
import { computeMetrics } from './computeMetrics'

export class LiveMetricsStore {
  readonly prices$ = observable<Record<string, PriceData>>({})
  readonly loading$ = observable(false)
  readonly error$ = observable<string | null>(null)

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
    const symbols = [...new Set(activeTrades.map(t => t.ticker.toUpperCase()))]

    if (symbols.length === 0) {
      this.prices$.set({})
      return
    }

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
