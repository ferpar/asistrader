import { observer } from '@legendapp/state/react'
import type { BenchmarkIndicators, Benchmark } from '../../domain/benchmark/types'
import { RsiSparkline } from './RsiSparkline'
import { SmaStructureSection } from './SmaStructureSection'
import { LinearRegressionSection } from './LinearRegressionSection'
import { divergenceRange, divergenceTitle, getRsiTone } from './rsiHelpers'
import styles from './RadarTickerCard.module.css'

interface RadarBenchmarkCardProps {
  indicators: BenchmarkIndicators
  benchmark?: Benchmark | null
  onRemove: (symbol: string) => void
}

/** Indexes are unitless quotes — display them as plain numbers, no currency. */
const benchmarkNumberFmt = new Intl.NumberFormat('en-US', {
  maximumFractionDigits: 2,
})
const fmt = (value: number) => benchmarkNumberFmt.format(value)

const formatPercent = (value: number) =>
  new Intl.NumberFormat('en-US', { style: 'percent', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value)

export const RadarBenchmarkCard = observer(function RadarBenchmarkCard({
  indicators,
  benchmark,
  onRemove,
}: RadarBenchmarkCardProps) {
  const { symbol, currentPrice, sma, priceChanges, linearRegression, rsi, error } =
    indicators
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
        <SmaStructureSection sma={sma} price={currentPrice} fmt={fmt} />

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

        <LinearRegressionSection linearRegression={linearRegression} fmt={fmt} />

        <div className={styles.section}>
          <div className={styles.sectionLabel}>RSI (14)</div>
          <div className={styles.rsiRow}>
            <span className={`${styles.rsiValue} ${getRsiTone(rsi.latest)}`}>
              {rsi.latest !== null ? rsi.latest.toFixed(1) : '-'}
            </span>
            {rsi.divergence.bearish && (
              <span
                className={`${styles.divBadge} ${styles.divBearish}`}
                title={divergenceTitle(rsi.divergence.bearish)}
              >
                ▼ Bearish · {rsi.divergence.bearish.strength}
              </span>
            )}
            {rsi.divergence.bullish && (
              <span
                className={`${styles.divBadge} ${styles.divBullish}`}
                title={divergenceTitle(rsi.divergence.bullish)}
              >
                ▲ Bullish · {rsi.divergence.bullish.strength}
              </span>
            )}
          </div>
          {(rsi.divergence.bearish || rsi.divergence.bullish) && (
            <div className={styles.divDates}>
              {rsi.divergence.bearish && (
                <span title={divergenceTitle(rsi.divergence.bearish)}>
                  ▼ {divergenceRange(rsi.divergence.bearish)}
                </span>
              )}
              {rsi.divergence.bullish && (
                <span title={divergenceTitle(rsi.divergence.bullish)}>
                  ▲ {divergenceRange(rsi.divergence.bullish)}
                </span>
              )}
            </div>
          )}
          <RsiSparkline rsi={rsi} />
        </div>
      </div>
    </div>
  )
})
