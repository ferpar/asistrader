interface PortfoliosPageProps {
  /** The Portfolio to show, or null for the list of Portfolios. */
  portfolioId: string | null
}

/** Placeholder for the Portfolios list and Portfolio detail pages. */
export function PortfoliosPage({ portfolioId }: PortfoliosPageProps) {
  return (
    <section>
      <h2>{portfolioId === null ? 'Portfolios' : `Portfolio ${portfolioId}`}</h2>
      <p>Coming soon.</p>
    </section>
  )
}
