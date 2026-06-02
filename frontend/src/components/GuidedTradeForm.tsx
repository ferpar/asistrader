import React, { useState } from 'react'
import { observer } from '@legendapp/state/react'
import { TickerSearchInput } from './TickerSearchInput'
import { PriceInput } from './PriceInput'
import { TradePreviewCard } from './TradePreviewCard'
import type { UseTradeCreation } from '../hooks/useTradeCreation'
import { formatPrice } from '../utils/priceFormat'
import formStyles from '../styles/forms.module.css'
import styles from './TradeCreationForm.module.css'
import wizard from './TradeWizard.module.css'

interface GuidedTradeFormProps {
  form: UseTradeCreation
  onSubmit: (e: React.FormEvent) => void
  onCancel: () => void
}

const STEPS = ['Instrument', 'Levels', 'Size', 'Review'] as const

/**
 * Step-by-step trade entry covering the common single-TP/single-SL case.
 * Reuses useTradeCreation (no layered mode); layered exits live in the
 * advanced form. Order type is auto-derived and editable on the Review step.
 */
export const GuidedTradeForm = observer(function GuidedTradeForm({ form, onSubmit, onCancel }: GuidedTradeFormProps) {
  const {
    formData,
    tickers,
    submitting,
    error,
    currentPrice,
    loadingPrice,
    preview,
    suggestedUnits,
    applySuggestedUnits,
    direction,
    orderTypeAutoDerived,
    autoSettleWarning,
    getFieldError,
    handleChange,
    addTicker,
    selectTicker,
  } = form

  const [step, setStep] = useState(0)
  const isLast = step === STEPS.length - 1

  const selectedTicker = tickers.find((t) => t.symbol === formData.ticker) ?? null
  const fmt = (value: number) => formatPrice(value, selectedTicker?.currency, selectedTicker?.priceHint)

  const canAdvance = (() => {
    switch (step) {
      case 0:
        return formData.ticker !== ''
      case 1:
        return !getFieldError('entry_price') && !getFieldError('stop_loss') && !getFieldError('take_profit')
      case 2:
        return !getFieldError('units')
      default:
        return true
    }
  })()

  const next = () => { if (canAdvance && !isLast) setStep((s) => s + 1) }
  const back = () => setStep((s) => Math.max(0, s - 1))

  // Only the Review step submits. On earlier steps, swallow implicit submit
  // (e.g. Enter in a field) so it can't skip ahead and create the trade —
  // advancing is done explicitly via the Next button.
  const handleFormSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (isLast) onSubmit(e)
  }

  const currentHint = loadingPrice
    ? <span className={`${styles.currentPriceHint} ${styles.loading}`}>Loading price...</span>
    : currentPrice !== null
      ? <span className={styles.currentPriceHint}>Current: {fmt(currentPrice)}</span>
      : null

  return (
    <form onSubmit={handleFormSubmit} className={styles.modalBody}>
      <ol className={wizard.stepper}>
        {STEPS.map((label, i) => (
          <li key={label} className={`${wizard.step} ${i === step ? wizard.stepActive : ''} ${i < step ? wizard.stepDone : ''}`}>
            <span className={wizard.stepNum}>{i < step ? '✓' : i + 1}</span>
            <span className={wizard.stepLabel}>{label}</span>
          </li>
        ))}
      </ol>

      {error && <div className={formStyles.formError}>{error}</div>}

      {step === 0 && (
        <div className={wizard.stepBody}>
          <div className={formStyles.formGroup}>
            <label htmlFor="ticker">Which instrument? {currentHint}</label>
            <TickerSearchInput
              existingTickers={tickers}
              selectedTicker={formData.ticker}
              onTickerSelect={selectTicker}
              onTickerCreated={addTicker}
            />
          </div>
        </div>
      )}

      {step === 1 && (
        <div className={wizard.stepBody}>
          <div className={formStyles.formRow}>
            <div className={formStyles.formGroup}>
              <label htmlFor="entry_price">Entry Price {currentHint}</label>
              <PriceInput
                id="entry_price" name="entry_price"
                className={getFieldError('entry_price') ? formStyles.inputError : ''}
                value={formData.entry_price} onChange={handleChange}
                priceHint={selectedTicker?.priceHint} required
              />
              {getFieldError('entry_price') && <span className={formStyles.fieldError}>{getFieldError('entry_price')}</span>}
            </div>

            <div className={formStyles.formGroup}>
              <label htmlFor="stop_loss">Stop Loss</label>
              <PriceInput
                id="stop_loss" name="stop_loss"
                className={getFieldError('stop_loss') ? formStyles.inputError : ''}
                value={formData.stop_loss} onChange={handleChange}
                priceHint={selectedTicker?.priceHint} required
              />
              {getFieldError('stop_loss') && <span className={formStyles.fieldError}>{getFieldError('stop_loss')}</span>}
            </div>

            <div className={formStyles.formGroup}>
              <label htmlFor="take_profit">Take Profit</label>
              <PriceInput
                id="take_profit" name="take_profit"
                className={getFieldError('take_profit') ? formStyles.inputError : ''}
                value={formData.take_profit} onChange={handleChange}
                priceHint={selectedTicker?.priceHint} required
              />
              {getFieldError('take_profit') && <span className={formStyles.fieldError}>{getFieldError('take_profit')}</span>}
            </div>
          </div>

          <div className={wizard.chips}>
            <span className={`${wizard.chip} ${direction === 'long' ? wizard.long : direction === 'short' ? wizard.short : ''}`}>
              {direction ? direction.toUpperCase() : 'Direction —'}
            </span>
            <span className={wizard.chip}>
              {formData.order_type.toUpperCase()}{orderTypeAutoDerived ? ' · auto' : ''}
            </span>
            <span className={wizard.chip}>R/R {preview.ratio ? preview.ratio.toFixed(2) : '—'}</span>
          </div>

          {autoSettleWarning && <div className={styles.inlineWarning}>⚠ {autoSettleWarning}</div>}
        </div>
      )}

      {step === 2 && (
        <div className={wizard.stepBody}>
          <div className={formStyles.formRow}>
            <div className={formStyles.formGroup}>
              <label htmlFor="units">
                Units
                {suggestedUnits !== null && (
                  <span className={styles.currentPriceHint}>
                    Suggested: <button type="button" className={styles.suggestedUnitsBtn} onClick={applySuggestedUnits}>{suggestedUnits}</button>
                  </span>
                )}
              </label>
              <input
                type="number" id="units" name="units"
                className={getFieldError('units') ? formStyles.inputError : ''}
                value={formData.units} onChange={handleChange} min="1" required
              />
              {getFieldError('units') && <span className={formStyles.fieldError}>{getFieldError('units')}</span>}
            </div>

            <div className={formStyles.formGroup}>
              <label htmlFor="date_planned">Planned Date</label>
              <input
                type="date" id="date_planned" name="date_planned"
                value={formData.date_planned} onChange={handleChange} required
              />
            </div>
          </div>
        </div>
      )}

      {step === 3 && (
        <div className={wizard.stepBody}>
          <div className={formStyles.formRow}>
            <div className={formStyles.formGroup}>
              <label htmlFor="order_type">
                Order Type
                {orderTypeAutoDerived && <span className={styles.autoHint}>auto</span>}
              </label>
              <select id="order_type" name="order_type" value={formData.order_type} onChange={handleChange}>
                <option value="limit">Limit</option>
                <option value="stop">Stop</option>
                <option value="market">Market</option>
              </select>
            </div>
          </div>

          {autoSettleWarning && <div className={styles.inlineWarning}>⚠ {autoSettleWarning}</div>}
        </div>
      )}

      <TradePreviewCard form={form} />

      <div className={styles.modalActions}>
        {step > 0
          ? <button type="button" className={styles.btnSecondary} onClick={back}>Back</button>
          : <button type="button" className={styles.btnSecondary} onClick={onCancel}>Cancel</button>}
        {isLast
          ? <button type="submit" disabled={submitting}>{submitting ? 'Creating...' : 'Create Trade'}</button>
          : <button type="button" className={wizard.navPrimary} onClick={next} disabled={!canAdvance}>Next</button>}
      </div>
    </form>
  )
})
