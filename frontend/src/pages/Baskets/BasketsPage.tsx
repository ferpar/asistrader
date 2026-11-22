interface BasketsPageProps {
  /** The Basket to show, or null for the Basket ranking. */
  basketId: string | null
}

/** Placeholder for the Baskets ranking and Basket detail pages. */
export function BasketsPage({ basketId }: BasketsPageProps) {
  return (
    <section>
      <h2>{basketId === null ? 'Baskets' : `Basket ${basketId}`}</h2>
      <p>Coming soon.</p>
    </section>
  )
}
