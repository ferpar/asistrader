import type { IPortfolioRepository } from './IPortfolioRepository'
import type {
  ImportResult,
  Portfolio,
  PortfolioHistory,
  PortfolioSummary,
  PortfolioTransaction,
  TransactionInput,
} from './types'
import type {
  PortfolioCreateRequest,
  PortfolioDTO,
  PortfolioHistoryDTO,
  PortfolioImportRequest,
  PortfolioImportResponseDTO,
  PortfolioListResponseDTO,
  PortfolioResponseDTO,
  PortfolioSummaryDTO,
  PortfolioTransactionListResponseDTO,
  PortfolioTransactionResponseDTO,
  TransactionRequest,
} from '../../types/portfolio'
import { mapHistory, mapImportResult, mapPortfolio, mapSummary, mapTransaction } from './mappers'
import { buildHeaders } from '../shared/httpHelpers'
import { fetchWithTimeout } from '../../api/http'

const IMPORT_TIMEOUT_MS = 5 * 60_000

function toRequest(input: TransactionInput): TransactionRequest {
  if (input.kind === 'split') {
    return { kind: 'split', date: input.date, ticker: input.ticker, split_ratio: input.splitRatio }
  }
  return {
    kind: input.kind,
    date: input.date,
    ticker: input.ticker,
    units: input.units,
    price: input.price,
    fees: input.fees,
    ...(input.fxRate !== undefined ? { fx_rate: input.fxRate } : {}),
  }
}

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

  async createTransaction(
    portfolioId: number,
    input: TransactionInput,
  ): Promise<PortfolioTransaction> {
    const response = await fetch(this.url(`/${portfolioId}/transactions`), {
      method: 'POST',
      headers: buildHeaders(this.getToken, true),
      body: JSON.stringify(toRequest(input)),
    })
    if (!response.ok) throw await failure(response, `Failed to record ${input.kind}`)
    const data: PortfolioTransactionResponseDTO = await response.json()
    return mapTransaction(data.transaction)
  }

  async updateTransaction(
    portfolioId: number,
    transactionId: number,
    input: TransactionInput,
  ): Promise<PortfolioTransaction> {
    const response = await fetch(this.url(`/${portfolioId}/transactions/${transactionId}`), {
      method: 'PUT',
      headers: buildHeaders(this.getToken, true),
      body: JSON.stringify(toRequest(input)),
    })
    if (!response.ok) throw await failure(response, 'Failed to update Transaction')
    const data: PortfolioTransactionResponseDTO = await response.json()
    return mapTransaction(data.transaction)
  }

  async importTransactions(portfolioId: number, csv: string): Promise<ImportResult> {
    const body: PortfolioImportRequest = { csv }
    // Unknown tickers are validated and loaded from Yahoo row by row: allow time.
    const response = await fetchWithTimeout(
      this.url(`/${portfolioId}/transactions/import`),
      { method: 'POST', headers: buildHeaders(this.getToken, true), body: JSON.stringify(body) },
      IMPORT_TIMEOUT_MS,
    )
    if (!response.ok) throw await failure(response, 'Failed to import Transactions')
    const data: PortfolioImportResponseDTO = await response.json()
    return mapImportResult(data)
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

  async fetchHistory(
    portfolioId: number,
    range: { from?: string; to?: string } = {},
  ): Promise<PortfolioHistory> {
    const params = new URLSearchParams()
    if (range.from) params.set('from', range.from)
    if (range.to) params.set('to', range.to)
    const query = params.toString()
    const response = await fetch(this.url(`/${portfolioId}/history${query ? `?${query}` : ''}`), {
      headers: buildHeaders(this.getToken),
    })
    if (!response.ok) throw await failure(response, 'Failed to load Portfolio history')
    const data: PortfolioHistoryDTO = await response.json()
    return mapHistory(data)
  }
}
