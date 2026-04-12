import type { TickerIndicators } from '../../domain/radar/types'
import styles from './RadarTickerCard.module.css'

interface RadarTickerCardProps {
  indicators: TickerIndicators
  tickerName?: string | null
  onRemove: (symbol: string) => void
}

const formatCurrency = (value: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value)

const formatPercent = (value: number) =>
  new Intl.NumberFormat('en-US', { style: 'percent', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value)

function getStructureColor(structure: string | null): string {
  if (!structure) return ''
  if (structure.startsWith('0')) return styles.bullish
  if (structure.startsWith('4')) return styles.bearish
  return ''
}

export function RadarTickerCard({ indicators, tickerName, onRemove }: RadarTickerCardProps) {
  const { symbol, currentPrice, sma, priceChanges, error } = indicators

  if (error) {
    return (
      <div className={`${styles.card} ${styles.cardError}`}>
        <div className={styles.cardHeader}>
          <div className={styles.symbolGroup}>
            <span className={styles.symbol}>{symbol}</span>
          </div>
          <button className={styles.removeBtn} onClick={() => onRemove(symbol)}>&times;</button>
        </div>
        <div className={styles.errorMsg}>{error}</div>
      </div>
    )
  }

  return (
    <div className={styles.card}>
      <div className={styles.cardHeader}>
        <div className={styles.symbolGroup}>
          <span className={styles.symbol}>{symbol}</span>
          {tickerName && <span className={styles.tickerName}>{tickerName}</span>}
          {currentPrice !== null && (
            <span className={styles.price}>{formatCurrency(currentPrice)}</span>
          )}
        </div>
        <button className={styles.removeBtn} onClick={() => onRemove(symbol)}>&times;</button>
      </div>

      <div className={styles.sections}>
        <div className={styles.section}>
          <div className={styles.sectionLabel}>SMA Structure</div>
          <div className={`${styles.structure} ${getStructureColor(sma.structure)}`}>
            {sma.structure ?? '-'}
          </div>
          <div className={styles.emaValues}>
            <span className={styles.emaItem}><span className={styles.emaLabel}>5</span> {sma.sma5 !== null ? formatCurrency(sma.sma5) : '-'}</span>
            <span className={styles.emaItem}><span className={styles.emaLabel}>20</span> {sma.sma20 !== null ? formatCurrency(sma.sma20) : '-'}</span>
            <span className={styles.emaItem}><span className={styles.emaLabel}>50</span> {sma.sma50 !== null ? formatCurrency(sma.sma50) : '-'}</span>
            <span className={styles.emaItem}><span className={styles.emaLabel}>200</span> {sma.sma200 !== null ? formatCurrency(sma.sma200) : '-'}</span>
          </div>
        </div>

        <div className={styles.section}>
          <div className={styles.sectionLabel}>Avg Daily Change</div>
          <div className={styles.changeGrid}>
            <div className={styles.changeItem}>
              <span className={styles.changeLabel}>50d</span>
              <span className={priceChanges.avgChange50d !== null && priceChanges.avgChange50d >= 0 ? 'positive' : 'negative'}>
                {priceChanges.avgChange50d !== null ? formatCurrency(priceChanges.avgChange50d) : '-'}
              </span>
              <span className={priceChanges.avgChangePct50d !== null && priceChanges.avgChangePct50d >= 0 ? 'positive' : 'negative'}>
                {priceChanges.avgChangePct50d !== null ? formatPercent(priceChanges.avgChangePct50d) : '-'}
              </span>
            </div>
            <div className={styles.changeItem}>
              <span className={styles.changeLabel}>5d</span>
              <span className={priceChanges.avgChange5d !== null && priceChanges.avgChange5d >= 0 ? 'positive' : 'negative'}>
                {priceChanges.avgChange5d !== null ? formatCurrency(priceChanges.avgChange5d) : '-'}
              </span>
              <span className={priceChanges.avgChangePct5d !== null && priceChanges.avgChangePct5d >= 0 ? 'positive' : 'negative'}>
                {priceChanges.avgChangePct5d !== null ? formatPercent(priceChanges.avgChangePct5d) : '-'}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
