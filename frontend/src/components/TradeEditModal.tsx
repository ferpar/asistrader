import { useState, useEffect, useMemo } from 'react'
import { TradeUpdateRequest, ExitType, ExitLevelCreateRequest } from '../types/trade'
import type { Strategy } from '../domain/strategy/types'
import type { TradeWithMetrics } from '../domain/trade/types'
import { useTradeStore, useStrategyRepo } from '../container/ContainerContext'
import styles from './TradeEditModal.module.css'
import formStyles from '../styles/forms.module.css'
import layeredStyles from '../styles/layeredLevels.module.css'

export type EditMode = 'edit' | 'open' | 'close'

interface ExitLevelInput {
  price: string
  units_pct: string
  move_sl_to_breakeven: boolean
}

interface TradeEditModalProps {
  trade: TradeWithMetrics
  mode: EditMode
  onClose: () => void
}

export function TradeEditModal({ trade, mode, onClose }: TradeEditModalProps) {
  const store = useTradeStore()
  const strategyRepo = useStrategyRepo()
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [strategies, setStrategies] = useState<Strategy[]>([])

  const [formData, setFormData] = useState({
    entry_price: trade.entryPrice.toNumber().toString(),
    stop_loss: trade.stopLoss.toNumber().toString(),
    take_profit: trade.takeProfit.toNumber().toString(),
    units: trade.units.toString(),
    date_actual: new Date().toISOString().split('T')[0],
    exit_price: '',
    exit_type: 'sl' as ExitType,
    exit_date: new Date().toISOString().split('T')[0],
    strategy_id: trade.strategyId?.toString() || '',
  })

  // Layered mode state
  const [layeredMode, setLayeredMode] = useState(trade.isLayered)
  const [tpLevels, setTpLevels] = useState<ExitLevelInput[]>(() => {
    if (trade.isLayered && trade.exitLevels.length > 0) {
      const levels = trade.exitLevels
        .filter(l => l.levelType === 'tp' && l.status === 'pending')
        .sort((a, b) => a.orderIndex - b.orderIndex)
        .map(l => ({
          price: l.price.toNumber().toString(),
          units_pct: (l.unitsPct.toNumber() * 100).toString(),
          move_sl_to_breakeven: l.moveSlToBreakeven,
        }))
      return levels.length > 0 ? levels : [{ price: '', units_pct: '100', move_sl_to_breakeven: false }]
    }
    return [{ price: '', units_pct: '100', move_sl_to_breakeven: false }]
  })
  const [slLevels, setSlLevels] = useState<ExitLevelInput[]>(() => {
    if (trade.isLayered && trade.exitLevels.length > 0) {
      const levels = trade.exitLevels
        .filter(l => l.levelType === 'sl' && l.status === 'pending')
        .sort((a, b) => a.orderIndex - b.orderIndex)
        .map(l => ({
          price: l.price.toNumber().toString(),
          units_pct: (l.unitsPct.toNumber() * 100).toString(),
          move_sl_to_breakeven: false,
        }))
      return levels.length > 0 ? levels : [{ price: '', units_pct: '100', move_sl_to_breakeven: false }]
    }
    return [{ price: '', units_pct: '100', move_sl_to_breakeven: false }]
  })

  // Can only edit layered mode for plan trades
  const canEditLayeredMode = trade.status === 'plan'

  useEffect(() => {
    // Close modal on escape key
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleEscape)
    return () => document.removeEventListener('keydown', handleEscape)
  }, [onClose])

  useEffect(() => {
    // Load strategies when in edit mode
    if (mode === 'edit') {
      strategyRepo.fetchStrategies()
        .then((strategies) => setStrategies(strategies))
        .catch(() => {
          // Silently fail - strategies dropdown will just be empty
        })
    }
  }, [mode, strategyRepo])

  // Convert level inputs to API format
  const exitLevelsForRequest = useMemo((): ExitLevelCreateRequest[] | null => {
    if (!layeredMode) return null

    const levels: ExitLevelCreateRequest[] = []

    for (const level of tpLevels) {
      if (level.price) {
        levels.push({
          level_type: 'tp',
          price: parseFloat(level.price) || 0,
          units_pct: (parseFloat(level.units_pct) || 0) / 100,
          move_sl_to_breakeven: level.move_sl_to_breakeven,
        })
      }
    }

    for (const level of slLevels) {
      if (level.price) {
        levels.push({
          level_type: 'sl',
          price: parseFloat(level.price) || 0,
          units_pct: (parseFloat(level.units_pct) || 0) / 100,
          move_sl_to_breakeven: false,
        })
      }
    }

    return levels.length > 0 ? levels : []
  }, [layeredMode, tpLevels, slLevels])

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target
    setFormData(prev => ({ ...prev, [name]: value }))
    setError(null)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSubmitting(true)
    setError(null)

    try {
      let request: TradeUpdateRequest = {}

      if (mode === 'edit') {
        // Always build exit_levels for edits
        let exitLevelsToSend: ExitLevelCreateRequest[] | null = null

        if (canEditLayeredMode) {
          if (layeredMode && exitLevelsForRequest && exitLevelsForRequest.length > 0) {
            exitLevelsToSend = exitLevelsForRequest
          } else {
            // Simple mode: create 1 SL + 1 TP exit level
            const stopLoss = parseFloat(formData.stop_loss)
            const takeProfit = parseFloat(formData.take_profit)
            exitLevelsToSend = [
              { level_type: 'sl', price: stopLoss, units_pct: 1.0, move_sl_to_breakeven: false },
              { level_type: 'tp', price: takeProfit, units_pct: 1.0, move_sl_to_breakeven: false },
            ]
          }
        }

        request = {
          entry_price: parseFloat(formData.entry_price),
          units: parseInt(formData.units),
          strategy_id: formData.strategy_id ? parseInt(formData.strategy_id) : null,
          exit_levels: exitLevelsToSend,
        }
      } else if (mode === 'open') {
        request = {
          status: 'open',
          date_actual: formData.date_actual,
        }
      } else if (mode === 'close') {
        if (!formData.exit_price) {
          setError('Exit price is required')
          setSubmitting(false)
          return
        }
        request = {
          status: 'close',
          exit_price: parseFloat(formData.exit_price),
          exit_type: formData.exit_type,
          exit_date: formData.exit_date,
        }
      }

      await store.updateTrade(trade.id, request)
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update trade')
    } finally {
      setSubmitting(false)
    }
  }

  const getTitle = () => {
    switch (mode) {
      case 'open':
        return 'Open Trade'
      case 'close':
        return 'Close Trade'
      default:
        return 'Edit Trade'
    }
  }

  // Calculate totals for level validation display
  const tpTotal = tpLevels.reduce((sum, l) => sum + (parseFloat(l.units_pct) || 0), 0)
  const slTotal = slLevels.reduce((sum, l) => sum + (parseFloat(l.units_pct) || 0), 0)

  return (
    <div className={styles.modalOverlay} onClick={onClose}>
      <div className={styles.modal} onClick={e => e.stopPropagation()}>
        <div className={styles.modalHeader}>
          <h3>{getTitle()}</h3>
          <button className={styles.modalClose} onClick={onClose}>&times;</button>
        </div>

        <form onSubmit={handleSubmit}>
          {error && <div className={formStyles.formError}>{error}</div>}

          <div className={styles.modalInfo}>
            <span className={styles.modalTicker}>{trade.ticker}</span>
            <span className={styles.modalStatus}>{trade.status}</span>
          </div>

          {mode === 'edit' && (
            <>
              <div className={`${formStyles.formGroup} ${styles.formGroupOverride}`}>
                <label htmlFor="entry_price">Entry Price</label>
                <input
                  type="number"
                  id="entry_price"
                  name="entry_price"
                  value={formData.entry_price}
                  onChange={handleChange}
                  step="0.01"
                  min="0"
                  required
                  disabled={trade.status === 'close'}
                />
              </div>

              {canEditLayeredMode && (
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
                  <span className={formStyles.formHint}>Multiple TP/SL levels</span>
                </div>
              )}

              {!layeredMode && (
                <>
                  <div className={`${formStyles.formGroup} ${styles.formGroupOverride}`}>
                    <label htmlFor="stop_loss">Stop Loss</label>
                    <input
                      type="number"
                      id="stop_loss"
                      name="stop_loss"
                      value={formData.stop_loss}
                      onChange={handleChange}
                      step="0.01"
                      min="0"
                      required
                    />
                  </div>

                  <div className={`${formStyles.formGroup} ${styles.formGroupOverride}`}>
                    <label htmlFor="take_profit">Take Profit</label>
                    <input
                      type="number"
                      id="take_profit"
                      name="take_profit"
                      value={formData.take_profit}
                      onChange={handleChange}
                      step="0.01"
                      min="0"
                      required
                    />
                  </div>
                </>
              )}

              {layeredMode && (
                <div className={layeredStyles.layeredLevelsSection}>
                  <div className={layeredStyles.layeredLevelsGroup}>
                    <div className={layeredStyles.layeredLevelsHeader}>
                      <span>Take Profit Levels</span>
                      <span className={`${layeredStyles.levelsTotal} ${tpTotal === 100 ? 'complete' : 'incomplete'}`}>
                        Total: {tpTotal}%
                        {tpTotal === 100 && ' \u2713'}
                      </span>
                    </div>
                    {tpLevels.map((level, index) => (
                      <div key={`tp-${index}`} className={layeredStyles.levelInputRow}>
                        <span className={layeredStyles.levelLabel}>TP{index + 1}</span>
                        <input
                          type="number"
                          placeholder="Price"
                          value={level.price}
                          onChange={(e) => {
                            const newLevels = [...tpLevels]
                            newLevels[index] = { ...newLevels[index], price: e.target.value }
                            setTpLevels(newLevels)
                          }}
                          step="0.01"
                          min="0"
                          disabled={!canEditLayeredMode}
                        />
                        <input
                          type="number"
                          placeholder="%"
                          value={level.units_pct}
                          onChange={(e) => {
                            const newLevels = [...tpLevels]
                            newLevels[index] = { ...newLevels[index], units_pct: e.target.value }
                            setTpLevels(newLevels)
                          }}
                          min="0"
                          max="100"
                          className={layeredStyles.pctInput}
                          disabled={!canEditLayeredMode}
                        />
                        <label className={layeredStyles.beCheckbox}>
                          <input
                            type="checkbox"
                            checked={level.move_sl_to_breakeven}
                            onChange={(e) => {
                              const newLevels = [...tpLevels]
                              newLevels[index] = { ...newLevels[index], move_sl_to_breakeven: e.target.checked }
                              setTpLevels(newLevels)
                            }}
                            disabled={!canEditLayeredMode}
                          />
                          <span className={layeredStyles.beLabel}>BE</span>
                        </label>
                        {tpLevels.length > 1 && canEditLayeredMode && (
                          <button
                            type="button"
                            className={layeredStyles.btnRemoveLevel}
                            onClick={() => setTpLevels(tpLevels.filter((_, i) => i !== index))}
                          >
                            &times;
                          </button>
                        )}
                      </div>
                    ))}
                    {canEditLayeredMode && (
                      <button
                        type="button"
                        className={layeredStyles.btnAddLevel}
                        onClick={() => setTpLevels([...tpLevels, { price: '', units_pct: '', move_sl_to_breakeven: false }])}
                      >
                        + Add TP Level
                      </button>
                    )}
                  </div>

                  <div className={layeredStyles.layeredLevelsGroup}>
                    <div className={layeredStyles.layeredLevelsHeader}>
                      <span>Stop Loss Levels</span>
                      <span className={`${layeredStyles.levelsTotal} ${slTotal === 100 ? 'complete' : 'incomplete'}`}>
                        Total: {slTotal}%
                        {slTotal === 100 && ' \u2713'}
                      </span>
                    </div>
                    {slLevels.map((level, index) => (
                      <div key={`sl-${index}`} className={layeredStyles.levelInputRow}>
                        <span className={layeredStyles.levelLabel}>SL{index + 1}</span>
                        <input
                          type="number"
                          placeholder="Price"
                          value={level.price}
                          onChange={(e) => {
                            const newLevels = [...slLevels]
                            newLevels[index] = { ...newLevels[index], price: e.target.value }
                            setSlLevels(newLevels)
                          }}
                          step="0.01"
                          min="0"
                          disabled={!canEditLayeredMode}
                        />
                        <input
                          type="number"
                          placeholder="%"
                          value={level.units_pct}
                          onChange={(e) => {
                            const newLevels = [...slLevels]
                            newLevels[index] = { ...newLevels[index], units_pct: e.target.value }
                            setSlLevels(newLevels)
                          }}
                          min="0"
                          max="100"
                          className={layeredStyles.pctInput}
                          disabled={!canEditLayeredMode}
                        />
                        {slLevels.length > 1 && canEditLayeredMode && (
                          <button
                            type="button"
                            className={layeredStyles.btnRemoveLevel}
                            onClick={() => setSlLevels(slLevels.filter((_, i) => i !== index))}
                          >
                            &times;
                          </button>
                        )}
                      </div>
                    ))}
                    {canEditLayeredMode && (
                      <button
                        type="button"
                        className={layeredStyles.btnAddLevel}
                        onClick={() => setSlLevels([...slLevels, { price: '', units_pct: '', move_sl_to_breakeven: false }])}
                      >
                        + Add SL Level
                      </button>
                    )}
                  </div>
                </div>
              )}

              <div className={`${formStyles.formGroup} ${styles.formGroupOverride}`}>
                <label htmlFor="units">Units</label>
                <input
                  type="number"
                  id="units"
                  name="units"
                  value={formData.units}
                  onChange={handleChange}
                  min="1"
                  required
                  disabled={trade.status !== 'plan'}
                />
              </div>

              <div className={`${formStyles.formGroup} ${styles.formGroupOverride}`}>
                <label htmlFor="strategy_id">Strategy</label>
                <select
                  id="strategy_id"
                  name="strategy_id"
                  value={formData.strategy_id}
                  onChange={handleChange}
                >
                  <option value="">None</option>
                  {strategies.map((strategy) => (
                    <option key={strategy.id} value={strategy.id}>
                      {strategy.name}
                    </option>
                  ))}
                </select>
              </div>
            </>
          )}

          {mode === 'open' && (
            <div className={`${formStyles.formGroup} ${styles.formGroupOverride}`}>
              <label htmlFor="date_actual">Open Date</label>
              <input
                type="date"
                id="date_actual"
                name="date_actual"
                value={formData.date_actual}
                onChange={handleChange}
                required
              />
            </div>
          )}

          {mode === 'close' && (
            <>
              <div className={`${formStyles.formGroup} ${styles.formGroupOverride}`}>
                <label htmlFor="exit_price">Exit Price</label>
                <input
                  type="number"
                  id="exit_price"
                  name="exit_price"
                  value={formData.exit_price}
                  onChange={handleChange}
                  step="0.01"
                  min="0"
                  required
                  placeholder="Enter exit price"
                />
              </div>

              <div className={`${formStyles.formGroup} ${styles.formGroupOverride}`}>
                <label htmlFor="exit_type">Exit Type</label>
                <select
                  id="exit_type"
                  name="exit_type"
                  value={formData.exit_type}
                  onChange={handleChange}
                  required
                >
                  <option value="sl">Stop Loss</option>
                  <option value="tp">Take Profit</option>
                </select>
              </div>

              <div className={`${formStyles.formGroup} ${styles.formGroupOverride}`}>
                <label htmlFor="exit_date">Exit Date</label>
                <input
                  type="date"
                  id="exit_date"
                  name="exit_date"
                  value={formData.exit_date}
                  onChange={handleChange}
                  required
                />
              </div>
            </>
          )}

          <div className={styles.modalActions}>
            <button type="button" className={styles.btnSecondary} onClick={onClose}>
              Cancel
            </button>
            <button type="submit" disabled={submitting}>
              {submitting ? 'Saving...' : 'Save'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
