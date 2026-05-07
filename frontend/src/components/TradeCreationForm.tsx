import React, { useEffect } from 'react'
import { createPortal } from 'react-dom'
import { observer } from '@legendapp/state/react'
import { TickerSearchInput } from './TickerSearchInput'
import { PriceInput } from './PriceInput'
import { useTradeCreation } from '../hooks/useTradeCreation'
import { formatPrice } from '../utils/priceFormat'
import formStyles from '../styles/forms.module.css'
import layeredStyles from '../styles/layeredLevels.module.css'
import styles from './TradeCreationForm.module.css'

interface TradeCreationFormProps {
  onClose: () => void
  initialTicker?: string
}

export const TradeCreationForm = observer(function TradeCreationForm({ onClose, initialTicker }: TradeCreationFormProps) {
  const {
    formData,
    layeredMode,
    setLayeredMode,
    tpLevels,
    setTpLevels,
    tickers,
    strategies,
    loadingTickers,
    submitting,
    error,
    currentPrice,
    loadingPrice,
    preview,
    suggestedUnits,
    applySuggestedUnits,
    validation,
    getFieldError,
    handleChange,
    handleSubmit,
    addTicker,
    selectTicker,
    setAutoDetect,
  } = useTradeCreation(initialTicker)

  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleEscape)
    return () => document.removeEventListener('keydown', handleEscape)
  }, [onClose])

  const selectedTicker = tickers.find((t) => t.symbol === formData.ticker) ?? null
  const formatCurrency = (value: number) =>
    formatPrice(value, selectedTicker?.currency, selectedTicker?.priceHint)

  // Base-currency formatter uses 2 decimals (typical for reporting currency).
  const formatBaseCurrency = (value: number) =>
    formatPrice(value, preview.baseCurrency, 2)

  const showBaseCurrencyPreview = preview.tickerCurrency !== preview.baseCurrency

  const formatPercent = (value: number) =>
    new Intl.NumberFormat('en-US', { style: 'percent', minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(value)

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (preview.ratio > 0 && preview.ratio < 1.5) {
      if (!window.confirm(`Risk/reward ratio is ${preview.ratio.toFixed(2)}. Continue anyway?`)) return
    }
    const success = await handleSubmit(e)
    if (success) onClose()
  }

  const modalContent = (
    <div className={styles.modalOverlay} onClick={onClose}>
      <div className={styles.modal} onClick={e => e.stopPropagation()}>
        <div className={styles.modalHeader}>
          <h3>New Trade</h3>
          <button className={styles.modalClose} onClick={onClose}>&times;</button>
        </div>

        {loadingTickers ? (
          <div className={styles.modalBody}>Loading tickers...</div>
        ) : (
          <form onSubmit={onSubmit} className={styles.modalBody}>
            {error && <div className={formStyles.formError}>{error}</div>}

            <div className={formStyles.formRow}>
              <div className={formStyles.formGroup}>
                <label htmlFor="ticker">Ticker</label>
                <TickerSearchInput
                  existingTickers={tickers}
                  selectedTicker={formData.ticker}
                  onTickerSelect={selectTicker}
                  onTickerCreated={addTicker}
                />
              </div>

              <div className={formStyles.formGroup}>
                <label htmlFor="date_planned">Planned Date</label>
                <input
                  type="date"
                  id="date_planned"
                  name="date_planned"
                  value={formData.date_planned}
                  onChange={handleChange}
                  required
                />
              </div>

              <div className={formStyles.formGroup}>
                <label htmlFor="strategy_id">Strategy</label>
                <select id="strategy_id" name="strategy_id" value={formData.strategy_id} onChange={handleChange}>
                  <option value="">None</option>
                  {strategies.map((s) => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className={formStyles.formRow}>
              <div className={`${formStyles.formGroup} ${formStyles.formGroupCheckbox}`}>
                <label htmlFor="auto_detect">
                  <input
                    type="checkbox"
                    id="auto_detect"
                    checked={formData.auto_detect}
                    onChange={(e) => setAutoDetect(e.target.checked)}
                  />
                  Auto-Detect
                </label>
                <span className={formStyles.formHint}>Auto-open/close on hits</span>
              </div>

              <div className={`${formStyles.formGroup} ${formStyles.formGroupCheckbox}`}>
                <label htmlFor="layered_mode">
                  <input
                    type="checkbox"
                    id="layered_mode"
                    checked={layeredMode}
                    onChange={(e) => setLayeredMode(e.target.checked)}
                  />
                  Layered Exits
                </label>
                <span className={formStyles.formHint}>Multiple TP levels</span>
              </div>
            </div>

            <div className={formStyles.formRow}>
              <div className={formStyles.formGroup}>
                <label htmlFor="order_type">Order Type</label>
                <select id="order_type" name="order_type" value={formData.order_type} onChange={handleChange}>
                  <option value="">None</option>
                  <option value="limit">Limit</option>
                  <option value="stop">Stop</option>
                  <option value="market">Market</option>
                </select>
              </div>

              <div className={formStyles.formGroup}>
                <label htmlFor="time_in_effect">Time in Effect</label>
                <select id="time_in_effect" name="time_in_effect" value={formData.time_in_effect} onChange={handleChange}>
                  <option value="">None</option>
                  <option value="day">Day</option>
                  <option value="gtc">GTC</option>
                  <option value="gtd">GTD</option>
                </select>
              </div>

              {formData.time_in_effect === 'gtd' && (
                <div className={formStyles.formGroup}>
                  <label htmlFor="gtd_date">GTD Expiry Date</label>
                  <input type="date" id="gtd_date" name="gtd_date" value={formData.gtd_date} onChange={handleChange} required />
                </div>
              )}
            </div>

            <div className={formStyles.formRow}>
              <div className={formStyles.formGroup}>
                <label htmlFor="entry_price">
                  Entry Price
                  {loadingPrice && <span className={`${styles.currentPriceHint} ${styles.loading}`}>Loading...</span>}
                  {!loadingPrice && currentPrice !== null && (
                    <span className={styles.currentPriceHint}>Current: {formatCurrency(currentPrice)}</span>
                  )}
                </label>
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

              {!layeredMode && (
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
              )}

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
            </div>

            {layeredMode && (
              <div className={layeredStyles.layeredLevelsSection}>
                <div className={layeredStyles.layeredLevelsGroup}>
                  <div className={layeredStyles.layeredLevelsHeader}>
                    <span>Take Profit Levels</span>
                    <span className={`${layeredStyles.levelsTotal} ${
                      tpLevels.reduce((sum, l) => sum + (parseFloat(l.units_pct) || 0), 0) === 100 ? layeredStyles.complete : layeredStyles.incomplete
                    }`}>
                      Total: {tpLevels.reduce((sum, l) => sum + (parseFloat(l.units_pct) || 0), 0)}%
                      {tpLevels.reduce((sum, l) => sum + (parseFloat(l.units_pct) || 0), 0) === 100 && ' \u2713'}
                    </span>
                  </div>
                  {tpLevels.map((level, index) => (
                    <div key={`tp-${index}`} className={layeredStyles.levelInputRow}>
                      <span className={layeredStyles.levelLabel}>TP{index + 1}</span>
                      <PriceInput placeholder="Price" value={level.price}
                        onChange={(e) => { const n = [...tpLevels]; n[index] = { ...n[index], price: e.target.value }; setTpLevels(n) }}
                        priceHint={selectedTicker?.priceHint} />
                      <input type="number" placeholder="%" value={level.units_pct}
                        onChange={(e) => { const n = [...tpLevels]; n[index] = { ...n[index], units_pct: e.target.value }; setTpLevels(n) }}
                        min="0" max="100" className={layeredStyles.pctInput} />
                      <label className={layeredStyles.beCheckbox}>
                        <input type="checkbox" checked={level.move_sl_to_breakeven}
                          onChange={(e) => { const n = [...tpLevels]; n[index] = { ...n[index], move_sl_to_breakeven: e.target.checked }; setTpLevels(n) }} />
                        <span className={layeredStyles.beLabel}>BE</span>
                      </label>
                      {tpLevels.length > 1 && (
                        <button type="button" className={layeredStyles.btnRemoveLevel}
                          onClick={() => setTpLevels(tpLevels.filter((_, i) => i !== index))}>&times;</button>
                      )}
                    </div>
                  ))}
                  <button type="button" className={layeredStyles.btnAddLevel}
                    onClick={() => setTpLevels([...tpLevels, { price: '', units_pct: '', move_sl_to_breakeven: false }])}>
                    + Add TP Level
                  </button>
                </div>
                {getFieldError('exit_levels') && <div className={formStyles.fieldError}>{getFieldError('exit_levels')}</div>}
              </div>
            )}

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

            <div className={styles.modalActions}>
              <button type="button" className={styles.btnSecondary} onClick={onClose}>Cancel</button>
              <button type="submit" disabled={submitting}>{submitting ? 'Creating...' : 'Create Trade'}</button>
            </div>
          </form>
        )}
      </div>
    </div>
  )

  return createPortal(modalContent, document.body)
})
