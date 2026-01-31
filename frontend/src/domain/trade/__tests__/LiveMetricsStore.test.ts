import { describe, it, expect, vi } from 'vitest'
import { Decimal } from '../../shared/Decimal'
import { TradeStore } from '../TradeStore'
import { LiveMetricsStore } from '../LiveMetricsStore'
import { createStubTradeRepository, createStubPriceProvider } from '../testing/stubs'
import { buildTrade, buildPriceData } from '../testing/fixtures'
import type { PriceData } from '../types'

function setup(overrides?: {
  trades?: ReturnType<typeof buildTrade>[]
  prices?: Record<string, PriceData>
}) {
  const trades = overrides?.trades ?? []
  const prices = overrides?.prices ?? {}

  const repo = createStubTradeRepository({ fetchTrades: async () => trades })
  const provider = createStubPriceProvider({ fetchBatchPrices: async () => prices })
  const tradeStore = new TradeStore(repo)
  const metricsStore = new LiveMetricsStore(tradeStore, provider)

  return { tradeStore, metricsStore, provider }
}

describe('LiveMetricsStore', () => {
  it('refreshPrices fetches for active trade symbols', async () => {
    const trades = [
      buildTrade({ id: 1, status: 'open', ticker: 'AAPL' }),
      buildTrade({ id: 2, status: 'plan', ticker: 'MSFT' }),
      buildTrade({ id: 3, status: 'close', ticker: 'GOOG' }),
    ]
    const fetchBatchPrices = vi.fn().mockResolvedValue({
      AAPL: buildPriceData({ price: Decimal.from(155) }),
      MSFT: buildPriceData({ price: Decimal.from(310) }),
    })

    const repo = createStubTradeRepository({ fetchTrades: async () => trades })
    const provider = createStubPriceProvider({ fetchBatchPrices })
    const tradeStore = new TradeStore(repo)
    const metricsStore = new LiveMetricsStore(tradeStore, provider)

    await tradeStore.loadTrades()
    await metricsStore.refreshPrices()

    // Should only request AAPL and MSFT (active trades), not GOOG (closed)
    expect(fetchBatchPrices).toHaveBeenCalledWith(expect.arrayContaining(['AAPL', 'MSFT']))
    expect(fetchBatchPrices).toHaveBeenCalledWith(expect.not.arrayContaining(['GOOG']))
  })

  it('refreshPrices skips when no active trades', async () => {
    const fetchBatchPrices = vi.fn().mockResolvedValue({})
    const repo = createStubTradeRepository({ fetchTrades: async () => [buildTrade({ status: 'close' })] })
    const provider = createStubPriceProvider({ fetchBatchPrices })
    const tradeStore = new TradeStore(repo)
    const metricsStore = new LiveMetricsStore(tradeStore, provider)

    await tradeStore.loadTrades()
    await metricsStore.refreshPrices()

    expect(fetchBatchPrices).not.toHaveBeenCalled()
    expect(metricsStore.prices$.get()).toEqual({})
  })

  it('metrics$ computed correctly from prices + active trades', async () => {
    const trades = [
      buildTrade({ id: 1, status: 'open', ticker: 'AAPL', entryPrice: Decimal.from(150), stopLoss: Decimal.from(140), takeProfit: Decimal.from(170), units: 10 }),
    ]
    const prices = {
      AAPL: buildPriceData({ price: Decimal.from(160) }),
    }
    const { tradeStore, metricsStore } = setup({ trades, prices })

    await tradeStore.loadTrades()
    await metricsStore.refreshPrices()

    const metrics = metricsStore.metrics$.get()
    expect(metrics[1]).toBeDefined()
    expect(metrics[1].currentPrice!.toNumber()).toBe(160)
    // distanceToSL = (160 - 140) / 160 = 0.125
    expect(metrics[1].distanceToSL!.toNumber()).toBeCloseTo(0.125)
    // distanceToTP = (170 - 160) / 160 = 0.0625
    expect(metrics[1].distanceToTP!.toNumber()).toBeCloseTo(0.0625)
    // distanceToPE = (160 - 150) / 150 = 0.0667
    expect(metrics[1].distanceToPE!.toNumber()).toBeCloseTo(0.0667, 3)
    // unrealizedPnL = (160 - 150) * 10 = 100
    expect(metrics[1].unrealizedPnL!.toNumber()).toBeCloseTo(100)
    // unrealizedPnLPct = (160 - 150) / 150 = 0.0667
    expect(metrics[1].unrealizedPnLPct!.toNumber()).toBeCloseTo(0.0667, 3)
  })

  it('handles fetch errors', async () => {
    const trades = [buildTrade({ id: 1, status: 'open', ticker: 'AAPL' })]
    const repo = createStubTradeRepository({ fetchTrades: async () => trades })
    const provider = createStubPriceProvider({
      fetchBatchPrices: async () => { throw new Error('API down') },
    })
    const tradeStore = new TradeStore(repo)
    const metricsStore = new LiveMetricsStore(tradeStore, provider)

    await tradeStore.loadTrades()
    await metricsStore.refreshPrices()

    expect(metricsStore.error$.get()).toBe('API down')
    expect(metricsStore.loading$.get()).toBe(false)
  })
})
