import { ITradeRepository, IPriceProvider } from '../ITradeRepository'

export function createStubTradeRepository(overrides?: Partial<ITradeRepository>): ITradeRepository {
  return {
    fetchTrades: async () => [],
    createTrade: async () => { throw new Error('not implemented') },
    updateTrade: async () => { throw new Error('not implemented') },
    detectTradeHits: async () => ({
      entry_alerts: [],
      sltp_alerts: [],
      layered_alerts: [],
      auto_opened_count: 0,
      auto_closed_count: 0,
      partial_close_count: 0,
      conflict_count: 0,
    }),
    ...overrides,
  }
}

export function createStubPriceProvider(overrides?: Partial<IPriceProvider>): IPriceProvider {
  return {
    fetchBatchPrices: async () => ({}),
    ...overrides,
  }
}
