import { observable } from '@legendapp/state'
import type { IPortfolioRepository } from './IPortfolioRepository'
import type {
  ImportResult,
  Portfolio,
  PortfolioHistory,
  PortfolioSummary,
  PortfolioTransaction,
  TransactionInput,
} from './types'

const message = (err: unknown, fallback: string) =>
  err instanceof Error ? err.message : fallback

/**
 * The user's Portfolios, plus the detail (summary and Transactions) of the
 * one being viewed. Figures are always recomputed by the backend: after any
 * write the detail is reloaded rather than patched locally.
 */
export class PortfolioStore {
  portfolios$ = observable<Portfolio[]>([])
  loading$ = observable(false)
  error$ = observable<string | null>(null)

  current$ = observable<Portfolio | null>(null)
  summary$ = observable<PortfolioSummary | null>(null)
  transactions$ = observable<PortfolioTransaction[]>([])
  detailLoading$ = observable(false)
  detailError$ = observable<string | null>(null)
  history$ = observable<PortfolioHistory | null>(null)
  historyError$ = observable<string | null>(null)

  constructor(private readonly repo: IPortfolioRepository) {}

  async loadPortfolios(): Promise<void> {
    this.loading$.set(true)
    this.error$.set(null)
    try {
      this.portfolios$.set(await this.repo.fetchPortfolios())
    } catch (err) {
      this.error$.set(message(err, 'Failed to load Portfolios'))
    } finally {
      this.loading$.set(false)
    }
  }

  async createPortfolio(name: string, currency?: string): Promise<Portfolio> {
    const portfolio = await this.repo.createPortfolio(name, currency)
    await this.loadPortfolios()
    return portfolio
  }

  async renamePortfolio(id: number, name: string): Promise<void> {
    const portfolio = await this.repo.renamePortfolio(id, name)
    if (this.current$.peek()?.id === id) this.current$.set(portfolio)
    await this.loadPortfolios()
  }

  async deletePortfolio(id: number): Promise<void> {
    await this.repo.deletePortfolio(id)
    if (this.current$.peek()?.id === id) this.clearDetail()
    await this.loadPortfolios()
  }

  async loadDetail(id: number): Promise<void> {
    if (this.current$.peek()?.id !== id) this.clearDetail()
    this.detailLoading$.set(true)
    this.detailError$.set(null)
    // The history is a heavier read: it loads alongside, and a failure there
    // leaves the rest of the detail usable.
    const history = this.loadHistory(id)
    try {
      const [portfolio, summary, transactions] = await Promise.all([
        this.repo.fetchPortfolio(id),
        this.repo.fetchSummary(id),
        this.repo.fetchTransactions(id),
      ])
      this.current$.set(portfolio)
      this.summary$.set(summary)
      this.transactions$.set(transactions)
    } catch (err) {
      this.detailError$.set(message(err, 'Failed to load Portfolio'))
    } finally {
      this.detailLoading$.set(false)
    }
    await history
  }

  private async loadHistory(id: number): Promise<void> {
    this.historyError$.set(null)
    try {
      this.history$.set(await this.repo.fetchHistory(id))
    } catch (err) {
      this.history$.set(null)
      this.historyError$.set(message(err, 'Failed to load Portfolio history'))
    }
  }

  /** Record a Buy or Sell and reload the detail. Throws so the form can show
   *  why (e.g. a Sell exceeding the units held). */
  async addTransaction(portfolioId: number, input: TransactionInput): Promise<void> {
    await this.repo.createTransaction(portfolioId, input)
    await this.loadDetail(portfolioId)
  }

  /** Replace a Transaction and reload the detail. The backend replays the
   *  whole list and rejects an edit that makes any Sell oversell. */
  async updateTransaction(
    portfolioId: number,
    transactionId: number,
    input: TransactionInput,
  ): Promise<void> {
    await this.repo.updateTransaction(portfolioId, transactionId, input)
    await this.loadDetail(portfolioId)
  }

  /**
   * Import Buys and Sells from CSV text and reload the detail. Throws only when
   * the file as a whole is rejected; per-row failures come back in the result.
   */
  async importCsv(portfolioId: number, csv: string): Promise<ImportResult> {
    const result = await this.repo.importTransactions(portfolioId, csv)
    if (result.created > 0) await this.loadDetail(portfolioId)
    return result
  }

  async deleteTransaction(portfolioId: number, transactionId: number): Promise<void> {
    await this.repo.deleteTransaction(portfolioId, transactionId)
    await this.loadDetail(portfolioId)
  }

  private clearDetail(): void {
    this.current$.set(null)
    this.summary$.set(null)
    this.transactions$.set([])
    this.history$.set(null)
    this.historyError$.set(null)
  }
}
