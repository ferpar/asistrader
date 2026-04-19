import { observer } from '@legendapp/state/react'
import type { BenchmarkIndicators, Benchmark } from '../../domain/benchmark/types'
import { formatPrice } from '../../utils/priceFormat'
import styles from './RadarTickerCard.module.css'

interface RadarBenchmarkCardProps {
  indicators: BenchmarkIndicators
  benchmark?: Benchmark | null
  onRemove: (symbol: string) => void
}

const formatPercent = (value: number) =>
  new Intl.NumberFormat('en-US', { style: 'percent', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value)

const formatR2 = (value: number) => value.toFixed(2)

function getStructureColor(structure: string | null): string {
  if (!structure) return ''
  if (structure.startsWith('0')) return styles.bullish
  if (structure.startsWith('4')) return styles.bearish
  return ''
}

export const RadarBenchmarkCard = observer(function RadarBenchmarkCard({
  indicators,
  benchmark,
  onRemove,
}: RadarBenchmarkCardProps) {
  const { symbol, currentPrice, sma, priceChanges, linearRegression, error } = indicators
  const fmt = (value: number) => formatPrice(value, benchmark?.currency, null)
  const benchmarkName = benchmark?.name ?? null

  const header = (
    <div className={styles.cardHeader}>
      <div className={styles.symbolGroup}>
        <span className={styles.symbol}>{symbol}</span>
        {benchmarkName && <span className={styles.tickerName}>{benchmarkName}</span>}
        {!error && currentPrice !== null && (
          <span className={styles.price}>{fmt(currentPrice)}</span>
        )}
      </div>
      <div className={styles.headerRight}>
        <button className={styles.removeBtn} onClick={() => onRemove(symbol)}>&times;</button>
      </div>
    </div>
  )

  if (error) {
    return (
      <div className={`${styles.card} ${styles.cardError}`}>
        {header}
        <div className={styles.errorMsg}>{error}</div>
      </div>
    )
  }

  return (
    <div className={styles.card}>
      {header}

      <div className={styles.sections}>
        <div className={styles.section}>
          <div className={styles.sectionLabel}>SMA Structure</div>
          <div className={`${styles.structure} ${getStructureColor(sma.structure)}`}>
            {sma.structure ?? '-'}
          </div>
          <div className={styles.emaValues}>
            <span className={styles.emaItem}><span className={styles.emaLabel}>5</span> {sma.sma5 !== null ? fmt(sma.sma5) : '-'}</span>
            <span className={styles.emaItem}><span className={styles.emaLabel}>20</span> {sma.sma20 !== null ? fmt(sma.sma20) : '-'}</span>
            <span className={styles.emaItem}><span className={styles.emaLabel}>50</span> {sma.sma50 !== null ? fmt(sma.sma50) : '-'}</span>
            <span className={styles.emaItem}><span className={styles.emaLabel}>200</span> {sma.sma200 !== null ? fmt(sma.sma200) : '-'}</span>
          </div>
        </div>

        <div className={styles.section}>
          <div className={styles.sectionLabel}>Avg Daily Change</div>
          <div className={styles.changeGrid}>
            <div className={styles.changeItem}>
              <span className={styles.changeLabel}>50d</span>
              <span className={priceChanges.avgChange50d !== null && priceChanges.avgChange50d >= 0 ? 'positive' : 'negative'}>
                {priceChanges.avgChange50d !== null ? fmt(priceChanges.avgChange50d) : '-'}
              </span>
              <span className={priceChanges.avgChangePct50d !== null && priceChanges.avgChangePct50d >= 0 ? 'positive' : 'negative'}>
                {priceChanges.avgChangePct50d !== null ? formatPercent(priceChanges.avgChangePct50d) : '-'}
              </span>
            </div>
            <div className={styles.changeItem}>
              <span className={styles.changeLabel}>5d</span>
              <span className={priceChanges.avgChange5d !== null && priceChanges.avgChange5d >= 0 ? 'positive' : 'negative'}>
                {priceChanges.avgChange5d !== null ? fmt(priceChanges.avgChange5d) : '-'}
              </span>
              <span className={priceChanges.avgChangePct5d !== null && priceChanges.avgChangePct5d >= 0 ? 'positive' : 'negative'}>
                {priceChanges.avgChangePct5d !== null ? formatPercent(priceChanges.avgChangePct5d) : '-'}
              </span>
            </div>
          </div>
        </div>

        <div className={styles.section}>
          <div className={styles.sectionLabel}>Linear Regression</div>
          <div className={styles.changeGrid}>
            {([
              ['20d', linearRegression.lr20],
              ['50d', linearRegression.lr50],
              ['200d', linearRegression.lr200],
            ] as const).map(([label, lr]) => (
              <div key={label} className={styles.changeItem}>
                <span className={styles.changeLabel}>{label}</span>
                <span className={lr.slope !== null && lr.slope >= 0 ? 'positive' : 'negative'}>
                  {lr.slope !== null ? fmt(lr.slope) : '-'}
                </span>
                <span className={lr.slopePct !== null && lr.slopePct >= 0 ? 'positive' : 'negative'}>
                  {lr.slopePct !== null ? formatPercent(lr.slopePct) : '-'}
                </span>
                <span>R² {lr.r2 !== null ? formatR2(lr.r2) : '-'}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
})
