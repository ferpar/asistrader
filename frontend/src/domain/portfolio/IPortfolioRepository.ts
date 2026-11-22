import type {
  ImportResult,
  Portfolio,
  PortfolioSummary,
  PortfolioTransaction,
  TransactionInput,
} from './types'

export interface IPortfolioRepository {
  fetchPortfolios(): Promise<Portfolio[]>
  fetchPortfolio(id: number): Promise<Portfolio>
  createPortfolio(name: string, currency?: string): Promise<Portfolio>
  renamePortfolio(id: number, name: string): Promise<Portfolio>
  deletePortfolio(id: number): Promise<void>
  fetchTransactions(portfolioId: number): Promise<PortfolioTransaction[]>
  createTransaction(portfolioId: number, input: TransactionInput): Promise<PortfolioTransaction>
  updateTransaction(
    portfolioId: number,
    transactionId: number,
    input: TransactionInput,
  ): Promise<PortfolioTransaction>
  /** Import Buys and Sells from CSV text; each row is created or reported on its own. */
  importTransactions(portfolioId: number, csv: string): Promise<ImportResult>
  deleteTransaction(portfolioId: number, transactionId: number): Promise<void>
  fetchSummary(portfolioId: number): Promise<PortfolioSummary>
}
