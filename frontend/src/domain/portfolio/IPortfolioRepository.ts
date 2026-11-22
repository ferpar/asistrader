import type {
  ImportResult,
  NewBuy,
  Portfolio,
  PortfolioSummary,
  PortfolioTransaction,
} from './types'

export interface IPortfolioRepository {
  fetchPortfolios(): Promise<Portfolio[]>
  fetchPortfolio(id: number): Promise<Portfolio>
  createPortfolio(name: string, currency?: string): Promise<Portfolio>
  renamePortfolio(id: number, name: string): Promise<Portfolio>
  deletePortfolio(id: number): Promise<void>
  fetchTransactions(portfolioId: number): Promise<PortfolioTransaction[]>
  createBuy(portfolioId: number, buy: NewBuy): Promise<PortfolioTransaction>
  /** Import Buys from CSV text; each row is created or reported on its own. */
  importTransactions(portfolioId: number, csv: string): Promise<ImportResult>
  deleteTransaction(portfolioId: number, transactionId: number): Promise<void>
  fetchSummary(portfolioId: number): Promise<PortfolioSummary>
}
