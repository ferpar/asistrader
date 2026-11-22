import { PortfolioListPage } from './PortfolioListPage'
import { PortfolioDetailPage } from './PortfolioDetailPage'

interface PortfoliosPageProps {
  /** The Portfolio to show, or null for the list of Portfolios. */
  portfolioId: string | null
}

/** `/portfolio` (list) and `/portfolio/portfolios/:id` (detail). */
export function PortfoliosPage({ portfolioId }: PortfoliosPageProps) {
  const id = portfolioId === null ? NaN : Number(portfolioId)
  return Number.isInteger(id) ? <PortfolioDetailPage portfolioId={id} /> : <PortfolioListPage />
}
