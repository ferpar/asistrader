import { observer } from '@legendapp/state/react'
import type { UseTradeCreation } from '../hooks/useTradeCreation'
import { formatPrice } from '../utils/priceFormat'
import styles from './TradeCreationForm.module.css'

interface TradePreviewCardProps {
  form: UseTradeCreation
}

/** Amount / risk / profit / ratio / direction summary, shared by both forms. */
export const TradePreviewCard = observer(function TradePreviewCard({ form }: TradePreviewCardProps) {
  const { formData, tickers, preview, validation } = form

  const selectedTicker = tickers.find((t) => t.symbol === formData.ticker) ?? null
  const formatCurrency = (value: number) =>
    formatPrice(value, selectedTicker?.currency, selectedTicker?.priceHint)
  const formatBaseCurrency = (value: number) =>
    formatPrice(value, preview.baseCurrency, 2)
  const formatPercent = (value: number) =>
    new Intl.NumberFormat('en-US', { style: 'percent', minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(value)

  const showBaseCurrencyPreview = preview.tickerCurrency !== preview.baseCurrency

  return (
    <div className={styles.formPreview}>
      <div className={styles.previewItem}>
        <span>Amount:</span>
        <span className={styles.previewValue}>
          {formatCurrency(preview.amount)}
          {showBaseCurrencyPreview && preview.amountInBase !== null && (
            <span className={styles.previewBaseCurrency}>≈ {formatBaseCurrency(preview.amountInBase)}</span>
          )}
        </span>
      </div>
      <div className={styles.previewItem}>
        <span>Risk:</span>
        <span className={`${styles.previewValue} ${preview.riskAbs < 0 ? 'negative' : 'positive'}`}>
          {formatCurrency(preview.riskAbs)} ({formatPercent(preview.riskPct)})
          {showBaseCurrencyPreview && preview.riskAbsInBase !== null && (
            <span className={styles.previewBaseCurrency}>≈ {formatBaseCurrency(preview.riskAbsInBase)}</span>
          )}
        </span>
      </div>
      <div className={styles.previewItem}>
        <span>Profit:</span>
        <span className={`${styles.previewValue} ${preview.profitAbs > 0 ? 'positive' : 'negative'}`}>
          {formatCurrency(preview.profitAbs)} ({formatPercent(preview.profitPct)})
          {showBaseCurrencyPreview && preview.profitAbsInBase !== null && (
            <span className={styles.previewBaseCurrency}>≈ {formatBaseCurrency(preview.profitAbsInBase)}</span>
          )}
        </span>
      </div>
      <div className={styles.previewItem}><span>Ratio:</span><span>{preview.ratio.toFixed(2)}</span></div>
      <div className={styles.previewItem}>
        <span>Direction:</span>
        <span className={validation.direction === 'long' ? 'positive' : validation.direction === 'short' ? 'negative' : ''}>
          {validation.direction?.toUpperCase() ?? '-'}
        </span>
      </div>
    </div>
  )
})
