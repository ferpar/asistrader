import { ITradeRepository, IPriceProvider, DetectionResponse } from '../ITradeRepository'

export function createStubTradeRepository(overrides?: Partial<ITradeRepository>): ITradeRepository {
  return {
    fetchTrades: async () => [],
    createTrade: async () => { throw new Error('not implemented') },
    updateTrade: async () => { throw new Error('not implemented') },
    detectTradeHits: async (): Promise<DetectionResponse> => ({
      entryAlerts: [],
      sltpAlerts: [],
      layeredAlerts: [],
      result: {
        autoOpenedCount: 0,
        autoClosedCount: 0,
        partialCloseCount: 0,
        conflictCount: 0,
      },
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
