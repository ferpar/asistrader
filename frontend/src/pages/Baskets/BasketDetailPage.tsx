import { useEffect, useMemo, useState } from 'react'
import { observer } from '@legendapp/state/react'
import {
  useBasketDetailStore,
  useBasketStore,
  useBenchmarkOverlayStore,
  useRouterStore,
} from '../../container/ContainerContext'
import { RebasedLineChart, type LevelSeries } from '../../components/charts/RebasedLineChart'
import { BenchmarkOverlayToggles } from '../../components/charts/BenchmarkOverlayToggles'
import { overlaySeries } from '../../components/charts/overlaySeries'
import { BasketMembersTable } from './BasketMembersTable'
import { BasketMembersDialog } from './BasketMembersDialog'
import styles from './Baskets.module.css'
import detail from './BasketDetail.module.css'

const KIND_LABEL = { curated: 'Curated', personal: 'Personal' } as const

/** One Basket: its index against the benchmarks the user picks, and its ranked members. */
export const BasketDetailPage = observer(function BasketDetailPage({ basketId }: { basketId: number }) {
  const store = useBasketDetailStore()
  const basketStore = useBasketStore()
  const benchmarkStore = useBenchmarkOverlayStore()
  const router = useRouterStore()
  const [overlays, setOverlays] = useState<string[]>([])
  const [editingMembers, setEditingMembers] = useState(false)

  useEffect(() => {
    store.load(basketId)
  }, [store, basketId])

  const basket = store.basket$.get()
  const index = store.index$.get()
  const members = store.members$.get()
  const benchmarks = benchmarkStore.benchmarks$.get()
  const benchmarkSeries = benchmarkStore.series$.get()
  const loading = store.loading$.get()
  const error = store.error$.get()

  const series = useMemo<LevelSeries[]>(() => {
    if (!basket) return []
    return overlaySeries(
      { key: `basket:${basket.id}`, label: basket.name, color: 'var(--series-1)', points: index },
      { benchmarks, benchmarkSeries, selectedBenchmarks: overlays },
    )
  }, [basket, index, benchmarks, benchmarkSeries, overlays])

  const openMembersDialog = () => {
    if (!basket) return
    basketStore.remember(basket)
    setEditingMembers(true)
  }
  // Member changes move the index and the members table: reload both.
  const closeMembersDialog = () => {
    setEditingMembers(false)
    store.load(basketId)
  }

  const toggle = (symbol: string) =>
    setOverlays((current) => (current.includes(symbol) ? current.filter((s) => s !== symbol) : [...current, symbol]))

  const back = (
    <button type="button" className={detail.back} onClick={() => router.navigate('/portfolio/baskets')}>
      ← Baskets
    </button>
  )

  if (!basket) {
    return (
      <section>
        {back}
        {loading && <p className={styles.hint}>Loading…</p>}
        {error && <p className={styles.error}>{error}</p>}
      </section>
    )
  }

  return (
    <section>
      {back}
      <div className={styles.header}>
        <div className={detail.title}>
          <h2>{basket.name}</h2>
          <span className={`${styles.badge} ${styles[basket.kind]}`}>{KIND_LABEL[basket.kind]}</span>
          <span className={detail.muted}>{basket.members.length} members</span>
        </div>
        {loading && <span className={styles.hint}>Loading…</span>}
        {basket.kind === 'personal' && (
          <button type="button" className={styles.newButton} onClick={openMembersDialog}>
            Edit members
          </button>
        )}
      </div>
      {basket.description && <p className={styles.hint}>{basket.description}</p>}
      {error && <p className={styles.error}>{error}</p>}

      <div className={detail.section}>
        <BenchmarkOverlayToggles benchmarks={benchmarks} selected={overlays} onToggle={toggle} />
        <RebasedLineChart
          series={series}
          title="Basket Index"
          emptyText="No index yet: none of this Basket's members has adjusted closes loaded."
        />
      </div>

      <div className={detail.section}>
        <h3>Members</h3>
        <BasketMembersTable
          members={members}
          onOpenPortfolio={(id) => router.navigate(`/portfolio/portfolios/${id}`)}
        />
      </div>

      {editingMembers && <BasketMembersDialog basketId={basket.id} onClose={closeMembersDialog} />}
    </section>
  )
})
