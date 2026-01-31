import { useState, useEffect, useMemo } from 'react'
import { fetchStrategies } from '../api/strategies'
import { Strategy, Trade, TradeUpdateRequest, ExitType, ExitLevelCreateRequest } from '../types/trade'
import { useTradeStore } from '../container/ContainerContext'

export type EditMode = 'edit' | 'open' | 'close'

interface ExitLevelInput {
  price: string
  units_pct: string
  move_sl_to_breakeven: boolean
}

interface TradeEditModalProps {
  trade: Trade
  mode: EditMode
  onClose: () => void
}

export function TradeEditModal({ trade, mode, onClose }: TradeEditModalProps) {
  const store = useTradeStore()
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [strategies, setStrategies] = useState<Strategy[]>([])

  const [formData, setFormData] = useState({
    entry_price: trade.entry_price.toString(),
    stop_loss: trade.stop_loss.toString(),
    take_profit: trade.take_profit.toString(),
    units: trade.units.toString(),
    date_actual: new Date().toISOString().split('T')[0],
    exit_price: '',
    exit_type: 'sl' as ExitType,
    exit_date: new Date().toISOString().split('T')[0],
    strategy_id: trade.strategy_id?.toString() || '',
  })

  // Layered mode state
  const [layeredMode, setLayeredMode] = useState(trade.is_layered)
  const [tpLevels, setTpLevels] = useState<ExitLevelInput[]>(() => {
    if (trade.is_layered && trade.exit_levels.length > 0) {
      const levels = trade.exit_levels
        .filter(l => l.level_type === 'tp' && l.status === 'pending')
        .sort((a, b) => a.order_index - b.order_index)
        .map(l => ({
          price: l.price.toString(),
          units_pct: (l.units_pct * 100).toString(),
          move_sl_to_breakeven: l.move_sl_to_breakeven,
        }))
      return levels.length > 0 ? levels : [{ price: '', units_pct: '100', move_sl_to_breakeven: false }]
    }
    return [{ price: '', units_pct: '100', move_sl_to_breakeven: false }]
  })
  const [slLevels, setSlLevels] = useState<ExitLevelInput[]>(() => {
    if (trade.is_layered && trade.exit_levels.length > 0) {
      const levels = trade.exit_levels
        .filter(l => l.level_type === 'sl' && l.status === 'pending')
        .sort((a, b) => a.order_index - b.order_index)
        .map(l => ({
          price: l.price.toString(),
          units_pct: (l.units_pct * 100).toString(),
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
      fetchStrategies()
        .then((response) => setStrategies(response.strategies))
        .catch(() => {
          // Silently fail - strategies dropdown will just be empty
        })
    }
  }, [mode])

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
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h3>{getTitle()}</h3>
          <button className="modal-close" onClick={onClose}>&times;</button>
        </div>

        <form onSubmit={handleSubmit}>
          {error && <div className="form-error">{error}</div>}

          <div className="modal-info">
            <span className="modal-ticker">{trade.ticker}</span>
            <span className="modal-status">{trade.status}</span>
          </div>

          {mode === 'edit' && (
            <>
              <div className="form-group">
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
                <div className="form-group form-group-checkbox">
                  <label htmlFor="layered_mode">
                    <input
                      type="checkbox"
                      id="layered_mode"
                      checked={layeredMode}
                      onChange={(e) => setLayeredMode(e.target.checked)}
                    />
                    Layered Exits
                  </label>
                  <span className="form-hint">Multiple TP/SL levels</span>
                </div>
              )}

              {!layeredMode && (
                <>
                  <div className="form-group">
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

                  <div className="form-group">
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
                <div className="layered-levels-section">
                  <div className="layered-levels-group">
                    <div className="layered-levels-header">
                      <span>Take Profit Levels</span>
                      <span className={`levels-total ${tpTotal === 100 ? 'complete' : 'incomplete'}`}>
                        Total: {tpTotal}%
                        {tpTotal === 100 && ' \u2713'}
                      </span>
                    </div>
                    {tpLevels.map((level, index) => (
                      <div key={`tp-${index}`} className="level-input-row">
                        <span className="level-label">TP{index + 1}</span>
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
                          className="pct-input"
                          disabled={!canEditLayeredMode}
                        />
                        <label className="be-checkbox">
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
                          <span className="be-label">BE</span>
                        </label>
                        {tpLevels.length > 1 && canEditLayeredMode && (
                          <button
                            type="button"
                            className="btn-remove-level"
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
                        className="btn-add-level"
                        onClick={() => setTpLevels([...tpLevels, { price: '', units_pct: '', move_sl_to_breakeven: false }])}
                      >
                        + Add TP Level
                      </button>
                    )}
                  </div>

                  <div className="layered-levels-group">
                    <div className="layered-levels-header">
                      <span>Stop Loss Levels</span>
                      <span className={`levels-total ${slTotal === 100 ? 'complete' : 'incomplete'}`}>
                        Total: {slTotal}%
                        {slTotal === 100 && ' \u2713'}
                      </span>
                    </div>
                    {slLevels.map((level, index) => (
                      <div key={`sl-${index}`} className="level-input-row">
                        <span className="level-label">SL{index + 1}</span>
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
                          className="pct-input"
                          disabled={!canEditLayeredMode}
                        />
                        {slLevels.length > 1 && canEditLayeredMode && (
                          <button
                            type="button"
                            className="btn-remove-level"
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
                        className="btn-add-level"
                        onClick={() => setSlLevels([...slLevels, { price: '', units_pct: '', move_sl_to_breakeven: false }])}
                      >
                        + Add SL Level
                      </button>
                    )}
                  </div>
                </div>
              )}

              <div className="form-group">
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

              <div className="form-group">
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
            <div className="form-group">
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
              <div className="form-group">
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

              <div className="form-group">
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

              <div className="form-group">
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

          <div className="modal-actions">
            <button type="button" className="btn-secondary" onClick={onClose}>
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
