import { observable } from '@legendapp/state'
import type { ITickerRepository } from './ITickerRepository'
import type { Ticker } from './types'
import type { TickerCreateRequest, TickerSuggestion, TickerPriceResponse } from '../../types/ticker'

export class TickerStore {
  tickers$ = observable<Ticker[]>([])
  loading$ = observable(false)

  constructor(private repo: ITickerRepository) {}

  async loadTickers(): Promise<void> {
    this.loading$.set(true)
    try {
      const tickers = await this.repo.fetchTickers()
      this.tickers$.set(tickers)
    } finally {
      this.loading$.set(false)
    }
  }

  async searchTickers(query: string): Promise<TickerSuggestion[]> {
    return this.repo.searchTickers(query)
  }

  async createTicker(request: TickerCreateRequest): Promise<Ticker> {
    const ticker = await this.repo.createTicker(request)
    this.tickers$.set([...this.tickers$.get(), ticker])
    return ticker
  }

  async fetchTickerPrice(symbol: string): Promise<TickerPriceResponse> {
    return this.repo.fetchTickerPrice(symbol)
  }
}
