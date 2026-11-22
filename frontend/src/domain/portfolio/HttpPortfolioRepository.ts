import type { IPortfolioRepository } from './IPortfolioRepository'
import type { NewBuy, Portfolio, PortfolioSummary, PortfolioTransaction } from './types'
import type {
  BuyRequest,
  PortfolioCreateRequest,
  PortfolioDTO,
  PortfolioListResponseDTO,
  PortfolioResponseDTO,
  PortfolioSummaryDTO,
  PortfolioTransactionListResponseDTO,
  PortfolioTransactionResponseDTO,
} from '../../types/portfolio'
import { mapPortfolio, mapSummary, mapTransaction } from './mappers'
import { buildHeaders } from '../shared/httpHelpers'

async function failure(response: Response, fallback: string): Promise<Error> {
  const body = await response.json().catch(() => null)
  const detail = body?.detail
  return new Error(typeof detail === 'string' ? detail : fallback)
}

export class HttpPortfolioRepository implements IPortfolioRepository {
  constructor(
    private readonly baseUrl: string,
    private readonly getToken: () => string | null,
  ) {}

  private url(path = ''): string {
    return `${this.baseUrl}/api/portfolios${path}`
  }

  async fetchPortfolios(): Promise<Portfolio[]> {
    const response = await fetch(this.url(), { headers: buildHeaders(this.getToken) })
    if (!response.ok) throw await failure(response, 'Failed to load Portfolios')
    const data: PortfolioListResponseDTO = await response.json()
    return data.portfolios.map(mapPortfolio)
  }

  async fetchPortfolio(id: number): Promise<Portfolio> {
    const response = await fetch(this.url(`/${id}`), { headers: buildHeaders(this.getToken) })
    if (!response.ok) throw await failure(response, 'Failed to load Portfolio')
    const data: PortfolioDTO = await response.json()
    return mapPortfolio(data)
  }

  async createPortfolio(name: string, currency?: string): Promise<Portfolio> {
    const body: PortfolioCreateRequest = currency ? { name, currency } : { name }
    const response = await fetch(this.url(), {
      method: 'POST',
      headers: buildHeaders(this.getToken, true),
      body: JSON.stringify(body),
    })
    if (!response.ok) throw await failure(response, 'Failed to create Portfolio')
    const data: PortfolioResponseDTO = await response.json()
    return mapPortfolio(data.portfolio)
  }

  async renamePortfolio(id: number, name: string): Promise<Portfolio> {
    const response = await fetch(this.url(`/${id}`), {
      method: 'PATCH',
      headers: buildHeaders(this.getToken, true),
      body: JSON.stringify({ name }),
    })
    if (!response.ok) throw await failure(response, 'Failed to rename Portfolio')
    const data: PortfolioResponseDTO = await response.json()
    return mapPortfolio(data.portfolio)
  }

  async deletePortfolio(id: number): Promise<void> {
    const response = await fetch(this.url(`/${id}`), {
      method: 'DELETE',
      headers: buildHeaders(this.getToken),
    })
    if (!response.ok) throw await failure(response, 'Failed to delete Portfolio')
  }

  async fetchTransactions(portfolioId: number): Promise<PortfolioTransaction[]> {
    const response = await fetch(this.url(`/${portfolioId}/transactions`), {
      headers: buildHeaders(this.getToken),
    })
    if (!response.ok) throw await failure(response, 'Failed to load Transactions')
    const data: PortfolioTransactionListResponseDTO = await response.json()
    return data.transactions.map(mapTransaction)
  }

  async createBuy(portfolioId: number, buy: NewBuy): Promise<PortfolioTransaction> {
    const body: BuyRequest = {
      kind: 'buy',
      date: buy.date,
      ticker: buy.ticker,
      units: buy.units,
      price: buy.price,
      fees: buy.fees,
      ...(buy.fxRate !== undefined ? { fx_rate: buy.fxRate } : {}),
    }
    const response = await fetch(this.url(`/${portfolioId}/transactions`), {
      method: 'POST',
      headers: buildHeaders(this.getToken, true),
      body: JSON.stringify(body),
    })
    if (!response.ok) throw await failure(response, 'Failed to record Buy')
    const data: PortfolioTransactionResponseDTO = await response.json()
    return mapTransaction(data.transaction)
  }

  async deleteTransaction(portfolioId: number, transactionId: number): Promise<void> {
    const response = await fetch(this.url(`/${portfolioId}/transactions/${transactionId}`), {
      method: 'DELETE',
      headers: buildHeaders(this.getToken),
    })
    if (!response.ok) throw await failure(response, 'Failed to delete Transaction')
  }

  async fetchSummary(portfolioId: number): Promise<PortfolioSummary> {
    const response = await fetch(this.url(`/${portfolioId}/summary`), {
      headers: buildHeaders(this.getToken),
    })
    if (!response.ok) throw await failure(response, 'Failed to load Portfolio summary')
    const data: PortfolioSummaryDTO = await response.json()
    return mapSummary(data)
  }
}
