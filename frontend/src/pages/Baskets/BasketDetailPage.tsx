import { useEffect, useMemo, useState } from 'react'
import { observer } from '@legendapp/state/react'
import { useBasketDetailStore, useRouterStore } from '../../container/ContainerContext'
import { RebasedLineChart, type LevelSeries } from '../../components/charts/RebasedLineChart'
import { BasketMembersTable } from './BasketMembersTable'
import styles from './Baskets.module.css'
import detail from './BasketDetail.module.css'

const KIND_LABEL = { curated: 'Curated', personal: 'Personal' } as const

/**
 * Overlay colours follow the benchmark (its place in the benchmark list), not
 * the order it was picked in, so toggling one never repaints the others. The
 * Basket Index takes series 1; past the palette, benchmarks fall back to the
 * muted ink rather than a generated hue.
 */
function benchmarkColor(position: number): string {
  return position < 7 ? `var(--series-${position + 2})` : 'var(--color-text-muted)'
}

/** One Basket: its index against the benchmarks the user picks, and its ranked members. */
export const BasketDetailPage = observer(function BasketDetailPage({ basketId }: { basketId: number }) {
  const store = useBasketDetailStore()
  const router = useRouterStore()
  const [overlays, setOverlays] = useState<string[]>([])

  useEffect(() => {
    store.load(basketId)
  }, [store, basketId])

  const basket = store.basket$.get()
  const index = store.index$.get()
  const members = store.members$.get()
  const benchmarks = store.benchmarks$.get()
  const benchmarkSeries = store.benchmarkSeries$.get()
  const loading = store.loading$.get()
  const error = store.error$.get()

  const series = useMemo<LevelSeries[]>(() => {
    if (!basket) return []
    const picked = benchmarks
      .map((b, position) => ({ b, position }))
      .filter(({ b }) => overlays.includes(b.symbol))
      .map(({ b, position }) => ({
        key: b.symbol,
        label: b.name ?? b.symbol,
        color: benchmarkColor(position),
        points: benchmarkSeries[b.symbol] ?? [],
      }))
    return [{ key: `basket:${basket.id}`, label: basket.name, color: 'var(--series-1)', points: index }, ...picked]
  }, [basket, index, benchmarks, benchmarkSeries, overlays])

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
      </div>
      {basket.description && <p className={styles.hint}>{basket.description}</p>}
      {error && <p className={styles.error}>{error}</p>}

      <div className={detail.section}>
        {benchmarks.length > 0 && (
          <div className={detail.overlays} role="group" aria-label="Benchmark overlays">
            <span className={detail.overlayLabel}>Compare with</span>
            {benchmarks.map((b, position) => {
              const on = overlays.includes(b.symbol)
              return (
                <button
                  key={b.symbol}
                  type="button"
                  aria-pressed={on}
                  className={`${detail.chip} ${on ? detail.chipOn : ''}`}
                  onClick={() => toggle(b.symbol)}
                  title={b.symbol}
                >
                  {on && <span className={detail.chipSwatch} style={{ background: benchmarkColor(position) }} />}
                  {b.name ?? b.symbol}
                </button>
              )
            })}
          </div>
        )}
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
    </section>
  )
})
