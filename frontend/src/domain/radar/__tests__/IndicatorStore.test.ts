import { describe, it, expect } from 'vitest'
import { IndicatorStore, computeUniverse } from '../IndicatorStore'
import type { IRadarRepository } from '../IRadarRepository'
import type { IPriceProvider } from '../../trade/ITradeRepository'
import type { PriceData } from '../../trade/types'
import { Decimal } from '../../shared/Decimal'
import type { MarketDataRowDTO } from '../../../types/radar'

const ROWS: MarketDataRowDTO[] = [
  { date: '2026-01-01', close: 100 },
  { date: '2026-01-02', close: 101 },
  { date: '2026-01-03', close: 102 },
] as MarketDataRowDTO[]

class FakeRepo implements IRadarRepository {
  syncCalls = 0
  fetchCalls = 0
  lastFetched: string[] = []
  async syncMarketData(): Promise<void> {
    this.syncCalls++
  }
  async fetchBulkMarketData(symbols: string[]) {
    this.fetchCalls++
    this.lastFetched = symbols
    return { data: Object.fromEntries(symbols.map((s) => [s, ROWS])), errors: {} as Record<string, string> }
  }
}

class FakePriceProvider implements IPriceProvider {
  calls = 0
  prices: Record<string, number> = {}
  async fetchBatchPrices(symbols: string[]): Promise<Record<string, PriceData>> {
    this.calls++
    return Object.fromEntries(
      symbols.map((s) => {
        const p = this.prices[s.toUpperCase()]
        return [s, { price: p != null ? new Decimal(p) : null, currency: 'USD', valid: p != null } as PriceData]
      }),
    )
  }
}

const newStore = (repo: IRadarRepository, prices?: IPriceProvider) =>
  new IndicatorStore(repo, prices ?? new FakePriceProvider())

describe('computeUniverse', () => {
  it('is watchlist ∪ traded, uppercased and de-duplicated', () => {
    const u = computeUniverse(
      ['aaa', 'BBB'],
      [
        { ticker: 'bbb', status: 'open' }, // dup of watchlist BBB
        { ticker: 'ccc', status: 'close' },
      ],
    )
    expect(new Set(u)).toEqual(new Set(['AAA', 'BBB', 'CCC']))
    expect(u.length).toBe(3)
  })

  it('excludes canceled trades', () => {
    const u = computeUniverse([], [{ ticker: 'ZZZ', status: 'canceled' }])
    expect(u).toEqual([])
  })
})

describe('IndicatorStore', () => {
  it('builds indicators for the given symbols into indicators$', async () => {
    const repo = new FakeRepo()
    const store = newStore(repo)
    await store.load(['AAA', 'BBB'])
    const out = store.indicators$.get()
    expect(out.map((i) => i.symbol)).toEqual(['AAA', 'BBB'])
    expect(out[0].currentPrice).toBe(102)
    expect(out[0].error).toBeNull()
  })

  it('clears indicators for an empty universe without hitting the repo', async () => {
    const repo = new FakeRepo()
    const store = newStore(repo)
    await store.load([])
    expect(store.indicators$.get()).toEqual([])
    expect(repo.fetchCalls).toBe(0)
  })

  it('throttles the market-data sync but always fetches', async () => {
    const repo = new FakeRepo()
    const store = newStore(repo)
    await store.load(['AAA'])
    await store.load(['AAA']) // within throttle window
    expect(repo.syncCalls).toBe(1)
    expect(repo.fetchCalls).toBe(2)
    await store.load(['AAA'], true) // force re-sync
    expect(repo.syncCalls).toBe(2)
  })

  it('reload() re-runs the most recent universe', async () => {
    const repo = new FakeRepo()
    const store = newStore(repo)
    await store.load(['AAA', 'BBB'])
    await store.reload(true)
    expect(repo.lastFetched).toEqual(['AAA', 'BBB'])
    expect(repo.syncCalls).toBe(2) // forced
  })

  it('overlays live quotes into livePrices$ on load', async () => {
    const repo = new FakeRepo()
    const prices = new FakePriceProvider()
    prices.prices = { AAA: 105.5 } // BBB has no quote
    const store = newStore(repo, prices)
    await store.load(['AAA', 'BBB'])
    // load() fires the overlay fire-and-forget; let the microtask settle.
    await Promise.resolve()
    expect(store.livePrices$.get()).toEqual({ AAA: 105.5 })
  })

  it('keeps indicators when the live-price fetch fails', async () => {
    const repo = new FakeRepo()
    const prices = new FakePriceProvider()
    prices.fetchBatchPrices = async () => {
      throw new Error('network down')
    }
    const store = newStore(repo, prices)
    await store.load(['AAA'])
    await Promise.resolve()
    expect(store.indicators$.get()[0].currentPrice).toBe(102)
    expect(store.livePrices$.get()).toEqual({})
  })
})
