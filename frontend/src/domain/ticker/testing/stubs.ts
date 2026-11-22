import type { ITickerRepository } from '../ITickerRepository'
import type { Ticker } from '../types'
import type { TickerCreateRequest, TickerSuggestion, TickerPriceResponse } from '../../../types/ticker'
import { Decimal } from '../../shared/Decimal'

export function createStubTickerRepository(overrides?: Partial<ITickerRepository>): ITickerRepository {
  return {
    fetchTickers: async (): Promise<Ticker[]> => [],
    searchTickers: async (): Promise<TickerSuggestion[]> => [],
    createTicker: async (request: TickerCreateRequest): Promise<Ticker> => ({
      symbol: request.symbol,
      name: null,
      currency: null,
      priceHint: null,
      probability: Decimal.from(0.5),
      trendMeanGrowth: null,
      trendStdDeviation: null,
      bias: null,
      horizon: null,
      beta: null,
      strategyId: null,
      instrumentType: null,
      listingCountry: null,
      assetClassOverride: null,
    }),
    setAssetClassOverride: async (symbol: string, assetClass): Promise<Ticker> => ({
      symbol,
      name: null,
      currency: null,
      priceHint: null,
      probability: null,
      trendMeanGrowth: null,
      trendStdDeviation: null,
      bias: null,
      horizon: null,
      beta: null,
      strategyId: null,
      instrumentType: null,
      listingCountry: null,
      assetClassOverride: assetClass,
    }),
    fetchTickerPrice: async (symbol: string): Promise<TickerPriceResponse> => ({
      symbol,
      price: 100,
      currency: 'USD',
      valid: true,
    }),
    ...overrides,
  }
}
