import { useEffect, useMemo, useState } from 'react'
import { observer } from '@legendapp/state/react'
import { useBasketOverlayStore, useBenchmarkOverlayStore } from '../../container/ContainerContext'
import { RebasedLineChart, type LevelSeries } from '../../components/charts/RebasedLineChart'
import {
  BenchmarkOverlayToggles,
  basketColor,
  benchmarkColor,
} from '../../components/charts/BenchmarkOverlayToggles'
import { signClass } from '../../components/portfolio/signClass'
import { getRsiTone } from '../../components/radar/rsiHelpers'
import { buildPerformanceIndicators } from '../../domain/portfolio/performanceIndicators'
import { holdingMeasures } from '../../domain/portfolio/holdingMeasures'
import type { PortfolioHistory } from '../../domain/portfolio/types'
import styles from './PerformanceSection.module.css'

const fmtPct1 = (v: number) => `${(v * 100).toFixed(1)}%`
const fmtPct2 = (v: number) => `${(v * 100).toFixed(2)}%`

/**
 * The Portfolio measured like an instrument: its Performance Index charted
 * against the benchmarks and Basket Indexes the user picks (all rebased to a
 * common start; Baskets dashed), and the
 * Momentum Score and radar measures computed on that index by the same
 * indicator builder the radar uses for tickers.
 */
export const PerformanceSection = observer(function PerformanceSection({
  portfolioId,
  name,
  history,
}: {
  portfolioId: number
  name: string
  history: PortfolioHistory
}) {
  const overlayStore = useBenchmarkOverlayStore()
  const benchmarks = overlayStore.benchmarks$.get()
  const benchmarkSeries = overlayStore.series$.get()
  const [overlays, setOverlays] = useState<string[]>([])
  const basketStore = useBasketOverlayStore()
  const baskets = basketStore.baskets$.get()
  const basketSeries = basketStore.series$.get()
  const [basketOverlays, setBasketOverlays] = useState<number[]>([])

  const firstDate = history.rows[0]?.date ?? null
  useEffect(() => {
    if (firstDate) {
      overlayStore.load(firstDate)
      basketStore.load(firstDate)
    }
  }, [overlayStore, basketStore, firstDate])

  // Basket Indexes load lazily: only once a first Basket is picked.
  const wantsBaskets = basketOverlays.length > 0
  useEffect(() => {
    if (wantsBaskets) basketStore.loadIndexes()
  }, [basketStore, wantsBaskets, firstDate])

  const indicators = useMemo(
    () => buildPerformanceIndicators(`portfolio:${portfolioId}`, history),
    [portfolioId, history],
  )
  const measures = holdingMeasures(indicators)

  const series = useMemo<LevelSeries[]>(() => {
    const picked = benchmarks
      .map((b, position) => ({ b, position }))
      .filter(({ b }) => overlays.includes(b.symbol))
      .map(({ b, position }) => ({
        key: b.symbol,
        label: b.name ?? b.symbol,
        color: benchmarkColor(position),
        points: benchmarkSeries[b.symbol] ?? [],
      }))
    const pickedBaskets = baskets
      .map((b, position) => ({ b, position }))
      .filter(({ b }) => basketOverlays.includes(b.id))
      .map(({ b, position }) => ({
        key: `basket:${b.id}`,
        label: b.name,
        color: basketColor(position),
        dashed: true,
        points: basketSeries[b.id] ?? [],
      }))
    const index = history.rows.map((r) => ({ date: r.date, value: r.performanceIndex }))
    return [
      { key: `portfolio:${portfolioId}`, label: name, color: 'var(--series-1)', points: index },
      ...picked,
      ...pickedBaskets,
    ]
  }, [portfolioId, name, history, benchmarks, benchmarkSeries, overlays, baskets, basketSeries, basketOverlays])

  const toggle = (symbol: string) =>
    setOverlays((current) => (current.includes(symbol) ? current.filter((s) => s !== symbol) : [...current, symbol]))
  const toggleBasket = (id: number) =>
    setBasketOverlays((current) => (current.includes(id) ? current.filter((b) => b !== id) : [...current, id]))

  const measure = (label: string, title: string, value: number | null, format: (v: number) => string, tone = '') => (
    <div className={styles.measure} title={title}>
      <span className={styles.label}>{label}</span>
      {value === null ? (
        <span className={`${styles.value} ${styles.muted}`} title="Not enough Performance Index history">
          —
        </span>
      ) : (
        <span className={`${styles.value} ${tone}`}>{format(value)}</span>
      )}
    </div>
  )

  return (
    <section className={styles.section}>
      <h3>Performance</h3>
      <div className={styles.measures}>
        {measure(
          'Momentum Score',
          '0.35·1M + 0.30·3M + 0.20·6M + 0.15·1Y returns of the Performance Index',
          measures.momentum,
          fmtPct1,
          signClass(measures.momentum ?? 0),
        )}
        {measure('Bullish', 'SMA structure: bullish-ordered pairs out of 10', measures.bullishScore, (v) => `${v}/10`)}
        {measure(
          'LR 50d slope',
          '50-day linear-regression slope, % per day',
          measures.lrSlopePct,
          fmtPct2,
          signClass(measures.lrSlopePct ?? 0),
        )}
        {measure('R²', 'Fit of the 50-day linear regression', measures.lrR2, (v) => v.toFixed(2))}
        {measure('TIR', 'Annualised TIR: 50-day slope % × 365', measures.tir, fmtPct1, signClass(measures.tir ?? 0))}
        {measure('RSI', 'RSI (14)', measures.rsi, (v) => v.toFixed(1), getRsiTone(measures.rsi))}
      </div>
      <BenchmarkOverlayToggles
        benchmarks={benchmarks}
        selected={overlays}
        onToggle={toggle}
        baskets={{ baskets, selected: basketOverlays, onToggle: toggleBasket }}
      />
      <RebasedLineChart
        series={series}
        title="Performance Index"
        emptyText="No Performance Index yet: record a Buy to start the history."
      />
    </section>
  )
})
