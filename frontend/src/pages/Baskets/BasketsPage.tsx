import { useEffect } from 'react'
import { observer } from '@legendapp/state/react'
import { useBasketStore, useRouterStore } from '../../container/ContainerContext'
import { BasketRankingTable } from './BasketRankingTable'
import styles from './Baskets.module.css'

interface BasketsPageProps {
  /** The Basket to show, or null for the Basket ranking. */
  basketId: string | null
}

/** The Baskets ranking, or (placeholder for now) one Basket's detail page. */
export function BasketsPage({ basketId }: BasketsPageProps) {
  if (basketId !== null) {
    return (
      <section>
        <h2>Basket {basketId}</h2>
        <p>Coming soon.</p>
      </section>
    )
  }
  return <BasketRanking />
}

const BasketRanking = observer(function BasketRanking() {
  const basketStore = useBasketStore()
  const routerStore = useRouterStore()
  const rows = basketStore.rows$.get()
  const loading = basketStore.loading$.get()
  const error = basketStore.error$.get()

  useEffect(() => {
    basketStore.loadRanking()
  }, [basketStore])

  return (
    <section>
      <div className={styles.header}>
        <h2>Baskets</h2>
        {loading && <span className={styles.hint}>Loading…</span>}
      </div>
      <p className={styles.hint}>
        Each Basket is measured on its equal-weighted Basket Index (adjusted closes, chained from 100), the same way the
        radar measures tickers. Benchmarks are shown for reference.
      </p>
      {error && <p className={styles.error}>{error}</p>}
      <BasketRankingTable rows={rows} onOpen={(id) => routerStore.navigate(`/portfolio/baskets/${id}`)} />
    </section>
  )
})
